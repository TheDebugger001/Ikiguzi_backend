const mongoose = require("mongoose");
const Subscription = require("../models/Subscription");
const BuyerSubscription = require("../models/BuyerSubscription");
const Advertisement = require("../models/Advertisement");
const Vendor = require("../models/Vendor");
const Product = require("../models/Product");

// ─── DISPLAY / DICTIONARY HELPERS ────────────────────────────────────────────
// All mapping constants keep the backend "friendly" values in sync with the
// already-implemented frontend pages (FeaturePages / SmartTable rows).

const SUBSCRIPTION_TIERS = [
  { key: "FREE", name: "Free", price: 0, billing: "Free" },
  { key: "PREMIUM", name: "Vendor Premium", price: 15000, billing: "Monthly" },
];

const AD_PLACEMENTS = {
  HOMEPAGE_HERO: "Homepage hero",
  CATEGORY_BANNER: "Category banner",
  SEARCH_RESULTS: "Search results",
  FEATURED: "Featured",
  PROMOTION: "Promotion",
};

const AD_PLACEMENT_LOOKUP = Object.fromEntries(
  Object.entries(AD_PLACEMENTS).map(([key, label]) => [
    label.toLowerCase(),
    key,
  ])
);

const AD_STATUS_LABEL = {
  PENDING: "Scheduled",
  ACTIVE: "Active",
  PAUSED: "Paused",
  REJECTED: "Rejected",
  COMPLETED: "Completed",
};

const SUB_STATUS_LABEL = {
  ACTIVE: "Active",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB") : "—"; // DD/MM/YYYY

const normalizePlan = (plan) => {
  const p = String(plan || "").trim().toUpperCase();
  if (p === "PREMIUM" || p === "VENDOR PREMIUM" || p === "1") return "PREMIUM";
  return "FREE";
};

const normalizePlacement = (placement) => {
  const p = String(placement || "").trim();
  if (AD_PLACEMENTS[p]) return p;
  return AD_PLACEMENT_LOOKUP[p.toLowerCase()] || "SEARCH_RESULTS";
};

const resolveVendor = async (userId) => {
  const vendor = await Vendor.findOne({ user: userId });
  return vendor;
};

const mapSubscription = (sub, holder = "") => ({
  id: sub?.publicId,
  planKey: sub?.plan || "FREE",
  plan:
    sub?.plan === "PREMIUM"
      ? "Vendor Premium"
      : "Free",
  holder,
  price: sub?.price || 0,
  billing:
    sub?.billingCycle === "YEARLY"
      ? "Yearly"
      : sub?.billingCycle === "MONTHLY"
        ? "Monthly"
        : "Free",
  renewal: sub ? fmtDate(sub.renewalDate) : "—",
  status: sub
    ? SUB_STATUS_LABEL[sub.status] || "Active"
    : "Available",
});

const buildTierRows = (subscription, holder) => {
  const activeKey = subscription?.status === "ACTIVE" ? subscription.plan : null;
  return SUBSCRIPTION_TIERS.map((tier) => ({
    id: `TIER-${tier.key}`,
    planKey: tier.key,
    plan: tier.name,
    holder,
    price: tier.price,
    billing: tier.billing,
    renewal:
      activeKey === tier.key && subscription?.renewalDate
        ? fmtDate(subscription.renewalDate)
        : "—",
    status: activeKey === tier.key ? "Active" : "Available",
  }));
};

const BuyerSubscriptionTier = {
  FREE: { key: "FREE", name: "Free", price: 0, billing: "Free" },
  PREMIUM: { key: "PREMIUM", name: "Buyer Ad Removal", price: 5000, billing: "Monthly" },
};

const mapBuyerSubscription = (sub) => ({
  id: sub?.publicId,
  planKey: sub?.plan || "FREE",
  plan: sub?.plan === "PREMIUM" ? "Buyer Ad Removal" : "Free",
  price: sub?.price || 0,
  billing:
    sub?.billingCycle === "YEARLY"
      ? "Yearly"
      : sub?.billingCycle === "MONTHLY"
        ? "Monthly"
        : "Free",
  renewal: sub && sub.renewalDate ? fmtDate(sub.renewalDate) : "—",
  status: sub ? SUB_STATUS_LABEL[sub.status] || "Active" : "Available",
});

const buildBuyerTierRows = (subscription) => {
  const activeKey = subscription?.status === "ACTIVE" ? subscription.plan : null;
  return Object.values(BuyerSubscriptionTier).map((tier) => ({
    id: `TIER-${tier.key}`,
    planKey: tier.key,
    plan: tier.name,
    price: tier.price,
    billing: tier.billing,
    renewal:
      activeKey === tier.key && subscription?.renewalDate
        ? fmtDate(subscription.renewalDate)
        : "—",
    status: activeKey === tier.key ? "Active" : "Available",
  }));
};

const mapAdvertisement = (ad) => ({
  id: ad.publicId,
  // Database id: what the status endpoints expect in the URL.
  _id: String(ad._id),
  placementKey: ad.placement,
  product: ad.product,
  productId: ad.productId,
  placement: AD_PLACEMENTS[ad.placement] || ad.placement,
  budget: ad.budget,
  startDate: fmtDate(ad.startDate),
  endDate: ad.endDate ? fmtDate(ad.endDate) : "—",
  clicks: ad.clicks,
  impressions: ad.impressions,
  ctr: ad.impressions
    ? `${((ad.clicks / ad.impressions) * 100).toFixed(1)}%`
    : "—",
  status: AD_STATUS_LABEL[ad.status] || ad.status,
  statusKey: ad.status,
});

// ════════════════════════════════════════════════════════════════════════════
// VENDOR · SUBSCRIPTION
// ════════════════════════════════════════════════════════════════════════════

// @desc    View the vendor's current subscription and available tiers
// @route   GET /api/vendor/subscription
// @access  Private (vendor)
exports.getVendorSubscription = async (req, res) => {
  try {
    const vendor = await resolveVendor(req.user.id);
    if (!vendor) {
      return res
        .status(404)
        .json({ message: "Vendor profile not found. Please complete onboarding." });
    }

    const subscription = await Subscription.findOne({ vendor: req.user.id });

    return res.status(200).json({
      subscription: subscription ? mapSubscription(subscription, vendor.businessName) : null,
      tiers: buildTierRows(subscription, vendor.businessName),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Upgrade / downgrade the vendor freemium subscription tier
// @route   POST /api/vendor/subscription
// @access  Private (vendor)
exports.upgradeVendorSubscription = async (req, res) => {
  try {
    const vendor = await resolveVendor(req.user.id);
    if (!vendor) {
      return res
        .status(404)
        .json({ message: "Vendor profile not found. Please complete onboarding." });
    }

    const plan = normalizePlan(req.body.plan);
    let subscription = await Subscription.findOne({ vendor: req.user.id });

    if (plan === "PREMIUM") {
      const tier = SUBSCRIPTION_TIERS.find((t) => t.key === "PREMIUM");
      if (!subscription) {
        subscription = new Subscription({ vendor: req.user.id });
      }
      subscription.plan = "PREMIUM";
      subscription.status = "ACTIVE";
      subscription.price = tier.price;
      subscription.billingCycle = "MONTHLY";
      subscription.autoRenew = req.body.autoRenew !== false;
      if (!subscription.startDate) subscription.startDate = new Date();
      subscription.renewalDate = new Date(
        subscription.startDate.getTime() + 30 * 24 * 60 * 60 * 1000
      );
      await subscription.save();
    } else {
      if (subscription) {
        subscription.plan = "FREE";
        subscription.status = "ACTIVE";
        subscription.price = 0;
        subscription.billingCycle = "FREE";
        subscription.renewalDate = null;
        await subscription.save();
      }
    }

    return res.status(200).json({
      message:
        plan === "PREMIUM"
          ? "Vendor Premium activated successfully."
          : "Downgraded to the Free plan.",
      subscription: mapSubscription(subscription, vendor.businessName),
      tiers: buildTierRows(subscription, vendor.businessName),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// BUYER · SUBSCRIPTION (AD REMOVAL)
// ════════════════════════════════════════════════════════════════════════════

// @desc    View the buyer's current ad-removal subscription and tiers
// @route   GET /api/buyer/subscription
// @access  Private (buyer)
exports.getBuyerSubscription = async (req, res) => {
  try {
    const subscription = await BuyerSubscription.findOne({ buyer: req.user.id });

    return res.status(200).json({
      subscription: subscription ? mapBuyerSubscription(subscription) : null,
      tiers: buildBuyerTierRows(subscription),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Upgrade / cancel the buyer's premium ad-removal plan
// @route   POST /api/buyer/subscription
// @access  Private (buyer)
exports.upgradeBuyerSubscription = async (req, res) => {
  try {
    const plan = normalizePlan(req.body.plan);
    let subscription = await BuyerSubscription.findOne({ buyer: req.user.id });

    // Premium is a paid plan. Until it has a payment step, buyers cannot
    // switch it on themselves (otherwise anyone gets it for free).
    if (plan === "PREMIUM" && !(subscription?.plan === "PREMIUM" && subscription?.status === "ACTIVE")) {
      return res.status(402).json({
        message: "Premium checkout is not available yet. You have not been charged.",
      });
    }

    if (plan === "PREMIUM") {
      const tier = BuyerSubscriptionTier.PREMIUM;
      if (!subscription) {
        subscription = new BuyerSubscription({ buyer: req.user.id });
      }
      subscription.plan = "PREMIUM";
      subscription.status = "ACTIVE";
      subscription.price = tier.price;
      subscription.billingCycle = "MONTHLY";
      subscription.autoRenew = req.body.autoRenew !== false;
      if (!subscription.startDate) subscription.startDate = new Date();
      subscription.renewalDate = new Date(
        subscription.startDate.getTime() + 30 * 24 * 60 * 60 * 1000
      );
      await subscription.save();
    } else {
      if (subscription) {
        subscription.plan = "FREE";
        subscription.status = "ACTIVE";
        subscription.price = 0;
        subscription.billingCycle = "FREE";
        subscription.renewalDate = null;
        await subscription.save();
      }
    }

    return res.status(200).json({
      message:
        plan === "PREMIUM"
          ? "Buyer Ad Removal activated successfully."
          : "Premium buyer plan cancelled.",
      subscription: mapBuyerSubscription(subscription),
      tiers: buildBuyerTierRows(subscription),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Admin list all buyer ad-removal subscriptions
// @route   GET /api/admin/subscriptions?role=buyer
// @access  Private (super_admin)
exports.adminListBuyerSubscriptions = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (status) filter.status = status;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(parseInt(limit, 10) || 50, 200);
    const skip = (pageNum - 1) * limitNum;

    let [subscriptions, total] = await Promise.all([
      BuyerSubscription.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("buyer", "Fullname email"),
      BuyerSubscription.countDocuments(filter),
    ]);

    if (search) {
      const term = new RegExp(search, "i");
      subscriptions = subscriptions.filter(
        (s) => term.test(s.buyer?.Fullname || "") || term.test(s.publicId || "")
      );
    }

    const rows = subscriptions.map((sub) => ({
      ...mapBuyerSubscription(sub),
      holder: sub.buyer?.Fullname || "—",
      type: sub.plan === "PREMIUM" ? "Buyer Ad Removal" : "Free",
    }));

    return res
      .status(200)
      .json({ data: rows, meta: { page: pageNum, limit: limitNum, total } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// VENDOR · ADVERTISEMENTS
// ════════════════════════════════════════════════════════════════════════════

// @desc    List the vendor's ad placement campaigns
// @route   GET /api/vendor/advertisements
// @access  Private (vendor)
exports.getMyAdvertisements = async (req, res) => {
  try {
    const vendor = await resolveVendor(req.user.id);
    if (!vendor) {
      return res
        .status(404)
        .json({ message: "Vendor profile not found. Please complete onboarding." });
    }

    const ads = await Advertisement.find({ vendor: vendor._id }).sort({
      createdAt: -1,
    });

    return res.status(200).json({
      data: ads.map(mapAdvertisement),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Submit an ad placement campaign
// @route   POST /api/vendor/advertisements
// @access  Private (vendor)
exports.createAdvertisement = async (req, res) => {
  try {
    const vendor = await resolveVendor(req.user.id);
    if (!vendor) {
      return res
        .status(404)
        .json({ message: "Vendor profile not found. Please complete onboarding." });
    }

    const { product, placement, budget, startDate, endDate, productId } = req.body;

    if (!product) {
      return res.status(400).json({ message: "product is required" });
    }
    if (budget === undefined || budget === null || !Number.isFinite(Number(budget)) || Number(budget) <= 0) {
      return res.status(400).json({ message: "Enter a budget greater than zero." });
    }
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : null;
    if (Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime()))) {
      return res.status(400).json({ message: "Enter valid campaign dates." });
    }
    if (end && end < start) {
      return res.status(400).json({ message: "The end date must be after the start date." });
    }

    // An ad can only promote one of the vendor's own products.
    let ownProductId = null;
    if (productId) {
      const owned = mongoose.isValidObjectId(productId)
        ? await Product.exists({ _id: productId, vendor: vendor.user })
        : null;
      if (!owned) {
        return res.status(400).json({ message: "Choose one of your own products to advertise." });
      }
      ownProductId = productId;
    }

    const ad = await Advertisement.create({
      vendor: vendor._id,
      product: String(product).trim(),
      productId: ownProductId,
      placement: normalizePlacement(placement),
      budget: Number(budget),
      startDate: start,
      endDate: end,
      status: "PENDING", // awaits MVEC admin approval
    });

    return res.status(201).json({
      message: "Advertisement campaign submitted for review.",
      advertisement: mapAdvertisement(ad),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// @desc    Vendor pauses / reactivates one of their own campaigns
// @route   PATCH /api/vendor/advertisements/:id/status
// @access  Private (vendor)
exports.updateMyAdvertisementStatus = async (req, res) => {
  try {
    const vendor = await resolveVendor(req.user.id);
    if (!vendor) {
      return res
        .status(404)
        .json({ message: "Vendor profile not found. Please complete onboarding." });
    }

    const { status } = req.body;
    if (!["ACTIVE", "PAUSED"].includes(status)) {
      return res.status(400).json({ message: "status must be ACTIVE or PAUSED" });
    }

    // The list endpoint exposes publicId as `id`, so accept either identifier.
    const adId = req.params.id;
    const ad = await Advertisement.findOne({
      ...(mongoose.isValidObjectId(adId) ? { _id: adId } : { publicId: adId }),
      vendor: vendor._id,
    });
    if (!ad) {
      return res.status(404).json({ message: "Advertisement campaign not found" });
    }
    // Vendors can pause and resume approved campaigns only. A pending or
    // rejected campaign goes live only after MVEC admin approval.
    if (!["ACTIVE", "PAUSED"].includes(ad.status)) {
      return res.status(403).json({ message: "This campaign is waiting for MVEC approval." });
    }

    ad.status = status;
    await ad.save();

    return res.status(200).json({
      message: `Campaign ${status === "PAUSED" ? "paused" : "activated"}.`,
      advertisement: mapAdvertisement(ad),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ADMIN · SUBSCRIPTIONS
// ════════════════════════════════════════════════════════════════════════════

// @desc    Admin list all vendor subscriptions
// @route   GET /api/admin/subscriptions
// @access  Private (super_admin)
exports.adminListSubscriptions = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (status) filter.status = status;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(parseInt(limit, 10) || 50, 200);
    const skip = (pageNum - 1) * limitNum;

    let [subscriptions, total] = await Promise.all([
      Subscription.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("vendor", "Fullname email"),
      Subscription.countDocuments(filter),
    ]);

    if (search) {
      const term = new RegExp(search, "i");
      subscriptions = subscriptions.filter(
        (s) => term.test(s.vendor?.Fullname || "") || term.test(s.publicId || "")
      );
    }

    const rows = subscriptions.map((sub) =>
      mapSubscription(sub, sub.vendor?.Fullname || "—")
    );

    return res.status(200).json({ data: rows, meta: { page: pageNum, limit: limitNum, total } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Admin set a subscription status (cancel / reactivate / expire)
// @route   PATCH /api/admin/subscriptions/:id/status
// @access  Private (super_admin)
exports.adminUpdateSubscriptionStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["ACTIVE", "CANCELLED", "EXPIRED"].includes(status)) {
      return res.status(400).json({ message: "status must be ACTIVE, CANCELLED or EXPIRED" });
    }

    const subscription = await Subscription.findById(req.params.id);
    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    subscription.status = status;
    if (status === "CANCELLED" || status === "EXPIRED") subscription.autoRenew = false;
    await subscription.save();

    return res.status(200).json({
      message: `Subscription marked ${status.toLowerCase()}.`,
      subscription: mapSubscription(subscription),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ADMIN · ADVERTISEMENTS
// ════════════════════════════════════════════════════════════════════════════

// @desc    Admin list all ad placement campaigns
// @route   GET /api/admin/advertisements
// @access  Private (super_admin)
exports.adminListAdvertisements = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (status) filter.status = status.toUpperCase();

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(parseInt(limit, 10) || 50, 200);
    const skip = (pageNum - 1) * limitNum;

    const [ads, total] = await Promise.all([
      Advertisement.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("vendor", "businessName"),
      Advertisement.countDocuments(filter),
    ]);

    const rows = ads.map((ad) => ({
      ...mapAdvertisement(ad),
      vendor: ad.vendor?.businessName || "—",
    }));

    return res.status(200).json({ data: rows, meta: { page: pageNum, limit: limitNum, total } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Admin approve / reject / pause an ad campaign
// @route   PATCH /api/admin/advertisements/:id/status
// @access  Private (super_admin)
exports.adminUpdateAdvertisementStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["ACTIVE", "PAUSED", "REJECTED", "COMPLETED"].includes(status)) {
      return res.status(400).json({ message: "Invalid advertisement status" });
    }

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Advertisement campaign not found" });
    }
    const ad = await Advertisement.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ message: "Advertisement campaign not found" });
    }

    ad.status = status;
    await ad.save();

    return res.status(200).json({
      message: `Campaign marked ${AD_STATUS_LABEL[status] || status.toLowerCase()}.`,
      advertisement: { ...mapAdvertisement(ad), vendor: ad.vendor },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Live, approved ads for one placement (e.g. the home page hero)
// @route   GET /api/advertisements?placement=HOMEPAGE_HERO
// @access  Public
// Only ACTIVE (admin-approved) campaigns inside their date range, linked to a
// live product that belongs to the advertising vendor, are returned.
exports.listLiveAdvertisements = async (req, res) => {
  try {
    const placement = String(req.query.placement || "HOMEPAGE_HERO");
    if (!AD_PLACEMENTS[placement]) {
      return res.status(400).json({ message: "Unknown placement" });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 6, 1), 12);
    const now = new Date();

    const ads = await Advertisement.find({
      placement,
      status: "ACTIVE",
      productId: { $ne: null },
      startDate: { $lte: now },
      $or: [{ endDate: null }, { endDate: { $gte: now } }],
    })
      .sort({ budget: -1, createdAt: -1 })
      .limit(limit * 3)
      .populate("vendor", "user businessName")
      .populate({
        path: "productId",
        match: { status: "ACTIVE" },
        select: "name price discountPrice media stockQuantity status vendor category averageRating reviewCount publicId",
        populate: [
          { path: "vendor", select: "Fullname companyName" },
          { path: "category", select: "name slug" },
        ],
      });

    const seen = new Set();
    const data = [];
    for (const ad of ads) {
      const product = ad.productId;
      if (!product || !ad.vendor) continue;
      const productVendor = String(product.vendor?._id || product.vendor);
      if (productVendor !== String(ad.vendor.user)) continue;
      if (seen.has(String(product._id))) continue;
      seen.add(String(product._id));
      data.push({ id: ad.publicId, placement, product });
      if (data.length >= limit) break;
    }

    return res.status(200).json({ data });
  } catch (error) {
    console.error("Error listing advertisements:", error);
    return res.status(500).json({ message: "Could not load promotions." });
  }
};
