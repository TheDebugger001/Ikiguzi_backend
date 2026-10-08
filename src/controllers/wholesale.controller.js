const wholesaleService = require("../services/wholesale.service");
const WholesaleOrder = require("../models/WholesaleOrder");

exports.listMyWholesaleOrders = async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    const owner = req.user.role === "supplier" ? "supplier" : "vendor";
    const filter = { [owner]: req.user.id };
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

exports.createWholesaleOrder = async (req, res) => {
  try {
    const { supplierId, items } = req.body;
    const vendorId = req.user.id; // Extracted from Auth JWT

    const order = await wholesaleService.createWholesaleOrder({
      vendorId,
      supplierId,
      items,
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

exports.holdEscrow = async (req, res) => {
  try {
    const { orderId } = req.params;
    const updatedOrder = await wholesaleService.holdWholesaleEscrow(orderId);

    return res.status(200).json({
      success: true,
      message: "Funds locked in escrow successfully.",
      data: updatedOrder,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.confirmReceipt = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { otp } = req.body;
    const order = await WholesaleOrder.findOne({
      _id: orderId,
      vendor: req.user.id,
    });
    if (!order) {
      return res.status(404).json({ success: false, message: "Wholesale order not found." });
    }

    const result = await wholesaleService.confirmReceiptAndRelease(orderId, otp);

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
    const order = await wholesaleService.markWholesaleOrderShipped(
      req.params.orderId,
      req.user.id,
    );
    return res.status(200).json({ success: true, data: order });
  } catch (error) {
    const status = error.message === "Wholesale order not found." ? 404 : 400;
    return res.status(status).json({ success: false, message: error.message });
  }
};