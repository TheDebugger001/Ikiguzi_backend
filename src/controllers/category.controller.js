const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const Category = require("../models/Category");
const Product = require("../models/Product");
const User = require("../models/User");

// Helper: turn a name into a slug
const slugify = (str) =>
  str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

// ─── OPTIONAL REQUESTER RESOLUTION ─────────────────────────────────────────
// GET /api/categories is a public route, but the dashboard still sends its
// Bearer token. We resolve the caller on a best-effort basis (never failing the
// request) so we can also return per-vendor product counts.
const resolveRequester = async (req) => {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return null;
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return await User.findById(decoded.userId || decoded.id).select("_id role").lean();
  } catch (error) {
    return null;
  }
};

// ─── PRODUCT COUNTS (read live from the products collection) ───────────────
// Returns each category as a plain object enriched with:
//   productCount   - every product in this category (marketplace-wide)
//   myProductCount - only the requesting user's products (when identified)
const attachProductCounts = async (categories, requester) => {
  const rows = categories.map((cat) => cat.toObject ? cat.toObject() : { ...cat });
  if (!rows.length) return rows;

  const group = {
    _id: "$category",
    productCount: { $sum: 1 },
  };
  if (requester?._id) {
    group.myProductCount = {
      $sum: { $cond: [{ $eq: ["$vendor", requester._id] }, 1, 0] },
    };
  }

  const counts = await Product.aggregate([
    { $match: { category: { $in: rows.map((cat) => cat._id) } } },
    { $group: group },
  ]);
  const countsByCategory = new Map(counts.map((c) => [String(c._id), c]));

  return rows.map((cat) => {
    const catCounts = countsByCategory.get(String(cat._id)) || {};
    return {
      ...cat,
      productCount: Number(catCounts.productCount) || 0,
      ...(requester?._id ? { myProductCount: Number(catCounts.myProductCount) || 0 } : {}),
    };
  });
};

// ─── CREATE CATEGORY ──────────────────────────────────────────────────────
// @route   POST /api/categories        (admin, or /api/vendor/categories if permitted)
exports.createCategory = async (req, res) => {
  try {
    const { name, description, imageUrl, sortOrder, parentId } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Category name is required" });
    }

    // Validate parent exists if provided
    if (parentId) {
      if (!mongoose.Types.ObjectId.isValid(parentId)) {
        return res.status(400).json({ message: "Invalid parentId" });
      }
      const parent = await Category.findById(parentId);
      if (!parent) {
        return res.status(404).json({ message: "Parent category not found" });
      }
    }

    const slug = slugify(name);

    const existing = await Category.findOne({ slug });
    if (existing) {
      // Return the existing category so the form can auto-select it rather than error
      return res.status(200).json({
        alreadyExisted: true,
        message: `Category "${existing.name}" already exists and has been selected.`,
        category: { id: existing._id, name: existing.name, slug: existing.slug },
      });
    }

    const category = await Category.create({
      name: name.trim(),
      slug,
      description,
      imageUrl,
      sortOrder: sortOrder || 0,
      parentId: parentId || null,
    });

    return res.status(201).json({ message: "Category created", category });
  } catch (error) {
    console.error("Error creating category:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── GET ALL CATEGORIES (flat, optionally nested tree) ────────────────────
// @route   GET /api/categories?tree=true
exports.getCategories = async (req, res) => {
  try {
    const requester = await resolveRequester(req);
    const categories = await Category.find({ active: true }).sort({ sortOrder: 1, name: 1 });
    const withCounts = await attachProductCounts(categories, requester);

    if (req.query.tree === "true") {
      const byId = {};
      withCounts.forEach((cat) => {
        byId[cat._id] = { ...cat, children: [] };
      });

      const tree = [];
      withCounts.forEach((cat) => {
        if (cat.parentId) {
          byId[cat.parentId]?.children.push(byId[cat._id]);
        } else {
          tree.push(byId[cat._id]);
        }
      });

      return res.status(200).json({ categories: tree });
    }

    return res.status(200).json({ categories: withCounts });
  } catch (error) {
    console.error("Error fetching categories:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── GET SINGLE CATEGORY BY SLUG ───────────────────────────────────────────
// @route   GET /api/categories/:slug
exports.getCategoryBySlug = async (req, res) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug, active: true });
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    const subcategories = await Category.find({ parentId: category._id, active: true });

    return res.status(200).json({ category, subcategories });
  } catch (error) {
    console.error("Error fetching category:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── UPDATE CATEGORY ────────────────────────────────────────────────────────
// @route   PATCH /api/admin/categories/:id
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, imageUrl, sortOrder, active, parentId } = req.body;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Prevent a category from becoming its own parent (or a self-reference loop)
    if (parentId) {
      if (parentId === id) {
        return res.status(422).json({ message: "A category cannot be its own parent" });
      }
      if (!mongoose.Types.ObjectId.isValid(parentId)) {
        return res.status(400).json({ message: "Invalid parentId" });
      }
      const parent = await Category.findById(parentId);
      if (!parent) {
        return res.status(404).json({ message: "Parent category not found" });
      }
      category.parentId = parentId;
    } else if (parentId === null) {
      category.parentId = null;
    }

    if (name && name.trim()) {
      category.name = name.trim();
      category.slug = slugify(name);

      const existing = await Category.findOne({ slug: category.slug, _id: { $ne: id } });
      if (existing) {
        return res.status(409).json({ message: "A category with this name/slug already exists" });
      }
    }

    if (description !== undefined) category.description = description;
    if (imageUrl !== undefined) category.imageUrl = imageUrl;
    if (sortOrder !== undefined) category.sortOrder = sortOrder;
    if (active !== undefined) category.active = Boolean(active);

    await category.save();

    return res.status(200).json({ message: "Category updated", category });
  } catch (error) {
    console.error("Error updating category:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── DELETE (SOFT) CATEGORY ─────────────────────────────────────────────────
// @route   DELETE /api/admin/categories/:id
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Check for active subcategories
    const subcatCount = await Category.countDocuments({ parentId: id, active: true });
    if (subcatCount > 0) {
      return res.status(409).json({
        message: "Cannot delete category: Please remove or reassign its subcategories first.",
      });
    }

    // Check for attached products
    const productCount = await Product.countDocuments({ category: id });
    if (productCount > 0) {
      return res.status(409).json({
        message: "Cannot delete category: Please reassign or delete all products in this category first.",
      });
    }

    // Safe deletion / soft delete
    category.active = false;
    await category.save();

    return res.status(200).json({ message: "Category disabled", category });
  } catch (error) {
    console.error("Error deleting category:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};