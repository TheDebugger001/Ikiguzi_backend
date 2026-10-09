const wholesaleService = require("../services/wholesale.service");
const WholesaleOrder = require("../models/WholesaleOrder");
const paymentService = require("../services/payment.service");

exports.listMyWholesaleOrders = async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    let filter;
    if (req.user.role === "supplier") {
      const Supplier = require("../models/Supplier");
      const SupplierTeamMember = require("../models/SupplierTeamMember");
      let supplier = await Supplier.findOne({ user: req.user.id }).lean();
      if (!supplier) {
        const membership = await SupplierTeamMember.findOne({ user: req.user.id, status: "ACTIVE" }).lean();
        if (membership) supplier = await Supplier.findById(membership.supplier).lean();
      }
      if (!supplier) return res.status(403).json({ success: false, message: "Supplier profile not found." });
      filter = { supplier: supplier.user };
    } else {
      filter = { vendor: req.user.id };
    }
    const [orders, total] = await Promise.all([
      WholesaleOrder.find(filter)
        .populate("vendor", "Fullname companyName email")
        .populate("supplier", "Fullname companyName email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      WholesaleOrder.countDocuments(filter),
    ]);
    return res.status(200).json({
      success: true,
      orders,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getWholesaleOrderById = async (req, res) => {
  try {
    const order = await wholesaleService.getWholesaleOrderById({
      orderId: req.params.orderId,
      user: req.user,
    });
    return res.status(200).json({ success: true, data: order });
  } catch (error) {
    return res.status(404).json({ success: false, message: error.message });
  }
};

exports.createWholesaleOrder = async (req, res) => {
  try {
    const { supplierId, items, deliveryDetails } = req.body;
    const vendorId = req.user.id; // Extracted from Auth JWT

    const order = await wholesaleService.createWholesaleOrder({
      vendorId,
      supplierId,
      items,
      deliveryDetails,
    });

    return res.status(201).json({
      success: true,
      message: "Wholesale supply order created successfully.",
      data: order,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Payment for a wholesale order is initiated by the vendor. The money is held
// in escrow by the payment webhook — there is no public "hold escrow" route.
exports.initiatePayment = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: "phoneNumber is required." });
    }
    const result = await paymentService.initiateWholesalePaypackPayment({
      orderId: req.params.orderId,
      phoneNumber,
      reqUserId: req.user.id || String(req.user._id),
    });
    return res.status(200).json({
      success: true,
      message: result.message,
      paymentRef: result.paymentRef,
      paymentId: result.paymentId,
      amount: result.amount,
      gatewayReference: result.gatewayReference,
      status: result.status,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
      ...(error.details && { error: error.details }),
    });
  }
};

exports.getDeliveryOtp = async (req, res) => {
  try {
    const otp = await wholesaleService.getDeliveryOtp({
      orderId: req.params.orderId,
      user: req.user,
    });
    return res.status(200).json({ success: true, otp });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.confirmReceipt = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { otp, deliveryStatus } = req.body;

    const result = await wholesaleService.confirmReceiptAndRelease({
      orderId,
      vendorId: req.user.id || String(req.user._id),
      providedOtp: otp,
      deliveryStatus,
    });

    return res.status(200).json({
      success: true,
      message: "Wholesale order confirmed and escrow funds released to supplier.",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.markShipped = async (req, res) => {
  try {
    const { trackingNumber, carrier, note, expectedDeliveryAt } = req.body || {};
    const order = await wholesaleService.markWholesaleOrderShipped({
      orderId: req.params.orderId,
      supplierUserId: req.user.id || String(req.user._id),
      shipment: { trackingNumber, carrier, note, expectedDeliveryAt },
    });
    return res.status(200).json({ success: true, data: order });
  } catch (error) {
    const status = error.message === "Wholesale order not found." ? 404 : 400;
    return res.status(status).json({ success: false, message: error.message });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const { reason } = req.body || {};
    const role = req.user.role === "supplier" ? "supplier" : "vendor";
    const order = await wholesaleService.cancelWholesaleOrder({
      orderId: req.params.orderId,
      userId: req.user.id || String(req.user._id),
      role,
      reason,
    });
    return res.status(200).json({
      success: true,
      message: "Wholesale order cancelled.",
      data: order,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.disputeOrder = async (req, res) => {
  try {
    const { reason } = req.body || {};
    const order = await wholesaleService.reportWholesaleOrderProblem({
      orderId: req.params.orderId,
      userId: req.user.id || String(req.user._id),
      reason,
    });
    return res.status(200).json({
      success: true,
      message: "Order flagged for review.",
      data: order,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// Admin: refund a paid wholesale order (restores stock, marks payment refunded).
exports.adminRefundOrder = async (req, res) => {
  try {
    const { reason } = req.body || {};
    const result = await wholesaleService.refundWholesaleOrder({
      orderId: req.params.orderId,
      reason,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};