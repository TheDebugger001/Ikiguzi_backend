const express = require("express");
const router = express.Router();
const wholesaleController = require("../controllers/wholesale.controller");
const { protect, authorize, requireOnboarded } = require("../middleware/auth.middleware"); // Adjust import path if needed

// Vendor creates supply order (MOQ check enforced)
router.get(
  "/orders/mine",
  protect,
  authorize("vendor", "supplier"),
  wholesaleController.listMyWholesaleOrders
);
router.get(
  "/orders/:orderId",
  protect,
  authorize("vendor", "supplier"),
  wholesaleController.getWholesaleOrderById
);
router.post(
  "/orders",
  protect,
  authorize("vendor", "super_admin"),
  requireOnboarded,
  wholesaleController.createWholesaleOrder
);

// Vendor pays for the order. The Paypack webhook holds the funds in escrow —
// there is intentionally no public endpoint that moves money into escrow.
router.post(
  "/orders/:orderId/pay",
  protect,
  authorize("vendor"),
  requireOnboarded,
  wholesaleController.initiatePayment
);

// Vendors may cancel while awaiting payment; suppliers may decline the same way.
router.post(
  "/orders/:orderId/cancel",
  protect,
  authorize("vendor", "supplier"),
  wholesaleController.cancelOrder
);

// Either party can flag an order for admin review once it is in fulfilment.
router.post(
  "/orders/:orderId/dispute",
  protect,
  authorize("vendor", "supplier"),
  wholesaleController.disputeOrder
);

// Suppliers mark an escrow-funded order as shipped.
router.post(
  "/orders/:orderId/ship",
  protect,
  authorize("supplier"),
  requireOnboarded,
  wholesaleController.markShipped
);

// Vendor views the delivery OTP once the order has shipped (OTP is stored
// encrypted at rest and revealed only to the owning vendor).
router.get(
  "/orders/:orderId/otp",
  protect,
  authorize("vendor"),
  wholesaleController.getDeliveryOtp
);

// Vendor confirms delivery receipt (mandatory OTP) & releases escrow funds.
router.post(
  "/orders/:orderId/confirm-receipt",
  protect,
  authorize("vendor"),
  wholesaleController.confirmReceipt
);

// Admin refund of a paid wholesale order.
router.post(
  "/orders/:orderId/refund",
  protect,
  authorize("super_admin"),
  wholesaleController.adminRefundOrder
);

module.exports = router;