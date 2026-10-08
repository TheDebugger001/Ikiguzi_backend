const express = require("express");
const router = express.Router();
const wholesaleController = require("../controllers/wholesale.controller");
const { protect, authorize } = require("../middleware/auth.middleware"); // Adjust import path if needed

// Vendor creates supply order (MOQ check enforced)
router.get(
  "/orders/mine",
  protect,
  authorize("vendor", "supplier"),
  wholesaleController.listMyWholesaleOrders
);
router.post(
  "/orders",
  protect,
  authorize("vendor", "super_admin"),
  wholesaleController.createWholesaleOrder
);

// Suppliers mark an escrow-funded order as shipped.
router.post(
  "/orders/:orderId/ship",
  protect,
  authorize("supplier"),
  wholesaleController.markShipped
);

// Escrow hold status transition on payment completion
router.post(
  "/orders/:orderId/hold-escrow",
  protect,
  wholesaleController.holdEscrow
);

// Vendor/Supplier confirms delivery receipt & releases escrow funds
router.post(
  "/orders/:orderId/confirm-receipt",
  protect,
  authorize("vendor"),
  wholesaleController.confirmReceipt
);

module.exports = router;