const mongoose = require("mongoose");
const Category = require("../models/Category");

// Helper: turn a name into a slug
const slugify = (str) =>
  str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

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
    const categories = await Category.find({ active: true }).sort({ sortOrder: 1, name: 1 });

    if (req.query.tree === "true") {
      const byId = {};
      categories.forEach((cat) => {
        byId[cat._id] = { ...cat.toObject(), children: [] };
      });

      const tree = [];
      categories.forEach((cat) => {
        if (cat.parentId) {
          byId[cat.parentId]?.children.push(byId[cat._id]);
        } else {
          tree.push(byId[cat._id]);
        }
      });

      return res.status(200).json({ categories: tree });
    }

    return res.status(200).json({ categories });
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

    // Block delete if it still has active subcategories
    const childCount = await Category.countDocuments({ parentId: id, active: true });
    if (childCount > 0) {
      return res.status(409).json({
        message: "Cannot delete a category that still has active subcategories",
      });
    }

    // Soft-delete: keeps history/products referencing it intact
    category.active = false;
    await category.save();

    return res.status(200).json({ message: "Category disabled", category });
  } catch (error) {
    console.error("Error deleting category:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};