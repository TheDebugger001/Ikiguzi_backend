const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const SupplierTeamMember = require("../models/SupplierTeamMember");
const Product = require("../models/Product");
const WholesaleProduct = require("../models/WholesaleProduct");
const User = require("../models/User");

// Resolve the signed-in supplier's profile document (used by wholesale CRUD).
async function resolveMySupplier(userId) {
  let supplier = await Supplier.findOne({ user: userId });
  if (!supplier) {
    const membership = await SupplierTeamMember.findOne({ user: userId, status: "ACTIVE" });
    if (membership) supplier = await Supplier.findById(membership.supplier);
  }
  if (!supplier) {
    const error = new Error("Supplier profile not found. Please complete onboarding.");
    error.status = 404;
    throw error;
  }
  return supplier;
}

// Normalize the numeric + media fields of a wholesale product payload.
function sanitizeWholesalePayload(body = {}, defaults = {}) {
  return {
    name: body.name !== undefined ? body.name : defaults.name,
    shortDescription: body.shortDescription !== undefined ? body.shortDescription : defaults.shortDescription,
    category: body.category !== undefined && body.category !== "" ? body.category : defaults.category || "General",
    unit: body.unit !== undefined && body.unit !== "" ? body.unit : defaults.unit || "piece",
    wholesalePrice: Math.max(0, Number(body.wholesalePrice ?? defaults.wholesalePrice ?? 0) || 0),
    retailPrice: Math.max(0, Number(body.retailPrice ?? defaults.retailPrice ?? 0) || 0),
    moq: Math.max(1, Number(body.moq ?? defaults.moq ?? 1) || 1),
    stockQuantity: Math.max(0, Number(body.stockQuantity ?? defaults.stockQuantity ?? 0) || 0),
    bulkDiscount: Math.min(100, Math.max(0, Number(body.bulkDiscount ?? defaults.bulkDiscount ?? 0) || 0)),
    media: body.media !== undefined ? body.media : defaults.media || { mainImage: "", gallery: [] },
  };
}

// ─── 1. ONBOARD SUPPLIER (complete profile after registering) ──────────────
// @route   POST /api/suppliers/onboard
// @access  Private (role: "supplier")
exports.onboardSupplier = async (req, res) => {
  try {
    if (req.user.role !== "supplier") {
      return res.status(403).json({ message: "Only supplier accounts can create a supplier profile" });
    }

    const existing = await Supplier.findOne({ user: req.user.id });
    const created = !existing;
    const { businessName, description, phone, email, logoUrl, category, location } = req.body;

    if (!businessName || !phone || !email || !description || !logoUrl || !category || !location) {
      return res.status(400).json({ message: "Business name, phone, email, description, logo, category, and location are required." });
    }

    const supplier = existing || new Supplier({ user: req.user.id });
    Object.assign(supplier, { businessName, description, phone, email, logoUrl, category, location, verificationStatus: "PENDING" });
    await supplier.save();
    await require("../models/User").findByIdAndUpdate(req.user.id, { companyName: businessName, businessName, description, logoUrl, category, location, isOnboarded: true, verificationStatus: "PENDING" });

    return res.status(created ? 201 : 200).json({ message: created ? "Supplier profile created" : "Supplier profile updated", supplier });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "A supplier with this business name already exists" });
    }
    return res.status(400).json({ message: error.message });
  }
};

// ─── 2. GET OWN SUPPLIER PROFILE ────────────────────────────────────────────
// @route   GET /api/supplier/profile
// @access  Private (role: "supplier")
exports.getMyProfile = async (req, res) => {
  try {
    const supplier = await Supplier.findOne({ user: req.user.id });
    if (!supplier) {
      return res.status(404).json({ message: "Supplier profile not found. Please complete onboarding." });
    }
    return res.status(200).json({ supplier });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 3. UPDATE OWN SUPPLIER PROFILE ─────────────────────────────────────────
// @route   PATCH /api/supplier/profile
// @access  Private (role: "supplier", own profile only)
exports.updateMyProfile = async (req, res) => {
  try {
    const supplier = await Supplier.findOne({ user: req.user.id });
    if (!supplier) {
      return res.status(404).json({ message: "Supplier profile not found. Please complete onboarding." });
    }

    const { businessName, description, phone, email, logoUrl, location } = req.body;

    // Fields the supplier is allowed to self-edit — NOT verificationStatus, ratingAvg, or status
    if (businessName !== undefined) supplier.businessName = businessName;
    if (description !== undefined) supplier.description = description;
    if (phone !== undefined) supplier.phone = phone;
    if (email !== undefined) supplier.email = email;
    if (logoUrl !== undefined) supplier.logoUrl = logoUrl;
    if (location !== undefined) supplier.location = location;

    await supplier.save();
    return res.status(200).json({ message: "Supplier profile updated", supplier });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "A supplier with this business name already exists" });
    }
    return res.status(400).json({ message: error.message });
  }
};

// ─── 4. PUBLIC SUPPLIER DIRECTORY ───────────────────────────────────────────
// @route   GET /api/suppliers?q=&category=&location=&page=&pageSize=
// @access  Public
exports.getSuppliers = async (req, res) => {
  try {
    const { q, location, page = 1, pageSize = 20 } = req.query;

    const filter = {
      status: "ACTIVE",
      verificationStatus: "VERIFIED", // only show verified suppliers publicly
    };

    if (q) {
      filter.businessName = { $regex: q, $options: "i" };
    }
    if (location) {
      filter.location = location;
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limit = Math.min(parseInt(pageSize, 10) || 20, 100); // cap page size
    const skip = (pageNum - 1) * limit;

    const [suppliers, total] = await Promise.all([
      Supplier.find(filter).sort({ ratingAvg: -1 }).skip(skip).limit(limit),
      Supplier.countDocuments(filter),
    ]);

    return res.status(200).json({
      data: suppliers,
      meta: { page: pageNum, pageSize: limit, total },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 5. PUBLIC SUPPLIER STOREFRONT (by id or slug) ─────────────────────────
// @route   GET /api/suppliers/:idOrSlug
// @access  Public
exports.getSupplierByIdOrSlug = async (req, res) => {
  try {
    const { idOrSlug } = req.params;
    const isObjectId = idOrSlug.match(/^[0-9a-fA-F]{24}$/);

    const query = isObjectId
      ? { _id: idOrSlug }
      : { slug: idOrSlug };

    const supplier = await Supplier.findOne({
      ...query,
      status: "ACTIVE",
      verificationStatus: "VERIFIED",
    });

    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    // NOTE: once Product model links `supplier`, populate their products/reviews here too
    return res.status(200).json({ supplier });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 5b. PUBLIC SUPPLIER WHOLESALE CATALOG (by supplier id) ─────────────────
// @route   GET /api/suppliers/:id/products
// @access  Public
exports.getSupplierProducts = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    const supplier = await Supplier.findOne({
      _id: id,
      status: "ACTIVE",
      verificationStatus: "VERIFIED",
    });

    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    const products = await WholesaleProduct.find({
      supplier: supplier._id,
      status: "ACTIVE",
    }).sort({ createdAt: -1 });

    return res.status(200).json({ supplier, products });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 6. ADMIN: LIST ALL SUPPLIERS (any status) ──────────────────────────────
// @route   GET /api/admin/suppliers?status=&verificationStatus=&page=&pageSize=
// @access  Private (super_admin)
exports.adminGetSuppliers = async (req, res) => {
  try {
    const { status, verificationStatus, page = 1, pageSize = 20 } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (verificationStatus) filter.verificationStatus = verificationStatus;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limit = Math.min(parseInt(pageSize, 10) || 20, 100);
    const skip = (pageNum - 1) * limit;

    const [suppliers, total] = await Promise.all([
      Supplier.find(filter).populate("user", "Fullname email phone").skip(skip).limit(limit),
      Supplier.countDocuments(filter),
    ]);

    return res.status(200).json({
      data: suppliers,
      meta: { page: pageNum, pageSize: limit, total },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 7. ADMIN: VERIFY / REJECT SUPPLIER ─────────────────────────────────────
// @route   PATCH /api/admin/suppliers/:id/verify
// @access  Private (super_admin)
exports.adminVerifySupplier = async (req, res) => {
  try {
    const { decision } = req.body; // "VERIFIED" | "REJECTED"

    if (!["VERIFIED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ message: "decision must be VERIFIED or REJECTED" });
    }

    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    supplier.verificationStatus = decision;
    await supplier.save();
    await require("../models/User").findByIdAndUpdate(supplier.user, { verificationStatus: decision });

    // TODO: trigger notification to supplier (doc: "Order accepted / Payment received" style events)

    return res.status(200).json({ message: `Supplier ${decision.toLowerCase()}`, supplier });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 8. ADMIN: SUSPEND / ACTIVATE / BLOCK SUPPLIER ──────────────────────────
// @route   PATCH /api/admin/suppliers/:id/status
// @access  Private (super_admin)
exports.adminUpdateSupplierStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!["ACTIVE", "SUSPENDED", "BLOCKED", "UNDER_REVIEW"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    supplier.status = status;
    await supplier.save();

    // Keep the owner's User account in sync so token-gated middleware
    // (protect) rejects BLOCKED / SUSPENDED suppliers at the gate.
    if (supplier.user) {
      const userStatusMap = {
        ACTIVE: "ACTIVE",
        SUSPENDED: "SUSPEND",
        BLOCKED: "BLOCK",
        UNDER_REVIEW: "INVESTIGATE",
      };
      await User.findByIdAndUpdate(supplier.user, { status: userStatusMap[status] || "ACTIVE" });
    }

    return res.status(200).json({ message: `Supplier status set to ${status}`, supplier });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 9. SUPPLIER: LIST OWN WHOLESALE PRODUCTS ────────────────────────────────
// @route   GET /api/suppliers/me/products
// @access  Private (role: "supplier", own catalog)
exports.getMyWholesaleProducts = async (req, res) => {
  try {
    const supplier = await resolveMySupplier(req.user.id);
    const products = await WholesaleProduct.find({ supplier: supplier._id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, supplier: supplier._id, count: products.length, products });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message });
  }
};

// ─── 10. SUPPLIER: CREATE WHOLESALE PRODUCT ──────────────────────────────────
// @route   POST /api/suppliers/me/products
// @access  Private (role: "supplier", own catalog)
exports.createWholesaleProduct = async (req, res) => {
  try {
    const supplier = await resolveMySupplier(req.user.id);
    const { name, wholesalePrice } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "name is required" });
    }
    if (wholesalePrice === undefined || wholesalePrice === null || wholesalePrice === "" || Number(wholesalePrice) < 0) {
      return res.status(400).json({ message: "A valid wholesalePrice is required" });
    }

    const payload = sanitizeWholesalePayload(req.body);
    const product = await WholesaleProduct.create({ supplier: supplier._id, ...payload });

    return res.status(201).json({ success: true, message: "Wholesale product created.", product });
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }
};

// ─── 11. SUPPLIER: UPDATE OWN WHOLESALE PRODUCT ──────────────────────────────
// @route   PUT /api/suppliers/me/products/:productId
// @access  Private (role: "supplier", own catalog)
exports.updateWholesaleProduct = async (req, res) => {
  try {
    const supplier = await resolveMySupplier(req.user.id);
    const product = await WholesaleProduct.findOne({ _id: req.params.productId, supplier: supplier._id });
    if (!product) {
      return res.status(404).json({ message: "Wholesale product not found" });
    }

    const payload = sanitizeWholesalePayload(req.body, {
      name: product.name,
      shortDescription: product.shortDescription,
      category: product.category,
      unit: product.unit,
      wholesalePrice: product.wholesalePrice,
      retailPrice: product.retailPrice,
      moq: product.moq,
      stockQuantity: product.stockQuantity,
      bulkDiscount: product.bulkDiscount,
      media: product.media,
    });

    if (req.body.status !== undefined) {
      product.status = req.body.status;
    }

    Object.assign(product, payload);
    await product.save();

    return res.status(200).json({ success: true, message: "Wholesale product updated.", product });
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }
};

// ─── 12. SUPPLIER: DELETE OWN WHOLESALE PRODUCT ──────────────────────────────
// @route   DELETE /api/suppliers/me/products/:productId
// @access  Private (role: "supplier", own catalog)
exports.deleteWholesaleProduct = async (req, res) => {
  try {
    const supplier = await resolveMySupplier(req.user.id);
    const product = await WholesaleProduct.findOneAndDelete({ _id: req.params.productId, supplier: supplier._id });
    if (!product) {
      return res.status(404).json({ message: "Wholesale product not found" });
    }
    return res.status(200).json({ success: true, message: "Wholesale product deleted." });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message });
  }
};
