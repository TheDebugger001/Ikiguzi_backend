const express = require("express");
const router = express.Router();
const promotion = require("../controllers/promotion.controller");
const { protect, authorize } = require("../middleware/auth.middleware");
const { checkStaffPermission } = require("../middleware/staff.middleware");

router.use(protect);

// Vendors manage their own promotions; admins can list/manage all.
router.get("/", promotion.listPromotions);
router.post("/", authorize("vendor", "super_admin"), checkStaffPermission("canManageProducts"), promotion.createPromotion);
router.patch("/:id", checkStaffPermission("canManageProducts"), promotion.updatePromotion);
router.delete("/:id", checkStaffPermission("canManageProducts"), promotion.deletePromotion);

module.exports = router;
