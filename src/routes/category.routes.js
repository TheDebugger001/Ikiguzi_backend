const express = require("express");
const router = express.Router();
const category = require("../controllers/category.controller");
const { protect, authorize } = require("../middleware/auth.middleware");

// ─── PUBLIC ROUTES ──────────────────────────────────────────────────────────
router.get("/", category.getCategories);          // GET /api/categories?tree=true
router.get("/:slug", category.getCategoryBySlug);  // GET /api/categories/:slug

// ─── PROTECTED ROUTES ───────────────────────────────────────────────────────
router.use(protect);

// Vendors can create categories (needed from product creation form)
router.post("/", authorize("vendor", "super_admin"), category.createCategory);

// Only admins can modify or delete categories
router.use(authorize("super_admin"));
router.patch("/:id", category.updateCategory);     // PATCH /api/categories/:id
router.delete("/:id", category.deleteCategory);    // DELETE /api/categories/:id

module.exports = router;