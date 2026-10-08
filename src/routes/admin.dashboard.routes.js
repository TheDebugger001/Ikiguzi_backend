const express = require("express");
const { protect, authorize } = require("../middleware/auth.middleware");
const dashboard = require("../controllers/admin.dashboard.controller");

const router = express.Router();
router.use(protect, authorize("super_admin"));
router.get("/overview", dashboard.getOverview);
router.get("/products", dashboard.getProducts);
router.get("/orders", dashboard.getOrders);

module.exports = router;
