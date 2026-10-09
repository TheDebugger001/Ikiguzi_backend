const express = require("express");
const router = express.Router();
const category = require("../controllers/category.controller");
const { protect, authorize } = require("../middleware/auth.middleware");
const { checkStaffPermission } = require("../middleware/staff.middleware");

// ─── PUBLIC ROUTES ──────────────────────────────────────────────────────────
router.get("/", category.getCategories);          // GET /api/categories?tree=true
router.get("/:slug", category.getCategoryBySlug);  // GET /api/categories/:slug

// ─── PROTECTED ROUTES ───────────────────────────────────────────────────────
router.use(protect);

// Vendors can create categories (needed from product creation form).
// Staff accounts need the catalog permission to do the same.
router.post("/", authorize("vendor", "super_admin"), checkStaffPermission("canManageProducts"), category.createCategory);

// Only admins can modify or delete categories
router.use(authorize("super_admin"));
router.patch("/:id", category.updateCategory);     // PATCH /api/categories/:id
router.delete("/:id", category.deleteCategory);    // DELETE /api/categories/:id

module.exports = router;