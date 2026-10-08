const express = require("express");
const router = express.Router();
const {
  getVendorBalance,
  requestPayout,
  getPayoutHistory,
} = require("../controllers/payout.controller");

const { protect, authorize } = require("../middleware/auth.middleware");
const { checkStaffPermission } = require("../middleware/staff.middleware");

// Require authentication for all payout endpoints
router.use(protect);

// Vendor Financial Endpoints (Automated Instant Payouts)
router.get("/balance", authorize("vendor"), getVendorBalance);
router.post("/request", authorize("vendor"), checkStaffPermission("canManagePayouts"), requestPayout);
router.get("/history", authorize("vendor"), getPayoutHistory);

module.exports = router;
