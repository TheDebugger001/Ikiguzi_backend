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
const Product = require("../models/Product");
const attribution = require("./affiliateAttribution.service");
const crypto = require("crypto");

const MINIMUM_PAYOUT_RWF = 10000;
const CURRENCY = "RWF";
const { PROMOTABLE_STATUSES } = attribution;
const CLICK_DEBOUNCE_MS = 10 * 1000;
// Payout states where the money has left availableBalance but is not withdrawn yet.
const IN_FLIGHT_PAYOUT = ["PENDING", "APPROVED", "PROCESSING"];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const WEB_ORIGIN = () => process.env.WEB_ORIGIN || "https://mvec.rw";

class AffiliateService {
  /**
   * Create a tracked link for one existing product.
   *
   * The product is validated here (exists + published), never trusted from the
   * client. Idempotent for bare product links so tapping "Create link" twice
   * does not litter the dashboard; labelled / campaign links are created fresh.
   * A terminated link never blocks creating a new one.
   */
  async generateAffiliateLink(userId, productId = null, campaignId = null, label = "") {
    if (!productId || !this._isValidId(productId)) {
      throw new Error("A valid product is required to create an affiliate link.");
    }
    const product = await Product.findById(productId).select("name price status media slug");
    if (!product) throw new Error("Product not found.");
    if (!PROMOTABLE_STATUSES.includes(product.status)) {
      throw new Error("This product is not available for promotion.");
    }
    if (campaignId) {
      if (!this._isValidId(campaignId)) throw new Error("Campaign not found.");
      const campaign = await AffiliateCampaign.findById(campaignId).select("status");
      if (!campaign) throw new Error("Campaign not found.");
      if (campaign.status !== "ACTIVE") throw new Error("This campaign is not open for new links.");
    }

    const cleanLabel = typeof label === "string" ? label.trim().slice(0, 120) : "";

    if (!campaignId && !cleanLabel) {
      const existing = await AffiliateLink.findOne({
        affiliateUser: userId,
        targetProduct: product._id,
        campaign: null,
        status: { $ne: "TERMINATED" },
      }).populate("targetProduct", "name price status media");
      if (existing) return existing;
    }

    const code = `AFF-${userId.toString().slice(-4)}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    const link = await AffiliateLink.create({
      affiliateCode: code,
      affiliateUser: userId,
      targetProduct: product._id,
      campaign: campaignId || null,
      label: cleanLabel,
    });

    await link.populate("targetProduct", "name price status media");
    return link;
  }

  /**
   * Resolve a link, record the click server-side and (when it promotes a
   * product) refresh the visitor's last-click attribution.
   *
   * Only ACTIVE links count. Repeats from the same visitor on the same link
   * within CLICK_DEBOUNCE_MS (refresh, double fire) are not counted again.
   * `visitorId` is minted here when the browser has none.
   */
  async trackClick(affiliateCode, { visitorIp = "", visitorId = null, buyerUserId = null } = {}) {
    const code = typeof affiliateCode === "string" ? affiliateCode.trim() : "";
    const link = code
      ? await AffiliateLink.findOne({ affiliateCode: code, isActive: true, status: { $ne: "TERMINATED" } })
          .populate("targetProduct", "name slug status")
      : null;
    if (!link) throw new Error("Invalid or inactive affiliate link.");

    const vid = attribution.cleanVisitorId(visitorId) || attribution.mintVisitorId();
    const product = link.targetProduct
      ? { id: link.targetProduct._id, slug: link.targetProduct.slug, name: link.targetProduct.name }
      : null;
    const base = { success: true, visitorId: vid, affiliateCode: link.affiliateCode, targetProduct: product };

    // Fraud Guard: an affiliate cannot earn from their own visits.
    if (buyerUserId && link.affiliateUser.toString() === buyerUserId.toString()) {
      return { FraudGuardFlagged: true, reason: "Self-referral blocked", visitorId: vid, targetProduct: product };
    }

    const now = new Date();
    const recent = await AffiliateClick.exists({
      link: link._id,
      visitorId: vid,
      createdAt: { $gt: new Date(now.getTime() - CLICK_DEBOUNCE_MS) },
    });
    if (recent) {
      // Not counted again, but the visitor may have clicked another affiliate's
      // link in between: the latest link must still win the attribution.
      await attribution.recordClickAttribution({ visitorId: vid, link, now });
      return base;
    }

    await AffiliateClick.create({
      affiliateUser: link.affiliateUser,
      link: link._id,
      affiliateCode: link.affiliateCode,
      buyerUser: buyerUserId || null,
      // Hashed: enough to spot abuse, not a stored address.
      visitorIp: visitorIp
        ? crypto.createHash("sha256").update(`${visitorIp}|${process.env.JWT_SECRET || ""}`).digest("hex").slice(0, 24)
        : "",
      product: link.targetProduct ? link.targetProduct._id : null,
      visitorId: vid,
    });
    await AffiliateLink.updateOne({ _id: link._id }, { $inc: { clickCount: 1 }, $set: { lastClickedAt: now } });

    await attribution.recordClickAttribution({ visitorId: vid, link, now });
    return base;
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
    amount = Number(amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter the amount you want to withdraw.");
    // Mobile money withdrawals must go to a valid number on the matching network.
    if (["MTN_MOMO", "AIRTEL_MONEY"].includes(paymentMethod)) {
      const { formatRwandanPhone } = require("../utils/momo.util");
      const info = formatRwandanPhone(accountDetails?.phoneNumber);
      if (!info) throw new Error("Enter a valid Rwandan mobile money number.");
      if ((paymentMethod === "MTN_MOMO") !== (info.provider === "MTN")) {
        throw new Error(`That is ${info.provider === "MTN" ? "an MTN" : "an Airtel"} number. Choose the matching payment method.`);
      }
      accountDetails = { ...accountDetails, phoneNumber: info.formattedNumber };
    } else if (paymentMethod !== "BANK_TRANSFER") {
      throw new Error("Choose MTN MoMo, Airtel Money or bank transfer.");
    }
    if (amount < MINIMUM_PAYOUT_RWF) {
      throw new Error(`Minimum withdrawal threshold is RWF ${MINIMUM_PAYOUT_RWF.toLocaleString()}. Requested: RWF ${amount.toLocaleString()}`);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Lock available balance into pending payout status. One guarded atomic
      // decrement: two concurrent requests can never both spend the same funds.
      const debited = await AffiliateWallet.findOneAndUpdate(
        { affiliateUser: userId, availableBalance: { $gte: amount } },
        { $inc: { availableBalance: -amount } },
        { returnDocument: "after", session }
      );
      if (!debited) throw new Error("Insufficient available balance for withdrawal.");

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

      // Small mobile money withdrawals are sent automatically; larger ones and
      // bank transfers wait for an admin (who approves with one click).
      const autoLimit = Number(process.env.AFFILIATE_AUTO_PAYOUT_MAX || 100000);
      const created = payout[0];
      if (created.paymentMethod !== "BANK_TRANSFER" && created.amount <= autoLimit) {
        await this._sendPayout(created).catch((err) => console.error(`Affiliate payout ${created._id} send failed:`, err.message));
      } else {
        const notifications = require("./notification.service");
        const User = require("../models/User");
        const admins = await User.find({ role: "super_admin" }).select("_id").lean();
        for (const a of admins) {
          notifications.notify(a._id, {
            type: "PAYOUT",
            title: "Affiliate withdrawal needs approval",
            message: `RWF ${created.amount.toLocaleString()} via ${created.paymentMethod.replace("_", " ").toLowerCase()}.`,
            reference: created.payoutNumber,
            link: "/admin/affiliates",
          }).catch(() => {});
        }
      }
      return AffiliatePayout.findById(created._id);
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

      const isMobile = payout.paymentMethod !== "BANK_TRANSFER";
      if ((status === "APPROVED" || status === "COMPLETED") && isMobile) {
        // Approving a mobile money withdrawal sends it through Paypack.
        payout.status = "PROCESSING";
        payout.approvedBy = adminId;
        await payout.save({ session });
        await session.commitTransaction();
        session.endSession();
        try {
          await this._sendPayout(payout);
        } catch (sendError) {
          // The transfer worker retries; the approval itself is already saved.
          console.error(`Affiliate payout ${payout._id} send failed:`, sendError.message);
        }
        return AffiliatePayout.findById(payout._id);
      }
      if (status === "COMPLETED") {
        if (!transactionReference) throw new Error("Enter the bank transfer reference.");
        payout.status = "COMPLETED";
        payout.transactionReference = transactionReference;
        payout.approvedBy = adminId;
        await AffiliateWallet.updateOne(
          { affiliateUser: payout.affiliateUser },
          { $inc: { totalWithdrawn: payout.amount } },
          { session }
        );
      } else if (status === "REJECTED") {
        payout.status = "REJECTED";
        payout.rejectionReason = rejectionReason || "Admin rejected payout request";
        // Revert funds back to available balance
        await AffiliateWallet.updateOne(
          { affiliateUser: payout.affiliateUser },
          { $inc: { availableBalance: payout.amount } },
          { session }
        );
      }

      await payout.save({ session });

      await session.commitTransaction();
      session.endSession();

      return payout;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /** Send an approved mobile money withdrawal through Paypack. */
  async _sendPayout(payout) {
    await AffiliatePayout.updateOne({ _id: payout._id }, { $set: { status: "PROCESSING" } });
    const disbursementService = require("./disbursement.service");
    await disbursementService.queue({
      kind: "AFFILIATE_PAYOUT",
      recipient: payout.affiliateUser,
      phone: payout.accountDetails?.phoneNumber,
      amount: payout.amount,
      affiliatePayout: payout._id,
      idempotencyKey: `affiliate-payout:${payout._id}`,
    });
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
        pendingPayout: wallet.pendingPayout || 0,
        totalEarned: wallet.totalEarned,
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
    const [links, wallets, inFlight] = await Promise.all([
      AffiliateLink.find({}).select("affiliateUser clickCount conversionCount"),
      AffiliateWallet.find({}),
      AffiliatePayout.find({ status: { $in: IN_FLIGHT_PAYOUT } }).select("affiliateUser amount"),
    ]);
    const inFlightByUser = {};
    inFlight.forEach((p) => {
      const id = String(p.affiliateUser);
      inFlightByUser[id] = (inFlightByUser[id] || 0) + (p.amount || 0);
    });

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
      const earned =
        (w ? (w.availableBalance || 0) + (w.pendingBalance || 0) + (w.totalWithdrawn || 0) : 0) +
        (inFlightByUser[String(u._id)] || 0);
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
    const [wallet, lastPayout, inFlight] = await Promise.all([
      AffiliateWallet.findOne({ affiliateUser: userId }),
      AffiliatePayout.findOne({ affiliateUser: userId, status: "COMPLETED" }).sort({ updatedAt: -1 }),
      AffiliatePayout.find({ affiliateUser: userId, status: { $in: IN_FLIGHT_PAYOUT } }).select("amount"),
    ]);
    const available = wallet ? wallet.availableBalance || 0 : 0;
    const pending = wallet ? wallet.pendingBalance || 0 : 0;
    const withdrawn = wallet ? wallet.totalWithdrawn || 0 : 0;
    // Requested but not yet paid out: left availableBalance, not yet withdrawn.
    const pendingPayout = round2(inFlight.reduce((sum, p) => sum + (p.amount || 0), 0));
    return {
      availableBalance: available,
      pendingBalance: pending,
      pendingPayout,
      totalWithdrawn: withdrawn,
      totalEarned: round2(available + pending + pendingPayout + withdrawn),
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
    const rawName = body.fullName !== undefined ? body.fullName : body.Fullname;
    const email = body.email;

    // Name and phone are mandatory on the affiliate profile: they may be
    // omitted from a partial update, but never blanked or left invalid.
    let userChanged = false;
    if (rawName !== undefined) {
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (name.length < 2 || name.length > 120) {
        throw new Error("Please enter your full name (2 to 120 characters).");
      }
      user.Fullname = name;
      userChanged = true;
    }
    if (phone !== undefined) {
      const normalized = normalizePhone(phone);
      if (!normalized) throw new Error(describePhoneIssue(phone));
      user.phone = normalized;
      userChanged = true;
    }
    if (email !== undefined) {
      const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
      if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error("Please enter a valid email address or leave it empty.");
      }
      if (normalizedEmail && normalizedEmail !== user.email) {
        const taken = await User.exists({ email: normalizedEmail, _id: { $ne: user._id } });
        if (taken) throw new Error("Another account already uses this email.");
      }
      user.email = normalizedEmail || undefined;
      userChanged = true;
    }
    if (userChanged) {
      if (!user.Fullname || !user.phone) throw new Error("Full name and phone number are required.");
      try {
        await user.save();
      } catch (err) {
        if (err && err.code === 11000) {
          throw new Error("An account with this phone number or email already exists.");
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

  /** Commission that still stands after refund reversals. */
  _net(row) {
    return round2((row.commissionEarned || 0) - (row.reversedAmount || 0));
  }

  _mapLink(link, stats = {}) {
    const product = link.targetProduct;
    const terminated = link.status === "TERMINATED" || link.isActive === false;
    return {
      _id: link._id,
      id: link._id,
      affiliateCode: link.affiliateCode,
      code: link.affiliateCode,
      label: link.label || "",
      targetProductId: product ? String(product._id) : null,
      targetProduct: product
        ? { _id: product._id, name: product.name, price: product.price, media: product.media, status: product.status }
        : null,
      campaign: link.campaign || null,
      status: terminated ? "TERMINATED" : "ACTIVE",
      isActive: !terminated,
      clickCount: stats.clicks || 0,
      uniqueVisitors: stats.unique || 0,
      conversionCount: stats.conversions || 0,
      successfulCount: stats.successful || 0,
      commissionEarned: stats.commission || 0,
      revenue: stats.revenue || 0,
      createdAt: link.createdAt,
      terminatedAt: link.terminatedAt || null,
      lastClickedAt: stats.lastClickedAt || link.lastClickedAt || null,
    };
  }

  /** Per-link click and conversion totals (single source: AffiliateClick + ConversionAudit). */
  async _linkStats(uid, since = null) {
    const clickMatch = { affiliateUser: uid };
    const convMatch = { affiliateUser: uid, status: { $ne: "REJECTED" } };
    if (since) {
      clickMatch.createdAt = { $gte: since };
      convMatch.convertedAt = { $gte: since };
    }
    const [clickRows, convDocs] = await Promise.all([
      AffiliateClick.aggregate([
        { $match: clickMatch },
        {
          $group: {
            _id: "$link",
            clicks: { $sum: 1 },
            visitors: { $addToSet: "$visitorId" },
            lastClickedAt: { $max: "$createdAt" },
          },
        },
      ]),
      // Summed in JS: the arithmetic ($subtract/$cond) is not portable to the
      // MySQL compatibility layer's aggregation evaluator.
      ConversionAudit.find(convMatch)
        .select("link status commissionEarned reversedAmount conversionValue")
        .lean(),
    ]);
    const byLink = new Map();
    for (const c of convDocs) {
      const key = String(c.link);
      const row = byLink.get(key) || { _id: c.link, conversions: 0, commission: 0, revenue: 0, successful: 0 };
      const net = this._net(c);
      row.conversions += 1;
      row.commission += net;
      row.revenue += c.status === "REVERSED" ? 0 : c.conversionValue || 0;
      // Delivered (approved) and not fully refunded.
      if (["APPROVED", "PAID"].includes(c.status) && net > 0) row.successful += 1;
      byLink.set(key, row);
    }
    const convRows = [...byLink.values()];
    const map = new Map();
    clickRows.forEach((r) =>
      map.set(String(r._id), {
        clicks: r.clicks,
        unique: r.visitors.filter(Boolean).length,
        lastClickedAt: r.lastClickedAt,
      })
    );
    convRows.forEach((r) =>
      map.set(String(r._id), {
        ...(map.get(String(r._id)) || {}),
        conversions: r.conversions,
        commission: round2(r.commission),
        revenue: r.revenue,
        successful: r.successful,
      })
    );
    return map;
  }

  /** GET /affiliates/links?status=&q= */
  async listLinks(userId, { status, q } = {}) {
    const uid = this._oid(userId);
    if (!uid) throw new Error("User not found.");
    const query = { affiliateUser: uid };
    const wanted = String(status || "").toUpperCase();
    if (wanted === "ACTIVE") query.status = { $ne: "TERMINATED" };
    if (wanted === "TERMINATED") query.status = "TERMINATED";

    const [links, stats] = await Promise.all([
      AffiliateLink.find(query)
        .sort({ createdAt: -1 })
        .populate("targetProduct", "name price status media"),
      this._linkStats(uid),
    ]);

    const needle = String(q || "").trim().toLowerCase();
    return links
      .map((l) => this._mapLink(l, stats.get(String(l._id))))
      .filter((l) => !needle || `${l.label} ${l.code} ${l.targetProduct?.name || ""}`.toLowerCase().includes(needle));
  }

  /** PATCH /affiliates/links/:id — relabel, or terminate with { isActive: false }. */
  async updateLink(userId, linkId, patch = {}) {
    if (!this._isValidId(linkId)) throw new Error("Affiliate link not found.");
    const link = await AffiliateLink.findOne({ _id: linkId, affiliateUser: userId }).populate(
      "targetProduct",
      "name price status media"
    );
    if (!link) throw new Error("Affiliate link not found.");

    if (patch.isActive === true && link.status === "TERMINATED") {
      throw new Error("A terminated link cannot be reactivated. Create a new link instead.");
    }
    if (patch.isActive === false) await this._terminate(link);
    if (patch.label !== undefined && patch.label !== null) link.label = String(patch.label).trim().slice(0, 120);
    await link.save();

    return this._mapLink(link);
  }

  async _terminate(link) {
    if (link.status === "TERMINATED") return;
    link.status = "TERMINATED";
    link.isActive = false;
    link.terminatedAt = new Date();
  }

  /**
   * DELETE /affiliates/links/:id — terminates (never deletes). Clicks,
   * attributions already established and commission history are kept.
   */
  async removeLink(userId, linkId) {
    if (!this._isValidId(linkId)) throw new Error("Affiliate link not found.");
    const link = await AffiliateLink.findOne({ _id: linkId, affiliateUser: userId });
    if (!link) throw new Error("Affiliate link not found.");
    await this._terminate(link);
    await link.save();
    return { terminated: true, id: link._id, status: link.status, terminatedAt: link.terminatedAt };
  }

  /** Commission buckets from the single commission ledger (ConversionAudit). */
  async _commissionTotals(uid) {
    const rows = await ConversionAudit.aggregate([
      { $match: { affiliateUser: uid, status: { $ne: "REJECTED" } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          orders: { $addToSet: "$order" },
          gross: { $sum: "$commissionEarned" },
          reversed: { $sum: "$reversedAmount" },
          revenue: { $sum: "$conversionValue" },
        },
      },
    ]);
    const t = { conversions: 0, gross: 0, reversed: 0, pending: 0, approved: 0, revenue: 0 };
    const orders = new Set();
    rows.forEach((r) => {
      t.conversions += r.count;
      t.gross += r.gross;
      t.reversed += r.reversed;
      r.orders.forEach((o) => orders.add(String(o)));
      const net = r.gross - r.reversed;
      if (r._id === "PENDING") t.pending += net;
      if (r._id === "APPROVED" || r._id === "PAID") t.approved += net;
      if (r._id !== "REVERSED") t.revenue += r.revenue;
    });
    return {
      conversions: t.conversions,
      attributedOrders: orders.size,
      revenue: t.revenue,
      grossCommission: round2(t.gross),
      reversedCommission: round2(t.reversed),
      netCommission: round2(t.gross - t.reversed),
      pendingCommission: round2(t.pending),
      approvedCommission: round2(t.approved),
    };
  }

  /**
   * GET /affiliates/stats?range=7d
   * Time series and range totals; every number comes from AffiliateClick and
   * ConversionAudit rows, so nothing is counted twice.
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
    const day = (field) => ({ $dateToString: { format: "%Y-%m-%d", date: field } });

    const [clickRows, convRows, visitorRows, links, linkStats] = await Promise.all([
      AffiliateClick.aggregate([
        { $match: { affiliateUser: uid, createdAt: { $gte: since } } },
        { $group: { _id: day("$createdAt"), count: { $sum: 1 } } },
      ]),
      ConversionAudit.find({ affiliateUser: uid, status: { $ne: "REJECTED" }, convertedAt: { $gte: since } })
        .select("convertedAt status conversionValue commissionEarned reversedAmount")
        .lean(),
      AffiliateClick.aggregate([
        { $match: { affiliateUser: uid, createdAt: { $gte: since } } },
        { $group: { _id: "$visitorId" } },
        { $match: { _id: { $ne: "" } } },
        { $count: "unique" },
      ]),
      AffiliateLink.find({ affiliateUser: uid }).populate("targetProduct", "name price status media"),
      this._linkStats(uid, since),
    ]);

    const clicksSeries = new Array(days).fill(0);
    const convSeries = new Array(days).fill(0);
    const commissionSeries = new Array(days).fill(0);
    let revenue = 0;
    let commission = 0;
    clickRows.forEach((r) => {
      const i = index.get(r._id);
      if (i !== undefined) clicksSeries[i] += r.count;
    });
    convRows.forEach((r) => {
      const i = index.get(this._dayKey(r.convertedAt));
      if (i !== undefined) {
        const net = this._net(r);
        convSeries[i] += 1;
        commissionSeries[i] = round2(commissionSeries[i] + net);
        revenue += r.status === "REVERSED" ? 0 : r.conversionValue || 0;
        commission += net;
      }
    });

    const topLinks = links
      .map((l) => this._mapLink(l, linkStats.get(String(l._id))))
      .sort((a, b) => b.commissionEarned - a.commissionEarned || b.clickCount - a.clickCount)
      .slice(0, 10);

    return {
      range: `${days}d`,
      days,
      clicks: clicksSeries.reduce((s, v) => s + v, 0),
      uniqueVisitors: (visitorRows[0] || {}).unique || 0,
      conversions: convSeries.reduce((s, v) => s + v, 0),
      revenue,
      commission: round2(commission),
      activeLinks: links.filter((l) => l.status !== "TERMINATED" && l.isActive !== false).length,
      labels,
      series: { labels, clicks: clicksSeries, conversions: convSeries, commission: commissionSeries },
      topLinks,
    };
  }

  /** GET /affiliates/overview — one payload for the dashboard home. */
  async getOverview(userId) {
    const uid = this._oid(userId);
    if (!uid) throw new Error("User not found.");
    const [wallet, linkRows, clickTotals, totals, recent, stats, clickedLinks, successfulLinks] = await Promise.all([
      this.getWalletSummary(userId),
      AffiliateLink.find({ affiliateUser: uid }).select("status isActive"),
      AffiliateClick.aggregate([
        { $match: { affiliateUser: uid } },
        { $group: { _id: null, clicks: { $sum: 1 }, visitors: { $addToSet: "$visitorId" } } },
      ]),
      this._commissionTotals(uid),
      this.getRecentConversions(userId, 10),
      this.getStats(userId, "30d"),
      // Links that received at least one real click.
      AffiliateClick.distinct("link", { affiliateUser: uid, link: { $ne: null } }),
      // Successful = clicked, ordered AND delivered (commission approved and
      // not fully refunded). Terminated links keep counting: history is kept.
      ConversionAudit.find({ affiliateUser: uid, link: { $ne: null }, status: { $in: ["APPROVED", "PAID"] } })
        .select("link commissionEarned reversedAmount")
        .lean()
        .then((rows) => [...new Set(rows.filter((r) => this._net(r) > 0).map((r) => String(r.link)))]),
    ]);

    const click = clickTotals[0] || { clicks: 0, visitors: [] };
    const terminated = linkRows.filter((l) => l.status === "TERMINATED" || l.isActive === false).length;
    return {
      links: {
        total: linkRows.length,
        created: linkRows.length,
        clicked: clickedLinks.length,
        successful: successfulLinks.length,
        active: linkRows.length - terminated,
        terminated,
      },
      clicks: click.clicks,
      uniqueVisitors: click.visitors.filter(Boolean).length,
      conversions: totals.conversions,
      attributedOrders: totals.attributedOrders,
      conversionRate: click.clicks ? Math.round((totals.attributedOrders / click.clicks) * 10000) / 100 : 0,
      revenue: totals.revenue,
      commission: {
        gross: totals.grossCommission,
        reversed: totals.reversedCommission,
        net: totals.netCommission,
        pending: totals.pendingCommission,
        approved: totals.approvedCommission,
        paid: wallet.totalWithdrawn,
      },
      wallet,
      recent,
      stats,
    };
  }

  /** Latest attributed order items with their commission state. */
  async getRecentConversions(userId, limit = 10) {
    const rows = await ConversionAudit.find({ affiliateUser: userId, status: { $ne: "REJECTED" } })
      .sort({ convertedAt: -1 })
      .limit(Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100))
      .populate("targetProduct", "name")
      .populate("order", "orderNumber");
    return rows.map((c) => this._mapConversion(c));
  }

  _mapConversion(c) {
    return {
      _id: c._id,
      id: c._id,
      type: "SALE",
      status: c.status,
      orderNumber: c.order?.orderNumber || "",
      order: c.order ? { _id: c.order._id, orderNumber: c.order.orderNumber } : null,
      product: c.targetProduct?.name || "Product",
      linkCode: c.referralCode || "",
      quantity: c.quantity || 1,
      orderTotal: c.conversionValue,
      amount: this._net(c),
      commissionAmount: c.commissionEarned,
      reversedAmount: c.reversedAmount || 0,
      rate: c.conversionValue > 0 ? Math.round((c.commissionEarned / c.conversionValue) * 10000) / 100 : 0,
      createdAt: c.convertedAt || c.createdAt,
    };
  }

  /** GET /affiliates/wallet */
  async getWallet(userId) {
    return this.getWalletSummary(userId);
  }

  /**
   * GET /affiliates/commissions?limit=200&status=
   * One row per attributed order item. Statuses: PENDING (escrow held),
   * APPROVED (released to the wallet), REVERSED (refunded). Partial refunds
   * keep the original status and show `reversedAmount`.
   */
  async listCommissions(userId, { limit = 200, status } = {}) {
    const query = { affiliateUser: userId, status: { $ne: "REJECTED" } };
    const key = String(status || "").trim().toUpperCase();
    if (["PENDING", "APPROVED", "REVERSED"].includes(key)) query.status = key;

    const capped = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
    const rows = await ConversionAudit.find(query)
      .sort({ convertedAt: -1 })
      .limit(capped)
      .populate("targetProduct", "name")
      .populate("order", "orderNumber");
    return rows.map((c) => this._mapConversion(c));
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