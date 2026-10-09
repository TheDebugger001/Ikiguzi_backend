const express = require("express");
const router = express.Router();

const {
  createCheckoutOrder,
  directCheckout,
  getMyOrders,
  getDeliverable,
  getOrderById,
  getVendorOrders,
  updateVendorOrderStatus,
  updateOrderStatus,
  confirmOrderDelivery,
  getAllOrders,
  cancelOrderByBuyer,
} = require("../controllers/order.controller");

const { checkStaffPermission } = require("../middleware/staff.middleware");
const { protect, authorize } = require("../middleware/auth.middleware");

// Require authentication for all order routes
router.use(protect);

router.get("/", authorize("super_admin", "admin"), getAllOrders);
router.post("/checkout", createCheckoutOrder);
router.post("/direct-checkout", directCheckout);
router.get("/my-orders", getMyOrders);
// Keep this before /:id; otherwise "deliverable" is parsed as an order ID.
router.get("/deliverable", authorize("delivery", "courier", "vendor", "supplier", "super_admin"), getDeliverable);
router.get("/vendor/orders", authorize("vendor"), getVendorOrders);
router.get("/:id", getOrderById);
router.post("/:id/cancel", protect, cancelOrderByBuyer);
router.patch(
  "/vendor/status",
  checkStaffPermission("canManageOrders"),
  updateVendorOrderStatus,
);
router.patch(
  "/:id/status",
  protect,
  authorize("vendor", "admin", "super_admin"),
  updateOrderStatus,
);

// Direct route for confirming delivery and unlocking earnings
router.patch("/:id/deliver", protect, authorize("super_admin", "courier", "delivery"), confirmOrderDelivery);

// Status route for general vendor updates (excluding delivery payout triggers)
router.patch("/vendor/status", protect, authorize("vendor", "super_admin"), updateVendorOrderStatus);

module.exports = router;
