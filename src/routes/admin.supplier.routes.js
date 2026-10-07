// routes/admin.supplier.routes.js
const express = require("express");
const router = express.Router();
const supplier = require("../controllers/supplier.controller");
const dashboard = require("../controllers/supplier.dashboard.controller");
const { protect, authorize } = require("../middleware/auth.middleware");

router.use(protect, authorize("super_admin"));

router.get("/", supplier.adminGetSuppliers);                    // GET /api/admin/suppliers
router.patch("/:id/verify", supplier.adminVerifySupplier);      // PATCH /api/admin/suppliers/:id/verify
router.patch("/:id/status", supplier.adminUpdateSupplierStatus); // PATCH /api/admin/suppliers/:id/status
router.get("/supply-requests", dashboard.adminGetSupplyRequests);
router.patch("/supply-requests/:id", dashboard.adminUpdateSupplyRequest);
router.get("/payouts", dashboard.adminGetPayouts);
router.patch("/payouts/:id", dashboard.adminUpdatePayout);

module.exports = router;