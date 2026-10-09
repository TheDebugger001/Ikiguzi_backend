const Product = require("../models/Product");
const Category = require("../models/Category");
const mongoose = require("mongoose");

const normalizeProductPayload = (body = {}) => {
  const normalized = { ...body };
  const category = body.category ?? body.categoryId;
  if (category !== undefined) normalized.category = category;

  const media = { ...(body.media || {}) };
  if (body.mainImage !== undefined) media.mainImage = body.mainImage;
  if (body.gallery !== undefined) media.gallery = body.gallery;
  if (Object.keys(media).length) normalized.media = media;

  const attributes = { ...(body.attributes || {}) };
  for (const key of ["color", "size", "material", "weight", "capacity", "model"]) {
    if (body[key] !== undefined) attributes[key] = body[key];
  }
  if (Object.keys(attributes).length) normalized.attributes = attributes;

  for (const key of ["categoryId", "mainImage", "gallery", "color", "size", "material", "weight", "capacity", "model"]) {
    delete normalized[key];
  }
  return normalized;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// @desc    Get all active products for buyers (Public)
// @route   GET /api/products
// @access  Public / Buyer / Admin
// Query:   ?search=&status=&page=&limit= (the affiliate share screen relies on
//          all three; absent params keep the original "every active product"
//          behaviour so existing clients are unaffected).
exports.getAllProducts = async (req, res) => {
  try {
    const { search } = req.query;
    const status = (req.query.status || "ACTIVE").toString().toUpperCase();

    const query = { status };
    if (search && String(search).trim()) {
      const pattern = new RegExp(escapeRegex(String(search).trim()), "i");
      query.$or = [{ name: pattern }, { description: pattern }, { brand: pattern }];
    }

    const page = parseInt(req.query.page, 10);
    const limit = parseInt(req.query.limit, 10);

    let cursor = Product.find(query)
      .populate("vendor", "Fullname companyName email")
      .populate("category", "name slug")
      .sort({ createdAt: -1 });

    if (Number.isFinite(limit) && limit > 0) {
      cursor = cursor.limit(Math.min(limit, 200));
      if (Number.isFinite(page) && page > 1) cursor = cursor.skip((page - 1) * limit);
    }

    const products = await cursor;
    const total = await Product.countDocuments(query);

    return res.status(200).json({
      count: products.length,
      total,
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: Number.isFinite(limit) && limit > 0 ? limit : products.length,
      products,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get logged-in vendor's OWN products only
// @route   GET /api/products/vendor/me
// @access  Private (Vendor Only)
exports.getVendorProducts = async (req, res) => {
  try {
    const vendorId = req.vendorId || req.targetVendorId || req.user.id;
    const products = await Product.find({
      $or: [{ vendor: vendorId }, { vendor: req.user.id }],
    }).populate(
      "category",
      "name",
    );

    return res.status(200).json({ count: products.length, products });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Create a product (Vendor / Admin)
// @route   POST /api/products
// @access  Private (Vendor / Admin)
exports.createProduct = async (req, res) => {
  try {
    const vendorId = req.vendorId || req.targetVendorId || req.user.id;
    const payload = normalizeProductPayload(req.body);
    if (!mongoose.Types.ObjectId.isValid(payload.category)) {
      return res.status(400).json({ message: "Select a valid category from the category list." });
    }
    if (!(await Category.exists({ _id: payload.category }))) {
      return res.status(400).json({ message: "The selected category no longer exists. Refresh the category list and try again." });
    }
    const product = new Product({
      ...payload,
      vendor: vendorId,
    });

    await product.save();
    return res.status(201).json({ message: "Product created successfully", product });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "field";
      return res.status(409).json({
        message: `A product with this ${field} already exists. Please choose a different ${field}.`,
      });
    }
    return res.status(400).json({ message: error.message });
  }
};

// @desc    Update product (Vendor updates OWN product; Admin updates any)
// @route   PUT /api/products/:id
// @access  Private (Vendor / Admin)
// @desc    Update product (Vendor updates OWN product; Admin updates any)
// @route   PUT /api/products/:id
// @access  Private (Vendor / Admin)
exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // 1. Ownership check — vendor or authorized staff can edit product
    const vendorId = req.vendorId || req.targetVendorId || req.user.id;
    const isOwner =
      product.vendor.toString() === req.user.id.toString() ||
      product.vendor.toString() === vendorId.toString();

    if (req.user.role !== "super_admin" && !isOwner) {
      return res.status(403).json({
        message: "Access denied. You can only update your own products.",
      });
    }

    // 2. Admin cannot alter stock quantity on a vendor's product
    if (
      req.user.role === "super_admin" &&
      product.vendor.toString() !== req.user.id.toString() &&
      req.body.stockQuantity !== undefined &&
      req.body.stockQuantity !== product.stockQuantity
    ) {
      return res.status(403).json({
        message:
          "Access denied. Admin is not allowed to modify vendor stock quantity.",
      });
    }

    // 2. Prepare payload copy
    const updates = normalizeProductPayload(req.body);
    if (updates.category !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(updates.category)) {
        return res.status(400).json({ message: "Select a valid category from the category list." });
      }
      if (!(await Category.exists({ _id: updates.category }))) {
        return res.status(400).json({ message: "The selected category no longer exists. Refresh the category list and try again." });
      }
    }

    // Prevent changing immutable unique indexes
    delete updates.sku;
    delete updates.slug;

    if (updates.media) {
      updates.media = { ...(product.media?.toObject?.() || product.media || {}), ...updates.media };
    }
    if (updates.attributes) {
      updates.attributes = { ...(product.attributes?.toObject?.() || product.attributes || {}), ...updates.attributes };
    }

    // Add before product.save() inside updateProduct
    if (updates.stockQuantity !== undefined) {
      if (updates.stockQuantity <= 0) {
        updates.stockQuantity = 0;
        updates.status = "OUT_OF_STOCK";
      } else if (
        product.status === "OUT_OF_STOCK" &&
        updates.stockQuantity > 0
      ) {
        updates.status = "ACTIVE"; // Auto-reactivate when re-stocked
      }
    }
    // 3. Apply updates and save
    Object.assign(product, updates);
    await product.save();

    return res
      .status(200)
      .json({ message: "Product updated successfully", product });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// @desc    Delete product (Vendor deletes OWN product; Admin deletes any)
// @route   DELETE /api/products/:id
// @access  Private (Vendor / Admin)
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Ownership check
    const vendorId = req.vendorId || req.targetVendorId || req.user.id;
    const isOwner =
      product.vendor.toString() === req.user.id.toString() ||
      product.vendor.toString() === vendorId.toString();

    if (req.user.role !== "super_admin" && !isOwner) {
      return res.status(403).json({
        message: "Access denied. You can only delete your own products.",
      });
    }

    await product.deleteOne();
    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get single product details by ID (Public)
// @route   GET /api/products/:id
// @access  Public
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate("vendor", "Fullname companyName email")
      .populate("category", "name slug");

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.status(200).json({ product });
  } catch (error) {
    console.error("Error fetching product by ID:", error);
    return res
      .status(500)
      .json({ message: "Invalid Product ID or server error" });
  }
};

// @desc    Get single product details by Slug (Public / SEO Friendly)
// @route   GET /api/products/slug/:slug
// @access  Public
exports.getProductBySlug = async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug })
      .populate("vendor", "Fullname companyName email")
      .populate("category", "name slug");

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.status(200).json({ product });
  } catch (error) {
    console.error("Error fetching product by slug:", error);
    return res.status(500).json({ message: error.message });
  }
};

exports.normalizeProductPayload = normalizeProductPayload;
