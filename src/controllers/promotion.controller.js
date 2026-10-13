const mongoose = require("mongoose");
const Promotion = require("../models/Promotion");
const { resolveOwnedStore } = require("../utils/vendorStore.util");

function mapPromotion(p) {
  return {
    id: p.publicId || p._id,
    name: p.name,
    code: p.code,
    type: p.type,
    value: p.value,
    // Present discount as display text for the frontend table
    discount:
      p.type === "PERCENT"
        ? `${p.value}%`
        : p.type === "FIXED"
        ? `${p.value} RWF`
        : "Free shipping",
    status: p.status,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    usageLimit: p.usageLimit,
    usedCount: p.usedCount,
    minOrderAmount: p.minOrderAmount,
    createdBy: p.createdBy,
    store: p.store,
    vendor: p.vendor,
    product: p.product,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// The list endpoint exposes publicId as `id`, so accept either identifier.
const findPromotion = (id) =>
  mongoose.isValidObjectId(id) ? Promotion.findById(id) : Promotion.findOne({ publicId: id });

const allowedStatus = ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "EXPIRED", "CANCELLED"];
const allowedType = ["PERCENT", "FIXED", "FREE_SHIPPING"];

// @desc    Create a promotion (vendor for their store, or admin with scope)
// @route   POST /api/promotions
// @access  Private (vendor or super_admin)
exports.createPromotion = async (req, res) => {
  try {
    const {
      name,
      code,
      type,
      value,
      product,
      category,
      startsAt,
      endsAt,
      status,
      usageLimit,
      minOrderAmount,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Promotion name is required" });
    }
    if (!code || !code.trim()) {
      return res.status(400).json({ message: "Promotion code is required" });
    }

    const promoType = type || "PERCENT";
    if (!allowedType.includes(promoType)) {
      return res.status(400).json({ message: "Invalid promotion type" });
    }
    if (promoType === "PERCENT" && (value < 0 || value > 100)) {
      return res.status(400).json({ message: "Percent value must be between 0 and 100" });
    }

    const existing = await Promotion.findOne({ code: String(code).trim().toUpperCase() });
    if (existing) {
      return res.status(409).json({ message: "A promotion with this code already exists" });
    }

    const isVendor = req.user.role === "vendor";
    let store = null;
    if (isVendor) {
      store = await resolveOwnedStore(req.user._id, req.body.storeId);
      if (!store && req.body.storeId) {
        return res.status(400).json({ message: "Select one of your own stores." });
      }
      if (!store && !product) {
        return res.status(400).json({ message: "Create a store before adding promotions" });
      }
    }

    const promotion = await Promotion.create({
      name: name.trim(),
      code: String(code).trim().toUpperCase(),
      type: promoType,
      value: value || 0,
      vendor: isVendor ? req.user._id : null,
      store: isVendor ? (store ? store._id : null) : null,
      product: product || null,
      category: category || null,
      startsAt: startsAt || null,
      endsAt: endsAt || null,
      status: status || "DRAFT",
      usageLimit: usageLimit || null,
      minOrderAmount: minOrderAmount || 0,
      createdBy: req.user._id,
    });

    return res.status(201).json({
      message: "Promotion created",
      promotion: mapPromotion(promotion.toObject()),
    });
  } catch (error) {
    console.error("Error creating promotion:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    List promotions (vendor sees own, admin sees all)
// @route   GET /api/promotions
// @access  Private
exports.listPromotions = async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (req.user.role === "vendor") {
      query.vendor = req.user._id;
    }
    if (status) query.status = status;

    const promotions = await Promotion.find(query).sort({ createdAt: -1 });
    return res.status(200).json({
      data: promotions.map((p) => mapPromotion(p.toObject())),
      meta: { total: promotions.length },
    });
  } catch (error) {
    console.error("Error listing promotions:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Update a promotion
// @route   PATCH /api/promotions/:id
// @access  Private (vendor owner or super_admin)
exports.updatePromotion = async (req, res) => {
  try {
    const { id } = req.params;
    const promotion = await findPromotion(id);
    if (!promotion) {
      return res.status(404).json({ message: "Promotion not found" });
    }

    const isOwner = req.user.role === "vendor" && String(promotion.vendor) === String(req.user._id);
    const isAdmin = req.user.role === "super_admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Not authorized to update this promotion" });
    }

    const { name, code, type, value, status, startsAt, endsAt, usageLimit, minOrderAmount } =
      req.body;

    if (name !== undefined && name.trim()) promotion.name = name.trim();
    if (code !== undefined && code.trim()) {
      const nextCode = String(code).trim().toUpperCase();
      if (nextCode !== promotion.code) {
        const exists = await Promotion.findOne({ code: nextCode, _id: { $ne: promotion._id } });
        if (exists) {
          return res.status(409).json({ message: "A promotion with this code already exists" });
        }
        promotion.code = nextCode;
      }
    }
    if (type !== undefined) {
      if (!allowedType.includes(type)) {
        return res.status(400).json({ message: "Invalid promotion type" });
      }
      promotion.type = type;
    }
    if (value !== undefined) promotion.value = value;
    if (status !== undefined) {
      if (!allowedStatus.includes(status)) {
        return res.status(400).json({ message: "Invalid promotion status" });
      }
      promotion.status = status;
    }
    if (startsAt !== undefined) promotion.startsAt = startsAt;
    if (endsAt !== undefined) promotion.endsAt = endsAt;
    if (usageLimit !== undefined) promotion.usageLimit = usageLimit;
    if (minOrderAmount !== undefined) promotion.minOrderAmount = minOrderAmount;

    await promotion.save();
    return res.status(200).json({
      message: "Promotion updated",
      promotion: mapPromotion(promotion.toObject()),
    });
  } catch (error) {
    console.error("Error updating promotion:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Delete a promotion
// @route   DELETE /api/promotions/:id
// @access  Private (vendor owner or super_admin)
exports.deletePromotion = async (req, res) => {
  try {
    const { id } = req.params;
    const promotion = await findPromotion(id);
    if (!promotion) {
      return res.status(404).json({ message: "Promotion not found" });
    }

    const isOwner = req.user.role === "vendor" && String(promotion.vendor) === String(req.user._id);
    const isAdmin = req.user.role === "super_admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Not authorized to delete this promotion" });
    }

    await Promotion.deleteOne({ _id: promotion._id });
    return res.status(200).json({ message: "Promotion deleted" });
  } catch (error) {
    console.error("Error deleting promotion:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};