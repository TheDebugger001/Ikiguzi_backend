const express = require("express");
const router = express.Router();

const {
  createStore,
  getMyStore,
  updateMyStore,
  getPublicStoreBySlug,
} = require("../controllers/store.controller");

const { protect, authorize, requireOnboarded } = require("../middleware/auth.middleware");
const { checkStaffPermission } = require("../middleware/staff.middleware");

// Public route for Marketplace shoppers
router.get("/public/:slug", getPublicStoreBySlug);

// Vendor-protected routes
router.use(protect);
router.post("/", authorize("vendor"), requireOnboarded, checkStaffPermission("canManageSettings"), createStore);
router.get("/mine", authorize("vendor"), getMyStore);
router.put("/mine", authorize("vendor"), requireOnboarded, checkStaffPermission("canManageSettings"), updateMyStore);

module.exports = router;
