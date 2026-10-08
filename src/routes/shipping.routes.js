const express = require("express");
const router = express.Router();
const shipping = require("../controllers/shipping.controller");
const { protect, authorize } = require("../middleware/auth.middleware");
const { checkStaffPermission } = require("../middleware/staff.middleware");

// Public: active, seller-agnostic zones (buyer delivery estimate).
router.get("/zones", shipping.listZones);

// Vendors and admins manage zones.
router.use(protect);
router.post("/zones", authorize("vendor", "super_admin"), checkStaffPermission("canManageSettings"), shipping.createZone);
router.get("/zones/mine", authorize("vendor", "super_admin"), shipping.listZones);
router.patch("/zones/:id", checkStaffPermission("canManageSettings"), shipping.updateZone);
router.delete("/zones/:id", checkStaffPermission("canManageSettings"), shipping.deleteZone);

module.exports = router;
