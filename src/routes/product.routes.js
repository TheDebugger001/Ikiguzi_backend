const express = require("express");
const router = express.Router();
const {
  getAllProducts,
  getVendorProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductById,
  getProductBySlug,
  getRecommendations,
} = require("../controllers/product.controller");
const { checkStaffPermission } = require("../middleware/staff.middleware");

const { protect } = require("../middleware/auth.middleware");
const { authorize, requireOnboarded } = require("../middleware/auth.middleware");

// Public route for Buyers & Admin to browse products
router.get("/", getAllProducts);

// Recommendations route - products sorted by rating and recency
router.get("/recommendations", getRecommendations);

// Placed these above router.use(protect);
router.get("/slug/:slug", getProductBySlug);


// Protected routes (Require authentication)
router.use(protect);

// Route for vendor dashboard to get ONLY their own products.
// Registered BEFORE "/:id" so the literal segment never gets swallowed by route params.
router.get("/vendor/me", authorize("vendor"), getVendorProducts);

// Single product by id (kept after the literal routes to avoid shadowing)
router.get("/:id", getProductById);


// Vendors and super_admins can always manage their own products.
// Staff with the 'canManageProducts' permission can manage on behalf of the store owner.
// checkStaffPermission already passes through if the user IS the store owner or super_admin,
// so it covers all three cases in a single middleware chain.
router.post("/", requireOnboarded, checkStaffPermission("canManageProducts"), createProduct);
router.put("/:id", requireOnboarded, checkStaffPermission("canManageProducts"), updateProduct);
router.delete("/:id", requireOnboarded, checkStaffPermission("canManageProducts"), deleteProduct);


module.exports = router;
