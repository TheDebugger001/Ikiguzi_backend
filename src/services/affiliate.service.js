const mongoose = require("mongoose");
const AffiliateLink = require("../models/AffiliateLink");
const AffiliateWallet = require("../models/AffiliateWallet");
const AffiliatePayout = require("../models/AffiliatePayout");
const AffiliateAccount = require("../models/AffiliateAccount");
const AffiliateClick = require("../models/AffiliateClick");
const AffiliateCampaign = require("../models/AffiliateCampaign");
const ConversionAudit = require("../models/ConversionAudit");
const Settlement = require("../models/Settlement");
const Notification = require("../models/Notification");
const Order = require("../models/Order");
const User = require("../models/User");
const { normalizePhone, describePhoneIssue } = require("../utils/sms.util");
const crypto = require("crypto");

const MINIMUM_PAYOUT_RWF = 10000;
const CURRENCY = "RWF";
const WEB_ORIGIN = () => process.env.WEB_ORIGIN || "https://mvec.rw";

class AffiliateService {
  /**
   * Generate or retrieve affiliate referral code.
   *
   * Idempotent for bare product links so tapping "Create link" twice does not
   * litter the dashboard with duplicates; labelled / campaign links are always
   * created fresh.
   */
  async generateAffiliateLink(userId, productId = null, campaignId = null, label = "") {
    const cleanLabel = typeof label === "string" ? label.trim() : "";

    if (productId && !campaignId && !cleanLabel) {
      const existing = await AffiliateLink.findOne({
        affiliateUser: userId,
        targetProduct: productId,
        campaign: null,
      }).populate("targetProduct", "name price status media");
      if (existing) return existing;
    }

    const code = `AFF-${userId.toString().slice(-4)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    const link = await AffiliateLink.create({
      affiliateCode: code,
      affiliateUser: userId,
      targetProduct: productId || null,
      campaign: campaignId || null,
      label: cleanLabel,
    });

    await link.populate("targetProduct", "name price status media");
    return link;
  }

  /**
   * Register click with Fraud Guard (Self-referral & duplicate checks)
   */
  async trackClick(affiliateCode, visitorIp, buyerUserId = null) {
    const link = await AffiliateLink.findOne({ affiliateCode, isActive: true });
    if (!link) throw new Error("Invalid or inactive affiliate link.");

    // Fraud Guard: Prevent self-referrals
    if (buyerUserId && link.affiliateUser.toString() === buyerUserId.toString()) {
      return { FraudGuardFlagged: true, reason: "Self-referral blocked" };
    }

    link.clickCount += 1;
    link.lastClickedAt = new Date();
    await link.save();

    // Timestamped copy so ?range=7d stats can be answered; the lifetime
    // counter on the link alone cannot be bucketed by day.
    try {
      await AffiliateClick.create({
        affiliateUser: link.affiliateUser,
        link: link._id,
        affiliateCode: link.affiliateCode,
        buyerUser: buyerUserId || null,
        visitorIp: visitorIp || "",
      });
    } catch (err) {
      console.error("Failed to record affiliate click:", err.message);
    }

    return {
      success: true,
      affiliateCode: link.affiliateCode,
      affiliateUser: link.affiliateUser,
      targetProduct: link.targetProduct
        ? { id: link.targetProduct._id, slug: link.targetProduct.slug, name: link.targetProduct.name }
        : null,
    };
  }

  /**
   * Credit Pending Commission upon successful purchase
   */
  async creditPendingCommission({ affiliateUser, amount, orderId }) {
    let wallet = await AffiliateWallet.findOne({ affiliateUser });
    if (!wallet) {
      wallet = new AffiliateWallet({ affiliateUser, pendingBalance: 0, availableBalance: 0 });
    }

    wallet.pendingBalance += amount;
    await wallet.save();

    return wallet;
  }

  /**
   * Request Wallet Payout (Server-side 10,000 RWF Minimum Rule Enforcement)
   */
  async requestPayout({ userId, amount, paymentMethod, accountDetails }) {
    if (amount < MINIMUM_PAYOUT_RWF) {
      throw new Error(`Minimum withdrawal threshold is RWF ${MINIMUM_PAYOUT_RWF.toLocaleString()}. Requested: RWF ${amount.toLocaleString()}`);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const wallet = await AffiliateWallet.findOne({ affiliateUser: userId }).session(session);
      if (!wallet || wallet.availableBalance < amount) {
        throw new Error("Insufficient available balance for withdrawal.");
      }

      // Lock available balance into pending payout status
      wallet.availableBalance -= amount;
      await wallet.save({ session });

      const payoutNumber = `PAY-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const payout = await AffiliatePayout.create(
        [
          {
            payoutNumber,
            affiliateUser: userId,
            amount,
            paymentMethod,
            accountDetails,
            status: "PENDING",
          },
        ],
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      return payout[0];
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /**
   * Super Admin Process & Approve Payout
   */
  async processAdminPayout({ payoutId, adminId, status, transactionReference, rejectionReason }) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const payout = await AffiliatePayout.findById(payoutId).session(session);
      if (!payout) throw new Error("Payout request not found.");

      if (payout.status !== "PENDING" && payout.status !== "PROCESSING") {
        throw new Error(`Cannot update payout in state: ${payout.status}`);
      }

      const wallet = await AffiliateWallet.findOne({ affiliateUser: payout.affiliateUser }).session(session);

      if (status === "COMPLETED") {
        payout.status = "COMPLETED";
        payout.transactionReference = transactionReference;
        payout.approvedBy = adminId;
        wallet.totalWithdrawn += payout.amount;
      } else if (status === "REJECTED") {
        payout.status = "REJECTED";
        payout.rejectionReason = rejectionReason || "Admin rejected payout request";
        // Revert funds back to available balance
        wallet.availableBalance += payout.amount;
      }

      await payout.save({ session });
      await wallet.save({ session });

      await session.commitTransaction();
      session.endSession();

      return payout;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /**
   * Full dashboard for the signed-in affiliate: wallet, links, click/conversion
   * totals and payout history.
   */
  async getDashboard(userId) {
    const [wallet, links, payouts] = await Promise.all([
      this.getWalletSummary(userId),
      AffiliateLink.find({ affiliateUser: userId })
        .sort({ createdAt: -1 })
        .populate("targetProduct", "name price status media"),
      AffiliatePayout.find({ affiliateUser: userId }).sort({ createdAt: -1 }),
    ]);

    const totalClicks = links.reduce((s, l) => s + (l.clickCount || 0), 0);
    const totalConversions = links.reduce((s, l) => s + (l.conversionCount || 0), 0);
    const available = wallet.availableBalance || 0;
    const pending = wallet.pendingBalance || 0;
    const totalWithdrawn = wallet.totalWithdrawn || 0;

    return {
      wallet: {
        available,
        pending,
        totalWithdrawn,
        totalEarned: available + pending + totalWithdrawn,
      },
      links: links.map((l) => ({
        id: l._id,
        code: l.affiliateCode,
        productId: l.targetProduct?._id || null,
        product: l.targetProduct?.name || "Storewide link",
        productImage: l.targetProduct?.media?.mainImage || null,
        price: l.targetProduct?.price || null,
        clicks: l.clickCount || 0,
        conversions: l.conversionCount || 0,
        isActive: l.isActive,
        createdAt: l.createdAt,
      })),
      totalClicks,
      totalConversions,
      payouts: payouts.map((p) => ({
        id: p._id,
        number: p.payoutNumber,
        amount: p.amount,
        status: p.status,
        paymentMethod: p.paymentMethod,
        transactionReference: p.transactionReference,
        createdAt: p.createdAt,
      })),
    };
  }

  /**
   * Admin listing: every affiliate account with aggregated link/earnings stats.
   */
  async listAffiliates() {
    const users = await User.find({ role: "affiliate" })
      .select("Fullname email status companyName createdAt")
      .sort({ createdAt: -1 });
    const [links, wallets] = await Promise.all([
      AffiliateLink.find({}).select("affiliateUser clickCount conversionCount"),
      AffiliateWallet.find({}),
    ]);

    const byUser = {};
    links.forEach((l) => {
      const id = String(l.affiliateUser);
      byUser[id] = byUser[id] || { clicks: 0, conversions: 0 };
      byUser[id].clicks += l.clickCount || 0;
      byUser[id].conversions += l.conversionCount || 0;
    });
    const walletByUser = {};
    wallets.forEach((w) => {
      walletByUser[String(w.affiliateUser)] = w;
    });

    return users.map((u) => {
      const w = walletByUser[String(u._id)];
      const earned = w ? (w.availableBalance || 0) + (w.pendingBalance || 0) + (w.totalWithdrawn || 0) : 0;
      const agg = byUser[String(u._id)] || { clicks: 0, conversions: 0 };
      return {
        id: u._id,
        name: u.Fullname,
        email: u.email,
        status: u.status || "ACTIVE",
        companyName: u.companyName,
        createdAt: u.createdAt,
        clicks: agg.clicks,
        conversions: agg.conversions,
        earnings: earned,
      };
    });
  }

  /**
   * Payout history: all for admin, own for the signed-in affiliate.
   */
  async listPayouts({ user = null, isAdmin = false } = {}) {
    const query = isAdmin ? {} : { affiliateUser: user };
    const payouts = await AffiliatePayout.find(query)
      .sort({ createdAt: -1 })
      .populate("affiliateUser", "Fullname email");
    return payouts.map((p) => ({
      _id: p._id,
      id: p._id,
      payoutNumber: p.payoutNumber,
      number: p.payoutNumber,
      affiliate: p.affiliateUser,
      amount: p.amount,
      status: p.status,
      paymentMethod: p.paymentMethod,
      accountDetails: p.accountDetails || {},
      accountName: p.accountDetails?.accountName || "",
      phoneNumber: p.accountDetails?.phoneNumber || "",
      accountNumber: p.accountDetails?.accountNumber || p.accountDetails?.phoneNumber || "",
      bankName: p.accountDetails?.bankName || "",
      transactionReference: p.transactionReference,
      rejectionReason: p.rejectionReason,
      processedAt: p.updatedAt,
      createdAt: p.createdAt,
    }));
  }

  /**
   * Conversion audit trail for the signed-in affiliate. Returns a structured
   * empty array when no conversions have been recorded yet.
   */
  async getConversionAudit(userId) {
    const logs = await ConversionAudit.find({ affiliateUser: userId })
      .sort({ convertedAt: -1 })
      .populate("targetProduct", "name price status media")
      .populate("link", "affiliateCode targetProduct isActive");

    return logs.map((c) => ({
      id: c._id,
      referralCode: c.referralCode || c.link?.affiliateCode || "",
      productId: c.targetProduct?._id || (c.link && c.link.targetProduct) || null,
      product: c.targetProduct?.name || "Storewide link",
      order: c.order || null,
      conversionValue: c.conversionValue || 0,
      commissionEarned: c.commissionEarned || 0,
      status: c.status || "PENDING",
      convertedAt: c.convertedAt || c.createdAt,
    }));
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Affiliate dashboard API — everything the app's ApiAffiliateService calls.
  // Every route below maps 1:1 to a frontend method so the dashboard never
  // falls back to demo data.
  // ═════════════════════════════════════════════════════════════════════════

  _oid(userId) {
    return mongoose.Types.ObjectId.isValid(String(userId))
      ? new mongoose.Types.ObjectId(String(userId))
      : null;
  }

  _isValidId(id) {
    return mongoose.Types.ObjectId.isValid(String(id || ""));
  }

  /** `7d` | `30d` | `90d` (or any `<n>d`) → number of days, default 30. */
  parseRangeDays(range) {
    const match = /^(\d+)\s*d$/i.exec(String(range || "").trim());
    if (!match) return 30;
    const days = parseInt(match[1], 10);
    if (!Number.isFinite(days) || days < 1) return 30;
    return Math.min(days, 365);
  }

  _dayKey(date) {
    return new Date(date).toISOString().slice(0, 10);
  }

  _labelFor(dayKey) {
    return new Date(`${dayKey}T00:00:00.000Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  /** Lazily creates the affiliate's account record (profile + settings). */
  async getAccount(userId) {
    const existing = await AffiliateAccount.findOne({ affiliateUser: userId });
    if (existing) return existing;

    const user = await User.findById(userId);
    if (!user) throw new Error("User not found.");

    try {
      return await AffiliateAccount.create({
        affiliateUser: user._id,
        referralCode: `AFF-${String(user._id).slice(-4)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
        displayName: user.Fullname || "",
        accountDetails: { phoneNumber: user.phone || "", accountName: user.Fullname || "" },
      });
    } catch (err) {
      // Unique code collision or a concurrent request won the race.
      const raced = await AffiliateAccount.findOne({ affiliateUser: userId });
      if (raced) return raced;
      throw err;
    }
  }

  async getWalletSummary(userId) {
    const [wallet, lastPayout] = await Promise.all([
      AffiliateWallet.findOne({ affiliateUser: userId }),
      AffiliatePayout.findOne({ affiliateUser: userId, status: "COMPLETED" }).sort({ updatedAt: -1 }),
    ]);
    const available = wallet ? wallet.availableBalance || 0 : 0;
    const pending = wallet ? wallet.pendingBalance || 0 : 0;
    const withdrawn = wallet ? wallet.totalWithdrawn || 0 : 0;
    return {
      availableBalance: available,
      pendingBalance: pending,
      totalWithdrawn: withdrawn,
      totalEarned: available + pending + withdrawn,
      currency: CURRENCY,
      minimumPayout: MINIMUM_PAYOUT_RWF,
      lastPayoutAt: lastPayout ? lastPayout.updatedAt : null,
    };
  }

  /** GET /affiliates/profile */
  async getProfile(userId) {
    const [account, user, wallet] = await Promise.all([
      this.getAccount(userId),
      User.findById(userId),
      this.getWalletSummary(userId),
    ]);
    if (!user) throw new Error("User not found.");

    const code = account.referralCode;
    return {
      _id: account._id,
      id: account._id,
      affiliateUserId: user._id,
      userId: user._id,
      Fullname: user.Fullname,
      fullname: user.Fullname,
      email: user.email || null,
      phone: user.phone || null,
      displayName: account.displayName || user.Fullname || "",
      bio: account.bio || "",
      website: account.website || "",
      country: account.country || "Rwanda",
      affiliateCode: code,
      referralCode: code,
      referralUrl: `${WEB_ORIGIN()}/shop?ref=${code}`,
      status: user.status === "ACTIVE" ? "ACTIVE" : "SUSPENDED",
      verificationStatus: account.verification?.status || "UNVERIFIED",
      verificationNote: account.verification?.notes || "",
      commissionRate: account.commissionRate || 0,
      paymentMethod: account.paymentMethod,
      accountName: account.accountDetails?.accountName || "",
      accountNumber:
        account.accountDetails?.accountNumber || account.accountDetails?.phoneNumber || "",
      phoneNumber: account.accountDetails?.phoneNumber || "",
      wallet,
      createdAt: account.createdAt,
      verifiedAt: account.verification?.reviewedAt || null,
    };
  }

  /** PATCH /affiliates/profile — only user-editable fields are accepted. */
  async updateProfile(userId, body = {}) {
    const [account, user] = await Promise.all([this.getAccount(userId), User.findById(userId)]);
    if (!user) throw new Error("User not found.");

    const { displayName, bio, website, country, paymentMethod, accountDetails, accountName, phone } = body;

    if (phone !== undefined && phone !== null && String(phone).trim() !== "") {
      const normalized = normalizePhone(phone);
      if (!normalized) throw new Error(describePhoneIssue(phone));
      user.phone = normalized;
      try {
        await user.save();
      } catch (err) {
        if (err && err.code === 11000) {
          throw new Error("An account with this phone number already exists.");
        }
        throw err;
      }
    }

    if (displayName !== undefined) account.displayName = String(displayName).trim();
    if (bio !== undefined) account.bio = String(bio);
    if (website !== undefined) account.website = String(website).trim();
    if (country !== undefined) account.country = String(country).trim();
    if (paymentMethod !== undefined) account.paymentMethod = paymentMethod;
    if (accountName !== undefined && accountName !== null) {
      account.accountDetails.accountName = String(accountName).trim();
    }
    if (accountDetails && typeof accountDetails === "object") {
      for (const key of ["phoneNumber", "accountName", "bankName", "accountNumber"]) {
        if (accountDetails[key] !== undefined && accountDetails[key] !== null) {
          account.accountDetails[key] = String(accountDetails[key]).trim();
        }
      }
    }

    await account.save();
    return this.getProfile(userId);
  }

  /** GET /affiliates/verification */
  async getVerification(userId) {
    const account = await this.getAccount(userId);
    const v = account.verification || {};
    return {
      status: v.status || "UNVERIFIED",
      submittedAt: v.submittedAt || null,
      reviewedAt: v.reviewedAt || null,
      notes: v.notes || "",
      documents: v.documents || [],
    };
  }

  /** GET /affiliates/settings */
  async getSettings(userId) {
    const account = await this.getAccount(userId);
    const p = account.preferences || {};
    return {
      preferences: {
        defaultPayoutMethod: p.defaultPayoutMethod || "MTN_MOMO",
        emailNotifications: p.emailNotifications !== false,
        pushNotifications: p.pushNotifications !== false,
        payoutAlerts: p.payoutAlerts !== false,
        marketingEmails: p.marketingEmails === true,
        language: p.language || "English",
        ...(p.themeMode ? { themeMode: p.themeMode } : {}),
      },
    };
  }

  /** PATCH /affiliates/settings */
  async updateSettings(userId, body = {}) {
    const account = await this.getAccount(userId);
    const prefs =
      body && typeof body.preferences === "object" && body.preferences
        ? body.preferences
        : body && typeof body === "object"
        ? body
        : {};

    if (prefs.defaultPayoutMethod !== undefined && prefs.defaultPayoutMethod !== null) {
      account.preferences.defaultPayoutMethod = String(prefs.defaultPayoutMethod);
    }
    for (const flag of ["emailNotifications", "pushNotifications", "payoutAlerts", "marketingEmails"]) {
      if (prefs[flag] !== undefined) account.preferences[flag] = !!prefs[flag];
    }
    if (prefs.language !== undefined && prefs.language !== null) {
      account.preferences.language = String(prefs.language);
    }
    if (Object.prototype.hasOwnProperty.call(prefs, "themeMode")) {
      account.preferences.themeMode = prefs.themeMode == null ? null : String(prefs.themeMode);
    }

    await account.save();
    return this.getSettings(userId);
  }

  _mapLink(link, conv, lastClickedAt) {
    const product = link.targetProduct;
    return {
      _id: link._id,
      id: link._id,
      affiliateCode: link.affiliateCode,
      code: link.affiliateCode,
      label: link.label || "",
      targetProduct: product
        ? { _id: product._id, name: product.name, price: product.price, media: product.media }
        : null,
      campaign: link.campaign || null,
      clickCount: link.clickCount || 0,
      registrationCount: 0,
      conversionCount: conv && conv.conversions !== undefined ? conv.conversions : link.conversionCount || 0,
      commissionEarned: conv && conv.commission !== undefined ? conv.commission : 0,
      revenue: conv && conv.revenue !== undefined ? conv.revenue : 0,
      isActive: link.isActive !== false,
      createdAt: link.createdAt,
      lastClickedAt: lastClickedAt || link.lastClickedAt || null,
    };
  }

  /** GET /affiliates/links */
  async listLinks(userId) {
    const uid = this._oid(userId);
    const [links, convAgg, clickAgg] = await Promise.all([
      AffiliateLink.find({ affiliateUser: userId })
        .sort({ createdAt: -1 })
        .populate("targetProduct", "name price status media"),
      uid
        ? ConversionAudit.aggregate([
            { $match: { affiliateUser: uid } },
            {
              $group: {
                _id: "$link",
                conversions: { $sum: 1 },
                commission: { $sum: "$commissionEarned" },
                revenue: { $sum: "$conversionValue" },
              },
            },
          ])
        : Promise.resolve([]),
      uid
        ? AffiliateClick.aggregate([
            { $match: { affiliateUser: uid } },
            { $group: { _id: "$link", last: { $max: "$createdAt" } } },
          ])
        : Promise.resolve([]),
    ]);

    const convByLink = new Map(convAgg.map((c) => [String(c._id), c]));
    const lastByLink = new Map(clickAgg.map((c) => [String(c._id), c.last]));
    return links.map((l) =>
      this._mapLink(l, convByLink.get(String(l._id)), lastByLink.get(String(l._id)))
    );
  }

  /** PATCH /affiliates/links/:id */
  async updateLink(userId, linkId, patch = {}) {
    if (!this._isValidId(linkId)) throw new Error("Affiliate link not found.");
    const link = await AffiliateLink.findOne({ _id: linkId, affiliateUser: userId }).populate(
      "targetProduct",
      "name price status media"
    );
    if (!link) throw new Error("Affiliate link not found.");

    if (patch.isActive !== undefined) link.isActive = !!patch.isActive;
    if (patch.label !== undefined && patch.label !== null) link.label = String(patch.label).trim();
    await link.save();

    return this._mapLink(link, null, null);
  }

  /** DELETE /affiliates/links/:id */
  async removeLink(userId, linkId) {
    if (!this._isValidId(linkId)) throw new Error("Affiliate link not found.");
    const link = await AffiliateLink.findOne({ _id: linkId, affiliateUser: userId });
    if (!link) throw new Error("Affiliate link not found.");
    await link.deleteOne();
    return { deleted: true, id: link._id };
  }

  /**
   * GET /affiliates/stats?range=7d
   *
   * Clicks come from the timestamped AffiliateClick log. When no log exists
   * yet (links shared before tracking shipped) the headline falls back to the
   * lifetime counter on the links — the series stays empty rather than being
   * invented day by day.
   */
  async getStats(userId, range = "30d") {
    const days = this.parseRangeDays(range);
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const uid = this._oid(userId);
    if (!uid) throw new Error("User not found.");

    const keys = [];
    for (let i = days - 1; i >= 0; i--) {
      keys.push(this._dayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
    }
    const labels = keys.map((k) => this._labelFor(k));
    const index = new Map(keys.map((k, i) => [k, i]));

    const [clickRows, convRows, regRows, linkClickRows, linkConvRows, links, totalClickLogs] =
      await Promise.all([
        AffiliateClick.aggregate([
          { $match: { affiliateUser: uid, createdAt: { $gte: since } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        ]),
        // Money events: a settlement line carries the affiliate's share.
        Settlement.aggregate([
          { $match: { affiliateUser: uid, affiliateShare: { $gt: 0 }, createdAt: { $gte: since } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              conversions: { $sum: 1 },
              revenue: { $sum: "$grossAmount" },
              commission: { $sum: "$affiliateShare" },
            },
          },
        ]),
        // "Registrations": buyers whose first attributed order landed in range.
        Order.aggregate([
          { $match: { affiliateUser: uid } },
          { $sort: { createdAt: 1 } },
          { $group: { _id: "$user", firstAt: { $first: "$createdAt" } } },
          { $match: { firstAt: { $gte: since } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$firstAt" } }, count: { $sum: 1 } } },
        ]),
        AffiliateClick.aggregate([
          { $match: { affiliateUser: uid, createdAt: { $gte: since } } },
          {
            $group: {
              _id: "$link",
              count: { $sum: 1 },
              last: { $max: "$createdAt" },
            },
          },
        ]),
        ConversionAudit.aggregate([
          { $match: { affiliateUser: uid, convertedAt: { $gte: since } } },
          {
            $group: {
              _id: "$link",
              conversions: { $sum: 1 },
              commission: { $sum: "$commissionEarned" },
              revenue: { $sum: "$conversionValue" },
            },
          },
        ]),
        AffiliateLink.find({ affiliateUser: userId }),
        AffiliateClick.countDocuments({ affiliateUser: uid }),
      ]);

    const clicksSeries = new Array(days).fill(0);
    const convSeries = new Array(days).fill(0);
    const regsSeries = new Array(days).fill(0);
    let revenue = 0;
    let commission = 0;

    clickRows.forEach((r) => {
      const i = index.get(r._id);
      if (i !== undefined) clicksSeries[i] += r.count;
    });
    convRows.forEach((r) => {
      const i = index.get(r._id);
      if (i !== undefined) {
        convSeries[i] += r.conversions;
        revenue += r.revenue || 0;
        commission += r.commission || 0;
      }
    });
    regRows.forEach((r) => {
      const i = index.get(r._id);
      if (i !== undefined) regsSeries[i] += r.count;
    });

    const lifetimeClicks = links.reduce((s, l) => s + (l.clickCount || 0), 0);
    const seriesClicks = clicksSeries.reduce((s, v) => s + v, 0);
    const headlineClicks = totalClickLogs > 0 ? seriesClicks : lifetimeClicks;
    const registrations = regsSeries.reduce((s, v) => s + v, 0);
    const conversions = convSeries.reduce((s, v) => s + v, 0);
    const activeLinks = links.filter((l) => l.isActive !== false).length;

    const convByLink = new Map(linkConvRows.map((c) => [String(c._id), c]));
    const clickByLink = new Map(linkClickRows.map((c) => [String(c._id), c]));

    const topLinks = links
      .map((l) => {
        const conv = convByLink.get(String(l._id));
        const linkClicks = clickByLink.get(String(l._id));
        const mapped = this._mapLink(l, conv, linkClicks ? linkClicks.last : l.lastClickedAt);
        mapped.conversionCount = conv ? conv.conversions : 0;
        mapped.commissionEarned = conv ? conv.commission : 0;
        mapped.revenue = conv ? conv.revenue : 0;
        if (totalClickLogs > 0) mapped.clickCount = linkClicks ? linkClicks.count : 0;
        return mapped;
      })
      .sort(
        (a, b) => b.commissionEarned - a.commissionEarned || b.clickCount - a.clickCount
      )
      .slice(0, 10);

    return {
      range: `${days}d`,
      days,
      clicks: headlineClicks,
      registrations,
      conversions,
      revenue,
      commission,
      activeLinks,
      labels,
      series: {
        labels,
        clicks: clicksSeries,
        registrations: regsSeries,
        conversions: convSeries,
      },
      topLinks,
    };
  }

  /** GET /affiliates/overview — one payload for the dashboard home. */
  async getOverview(userId) {
    const uid = this._oid(userId);
    const [wallet, links, settlementTotals, regRows, stats] = await Promise.all([
      this.getWalletSummary(userId),
      AffiliateLink.find({ affiliateUser: userId }).select(
        "clickCount conversionCount isActive"
      ),
      uid
        ? Settlement.aggregate([
            { $match: { affiliateUser: uid, affiliateShare: { $gt: 0 } } },
            {
              $group: {
                _id: null,
                conversions: { $sum: 1 },
                revenue: { $sum: "$grossAmount" },
                commission: { $sum: "$affiliateShare" },
              },
            },
          ])
        : Promise.resolve([]),
      uid
        ? Order.aggregate([
            { $match: { affiliateUser: uid } },
            { $sort: { createdAt: 1 } },
            { $group: { _id: "$user", firstAt: { $first: "$createdAt" } } },
            { $group: { _id: null, count: { $sum: 1 } } },
          ])
        : Promise.resolve([]),
      this.getStats(userId, "30d"),
    ]);

    const totals = settlementTotals[0] || {};
    return {
      clicks: links.reduce((s, l) => s + (l.clickCount || 0), 0),
      registrations: (regRows[0] || {}).count || 0,
      conversions: totals.conversions || 0,
      revenue: totals.revenue || 0,
      commission: totals.commission || 0,
      activeLinks: links.filter((l) => l.isActive !== false).length,
      wallet,
      stats,
    };
  }

  /** GET /affiliates/wallet */
  async getWallet(userId) {
    return this.getWalletSummary(userId);
  }

  /**
   * GET /affiliates/commissions?limit=200&status=
   *
   * Settlement lines are the commission ledger: one row per order item with
   * the affiliate's share, HELD while escrow is pending and RELEASED once the
   * funds move to the wallet's available balance.
   */
  async listCommissions(userId, { limit = 200, status } = {}) {
    const query = { affiliateUser: userId, affiliateShare: { $gt: 0 } };
    const statusMap = { PENDING: "HELD", AVAILABLE: "RELEASED", PAID: "RELEASED" };
    if (status && String(status).trim()) {
      const key = String(status).trim().toUpperCase();
      if (key === "REVERSED") query.status = { $in: ["REFUNDED", "CANCELLED"] };
      else if (statusMap[key]) query.status = statusMap[key];
    }

    const capped = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
    const rows = await Settlement.find(query)
      .sort({ createdAt: -1 })
      .limit(capped)
      .populate("order", "orderNumber totalAmount affiliateCode");

    return rows.map((s) => ({
      _id: s._id,
      id: s._id,
      type: "SALE",
      status:
        s.status === "HELD" ? "PENDING" : s.status === "RELEASED" ? "AVAILABLE" : "REVERSED",
      order: s.order
        ? { _id: s.order._id, orderNumber: s.order.orderNumber }
        : null,
      orderNumber: s.order ? s.order.orderNumber : "",
      linkCode: s.order ? s.order.affiliateCode || "" : "",
      amount: s.affiliateShare,
      commissionAmount: s.affiliateShare,
      rate:
        s.grossAmount > 0
          ? Math.round((s.affiliateShare / s.grossAmount) * 10000) / 100
          : 0,
      orderTotal: s.grossAmount,
      notes: `Commission on settlement ${s.settlementReference}`,
      createdAt: s.createdAt,
      releasedAt: s.releasedAt || null,
    }));
  }

  /** GET /affiliates/campaigns?status=ACTIVE */
  async listCampaigns(userId, { status } = {}) {
    const query = {};
    if (status && String(status).toUpperCase() !== "ALL") {
      query.status = String(status).toUpperCase();
    }
    const campaigns = await AffiliateCampaign.find(query)
      .sort({ createdAt: -1 })
      .populate("products", "name price media");
    return this._mapCampaigns(userId, campaigns);
  }

  async _mapCampaigns(userId, campaigns) {
    if (!campaigns.length) return [];

    const links = await AffiliateLink.find({
      affiliateUser: userId,
      campaign: { $in: campaigns.map((c) => c._id) },
    });
    const linksByCampaign = new Map();
    links.forEach((l) => {
      const key = String(l.campaign);
      if (!linksByCampaign.has(key)) linksByCampaign.set(key, []);
      linksByCampaign.get(key).push(l);
    });

    let convAgg = [];
    if (links.length) {
      convAgg = await ConversionAudit.aggregate([
        { $match: { affiliateUser: this._oid(userId), link: { $in: links.map((l) => l._id) } } },
        {
          $group: {
            _id: "$link",
            conversions: { $sum: 1 },
            commission: { $sum: "$commissionEarned" },
          },
        },
      ]);
    }
    const convByLink = new Map(convAgg.map((c) => [String(c._id), c]));

    return campaigns.map((c) => {
      const campaignLinks = linksByCampaign.get(String(c._id)) || [];
      let clickCount = 0;
      let conversions = 0;
      let earnings = 0;
      campaignLinks.forEach((l) => {
        clickCount += l.clickCount || 0;
        const conv = convByLink.get(String(l._id));
        if (conv) {
          conversions += conv.conversions;
          earnings += conv.commission;
        } else {
          conversions += l.conversionCount || 0;
        }
      });

      return {
        _id: c._id,
        id: c._id,
        campaignCode: c.campaignCode,
        code: c.campaignCode,
        name: c.name,
        title: c.name,
        description: c.description || "",
        banner: c.banner || "",
        commissionRate: c.commissionRate || 0,
        status: c.status,
        startsAt: c.startsAt || null,
        endsAt: c.endsAt || null,
        productCount: (c.products || []).length,
        products: (c.products || []).map((p) => ({ _id: p._id, name: p.name })),
        joined: typeof c.isMember === "function" ? c.isMember(userId) : false,
        clickCount,
        conversionCount: conversions,
        earnings,
        createdAt: c.createdAt,
      };
    });
  }

  /** POST /affiliates/campaigns/:id/join */
  async joinCampaign(userId, campaignId) {
    if (!this._isValidId(campaignId)) throw new Error("Campaign not found.");
    const campaign = await AffiliateCampaign.findById(campaignId).populate(
      "products",
      "name price media"
    );
    if (!campaign) throw new Error("Campaign not found.");
    if (campaign.status !== "ACTIVE") {
      throw new Error("This campaign is not open for new affiliates.");
    }
    if (!campaign.isMember(userId)) {
      campaign.members.push({ affiliateUser: userId, joinedAt: new Date() });
      await campaign.save();
    }
    const [mapped] = await this._mapCampaigns(userId, [campaign]);
    return mapped;
  }

  /** GET /affiliates/notifications?limit=100 */
  async listNotifications(userId, { limit = 100 } = {}) {
    const capped = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const rows = await Notification.find({ recipient: userId })
      .sort({ createdAt: -1 })
      .limit(capped);

    const known = ["COMMISSION", "PAYOUT", "CAMPAIGN", "VERIFICATION", "SYSTEM"];
    return rows.map((n) => ({
      _id: n._id,
      id: n._id,
      type: known.includes(n.type)
        ? n.type
        : n.type === "PAYMENT"
        ? "COMMISSION"
        : "SYSTEM",
      title: n.title,
      message: n.message,
      // The app reads `read` / `status`, never the raw `isRead`.
      read: !!n.isRead,
      status: n.isRead ? "READ" : "UNREAD",
      amount: null,
      link: n.reference || "",
      createdAt: n.createdAt,
    }));
  }

  /** POST /affiliates/notifications/read-all | PATCH /affiliates/notifications/:id/read */
  async markNotificationsRead(userId, id = null) {
    if (id) {
      if (!this._isValidId(id)) throw new Error("Notification not found.");
      const result = await Notification.updateOne(
        { _id: id, recipient: userId },
        { $set: { isRead: true, readAt: new Date() } }
      );
      if (!result.matchedCount) throw new Error("Notification not found.");
      return { updated: result.modifiedCount };
    }
    const result = await Notification.updateMany(
      { recipient: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
    return { updated: result.modifiedCount };
  }
}

module.exports = new AffiliateService();