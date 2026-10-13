const express = require("express");
const router = express.Router();

const {
  createStore,
  getMyStore,
  updateMyStore,
  getMyStoreById,
  updateMyStoreById,
  setPrimaryStore,
  deleteMyStore,
  getPublicStoreBySlug,
} = require("../controllers/store.controller");

const { protect, authorize, requireOnboarded } = require("../middleware/auth.middleware");
const { checkStaffPermission } = require("../middleware/staff.middleware");

// Public route for Marketplace shoppers
router.get("/public/:slug", getPublicStoreBySlug);

// Vendor-protected routes
router.use(protect);
router.post("/", authorize("vendor"), requireOnboarded, checkStaffPermission("canManageSettings"), createStore);
router.get("/mine", authorize("vendor"), getMyStore); // all stores + primary
router.put("/mine", authorize("vendor"), requireOnboarded, checkStaffPermission("canManageSettings"), updateMyStore); // primary store (legacy)
router.get("/mine/:id", authorize("vendor"), getMyStoreById);
router.put("/mine/:id", authorize("vendor"), requireOnboarded, checkStaffPermission("canManageSettings"), updateMyStoreById);
router.patch("/mine/:id/primary", authorize("vendor"), checkStaffPermission("canManageSettings"), setPrimaryStore);
router.delete("/mine/:id", authorize("vendor"), checkStaffPermission("canManageSettings"), deleteMyStore);

module.exports = router;
