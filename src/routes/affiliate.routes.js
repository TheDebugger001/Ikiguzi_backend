const express = require("express");
const router = express.Router();
const affiliateController = require("../controllers/affiliate.controller");
const { protect, authorize } = require("../middleware/auth.middleware");

// Affiliate dashboard (wallet, links, aggregates, own payouts)
router.get("/me/dashboard", protect, affiliateController.getMyDashboard);

// ─── Profile, verification & settings ────────────────────────────────────────
router.get("/profile", protect, affiliateController.getProfile);
router.patch("/profile", protect, affiliateController.updateProfile);
router.get("/verification", protect, affiliateController.getVerification);
router.get("/settings", protect, affiliateController.getSettings);
router.patch("/settings", protect, affiliateController.updateSettings);

// ─── Dashboard aggregates ────────────────────────────────────────────────────
router.get("/overview", protect, affiliateController.getOverview);
router.get("/stats", protect, affiliateController.getStats);
router.get("/wallet", protect, affiliateController.getWallet);
router.get("/commissions", protect, affiliateController.listCommissions);

// ─── Referral links ──────────────────────────────────────────────────────────
router.get("/links", protect, affiliateController.listLinks);
router.post("/links", protect, affiliateController.generateLink);
router.patch("/links/:linkId", protect, affiliateController.updateLink);
router.delete("/links/:linkId", protect, affiliateController.deleteLink);

// ─── Campaigns ───────────────────────────────────────────────────────────────
router.get("/campaigns", protect, affiliateController.listCampaigns);
router.post("/campaigns/:campaignId/join", protect, affiliateController.joinCampaign);

// ─── Notifications ───────────────────────────────────────────────────────────
router.get("/notifications", protect, affiliateController.listNotifications);
router.post("/notifications/read-all", protect, affiliateController.markNotificationsRead);
router.patch("/notifications/:id/read", protect, affiliateController.markNotificationsRead);

// Own payout history
router.get("/payouts", protect, affiliateController.listMyPayouts);

// Own conversion/order audit trail
router.get("/conversions", protect, affiliateController.getMyConversions);

// Super Admin: list all affiliate accounts with aggregated stats
router.get("/", protect, authorize("super_admin"), affiliateController.adminListAffiliates);

// Super Admin: review all affiliate payout requests
router.get("/admin/payouts", protect, authorize("super_admin"), affiliateController.adminListPayouts);

// Public click tracking endpoint
router.get("/track/:code", affiliateController.trackClick);

// Request Affiliate Balance Payout (10,000 RWF Enforced)
router.post("/payouts/request", protect, affiliateController.requestPayout);

// Super Admin Payout Review and Settlement Execution
router.post(
  "/payouts/:payoutId/process",
  protect,
  authorize("super_admin"),
  affiliateController.adminProcessPayout
);

module.exports = router;