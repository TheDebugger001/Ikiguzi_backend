const express = require("express");
const router = express.Router();
const supplier = require("../controllers/supplier.controller");
const dashboard = require("../controllers/supplier.dashboard.controller");
const { protect, authorize, requireOnboarded } = require("../middleware/auth.middleware");
const { checkSupplierPermission } = require("../middleware/supplierTeam.middleware");
const requireSupplier = [protect, authorize("supplier")];

// ─── PUBLIC ROUTES ──────────────────────────────────────────────────────────
router.get("/", supplier.getSuppliers);                    // GET /api/suppliers?q=&location=&page=

// ─── PRIVATE: SUPPLIER'S OWN WHOLESALE CATALOG ──────────────────────────────
// NOTE: /me/* must be registered ahead of /:idOrSlug and /:id/products so that
// "me" is interpreted as a self-reference instead of a supplier id.
// Mutating routes are guarded by the caller's supplier team role: team members
// only get what their role allows, the supplier owner always passes.
router.get("/me/products", protect, authorize("supplier"), supplier.getMyWholesaleProducts);
router.post("/me/products", protect, authorize("supplier"), requireOnboarded, checkSupplierPermission("catalog"), supplier.createWholesaleProduct);
router.put("/me/products/:productId", protect, authorize("supplier"), requireOnboarded, checkSupplierPermission("catalog"), supplier.updateWholesaleProduct);
router.delete("/me/products/:productId", protect, authorize("supplier"), requireOnboarded, checkSupplierPermission("catalog"), supplier.deleteWholesaleProduct);

// Supplier dashboard: finance, analytics, operations, reviews and roster.
router.get("/me/finance/summary", ...requireSupplier, dashboard.getFinanceSummary);
router.get("/me/finance/ledger", ...requireSupplier, dashboard.getFinanceLedger);
router.get("/me/finance/payouts", ...requireSupplier, dashboard.getPayouts);
router.post("/me/finance/payouts", ...requireSupplier, checkSupplierPermission("finance"), dashboard.requestPayout);
router.get("/me/finance/analytics", ...requireSupplier, dashboard.getAnalytics);

router.get("/me/deliveries", ...requireSupplier, dashboard.getDeliveries);
router.get("/me/settlements", ...requireSupplier, dashboard.getSettlements);
router.get("/me/delivery/summary", ...requireSupplier, dashboard.getDeliverySummary);

router.get("/me/supply-requests/process", ...requireSupplier, dashboard.getSupplyProcess);
router.get("/me/supply-requests", ...requireSupplier, dashboard.getSupplyRequests);
router.post("/me/supply-requests", ...requireSupplier, checkSupplierPermission("supply"), dashboard.createSupplyRequest);
router.post("/me/supply-requests/:id/cancel", ...requireSupplier, checkSupplierPermission("supply"), dashboard.cancelSupplyRequest);
router.post("/me/supply-requests/:id/resubmit", ...requireSupplier, checkSupplierPermission("supply"), dashboard.resubmitSupplyRequest);

router.get("/me/team", ...requireSupplier, dashboard.getTeam);
router.get("/me/team/summary", ...requireSupplier, dashboard.getTeamSummary);
router.post("/me/team", ...requireSupplier, checkSupplierPermission("team"), dashboard.addTeamMember);
router.patch("/me/team/:memberId", ...requireSupplier, checkSupplierPermission("team"), dashboard.updateTeamMember);
router.delete("/me/team/:memberId", ...requireSupplier, checkSupplierPermission("team"), dashboard.removeTeamMember);

router.get("/me/reviews", ...requireSupplier, dashboard.getReviews);

// Vendors may review a supplier after completing a wholesale order.
router.post("/:supplierId/reviews", protect, authorize("vendor"), dashboard.createSupplierReview);

// ─── PRIVATE: SUPPLIER'S OWN PROFILE ────────────────────────────────────────
router.post("/onboard", protect, authorize("supplier"), supplier.onboardSupplier);
router.get("/me/profile", protect, authorize("supplier"), supplier.getMyProfile);
router.patch("/me/profile", protect, authorize("supplier"), checkSupplierPermission("profile"), supplier.updateMyProfile);

router.get("/:idOrSlug", supplier.getSupplierByIdOrSlug);  // GET /api/suppliers/:idOrSlug
router.get("/:id/products", supplier.getSupplierProducts); // GET /api/suppliers/:id/products

module.exports = router;
