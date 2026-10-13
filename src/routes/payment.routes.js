const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth.middleware");
const limits = require("../middleware/rateLimits");
const {
  initiatePaypackPayment,
  initiateMomoPayment,
  initiateAirtelPayment,
  checkPaymentStatus,
  confirmPayment,
} = require("../controllers/payment.controller");

// Initiate a Paypack payment (MTN or Airtel number, provider auto-detected)
router.post("/pay", protect, limits.payment, initiatePaypackPayment);

// Initiate MTN MoMo Push Notification (via Paypack)
router.post("/pay/momo", protect, limits.payment, initiateMomoPayment);
// Backward-compatible alias for clients still calling the previous path.
router.post("/momo/initiate", protect, limits.payment, initiateMomoPayment);

// Initiate Airtel Money Push Notification (via Paypack)
router.post("/pay/airtel", protect, limits.payment, initiateAirtelPayment);

// Check payment status (reconciles with Paypack while pending)
router.get("/status/:paymentId", protect, checkPaymentStatus);

// Check payment status (reconciles with Paypack while pending)
router.get("/status/:paymentId", protect, checkPaymentStatus);

// Direct Confirmation (Card, Bank, or dev confirmation)
router.post("/confirm", protect, confirmPayment);

module.exports = router;
