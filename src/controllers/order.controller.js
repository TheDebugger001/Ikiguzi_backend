const mongoose = require("mongoose");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const Payment = require("../models/Payment");
const Settlement = require("../models/Settlement");
const LedgerEntry = require("../models/LedgerEntry");
const VendorWallet = require("../models/VendorWallet");
const payoutController = require("./payout.controller");
const socketService = require("../services/socket.service");
const affiliateAttribution = require("../services/affiliateAttribution.service");

// A cancelled/refunded/returned/failed order can never pay out affiliate
// commission: reverse whatever is still standing (idempotent per order).
const VOIDING_ORDER_STATUSES = ["CANCELLED", "REFUNDED", "RETURNED", "FAILED"];
const VOIDING_PAYMENT_STATUSES = ["REFUNDED", "FAILED"];
async function reverseCommissionIfVoided(order) {
  if (
    !VOIDING_ORDER_STATUSES.includes(order.orderStatus) &&
    !VOIDING_PAYMENT_STATUSES.includes(order.paymentStatus)
  ) {
    return;
  }
  try {
    await affiliateAttribution.reverseOrderCommission({
      orderId: order._id,
      key: `order-void:${order._id}`,
      reason: `Order ${order.orderStatus}/${order.paymentStatus}`,
    });
  } catch (err) {
    console.error(`Affiliate commission reversal failed for order ${order._id}:`, err.message);
  }
}

const checkoutService = require("../services/checkout.service");
const financialService = require("../services/financial.service");
const notifications = require("../services/notification.service");
const disbursementService = require("../services/disbursement.service");

const sendError = (res, error, fallback = "Something went wrong. Please try again.") => {
  if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
  console.error(error);
  return res.status(500).json({ message: fallback });
};

const deliveryFromBody = (body = {}) => ({
  shippingAddress: body.shippingAddress,
  recipient: body.recipient,
  deliveryMethod: body.deliveryMethod,
});

// @desc    Checkout the buyer's server-side cart & create a PENDING order
// @route   POST /api/orders/checkout
// @access  Private (Buyer/User)
exports.createCheckoutOrder = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: "Your cart is empty." });
    }

    const order = await checkoutService.createOrder({
      userId: req.user.id,
      lines: cart.items.map((item) => ({ productId: String(item.product), quantity: item.quantity })),
      delivery: deliveryFromBody(req.body),
      paymentMethod: req.body.paymentMethod,
      visitorId: req.body.visitorId,
    });

    cart.items = [];
    cart.totalAmount = 0;
    await cart.save();

    socketService.emitOrderCreated(order);
    notifications.orderPlaced(order).catch(() => {});
    return res.status(201).json({ message: "Order placed successfully", order });
  } catch (error) {
    return sendError(res, error, "We could not place your order. Please try again.");
  }
};

// @desc    Direct checkout ("Buy now") with items in the request body
// @route   POST /api/orders/direct-checkout
// @access  Private (Buyer/User)
exports.directCheckout = async (req, res) => {
  try {
    const order = await checkoutService.createOrder({
      userId: req.user.id,
      lines: req.body.items,
      delivery: deliveryFromBody(req.body),
      paymentMethod: req.body.paymentMethod,
      visitorId: req.body.visitorId,
    });

    socketService.emitOrderCreated(order);
    notifications.orderPlaced(order).catch(() => {});
    return res.status(201).json({ message: "Order placed successfully", order });
  } catch (error) {
    return sendError(res, error, "We could not place your order. Please try again.");
  }
};

// @desc    Get logged-in user's orders
// @route   GET /api/orders/my-orders
// @access  Private (Buyer/User)
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id }).sort({
      createdAt: -1,
    });
    return res.status(200).json({ orders });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get paid orders awaiting delivery confirmation
// @route   GET /api/orders/deliverable
// @desc    Paid orders waiting for delivery (scoped to the caller)
// @route   GET /api/orders/deliverable
exports.getDeliverable = async (req, res) => {
  try {
    const query = {
      paymentStatus: "PAID",
      orderStatus: { $nin: ["DELIVERED", "COMPLETED", "CANCELLED", "REFUNDED", "FAILED"] },
    };
    if (req.user.role === "vendor") query["items.vendor"] = req.user.id;
    if (["delivery", "courier"].includes(req.user.role)) query.courier = req.user.id;

    const orders = await Order.find(query)
      .select("-deliveryOtp")
      .populate("user", "Fullname phone")
      .populate("items.vendor", "Fullname companyName")
      .populate("courier", "Fullname phone")
      .sort({ createdAt: -1 });
    return res.status(200).json({ orders });
  } catch (error) {
    return sendError(res, error);
  }
};

// @desc    Get single order details
// @route   GET /api/orders/:id
// @access  Private
exports.getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === "undefined" || !mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }

    const order = await Order.findById(id)
      .populate("user", "Fullname email")
      .populate("items.vendor", "Fullname companyName email");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Verify ownership or vendor access
    const isBuyer = order.user && order.user._id.toString() === req.user.id.toString();
    const isVendor = order.items && order.items.some(
      (item) => item.vendor && item.vendor._id.toString() === req.user.id.toString(),
    );
    const isAdmin = req.user.role === "super_admin";

    if (!isBuyer && !isVendor && !isAdmin) {
      return res.status(403).json({ message: "Access denied." });
    }

    if (isBuyer || isAdmin) {
      return res.status(200).json({ order });
    }

    // A vendor only sees its own lines, and never the buyer's delivery code:
    // the code is the buyer's proof of receipt and must stay with the buyer.
    const vendorView = typeof order.toJSON === "function" ? order.toJSON() : { ...order };
    delete vendorView.deliveryOtp;
    vendorView.items = vendorView.items.filter(
      (item) => item.vendor && String(item.vendor._id || item.vendor) === String(req.user.id),
    );
    return res.status(200).json({ order: vendorView });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get orders containing vendor's products
// @route   GET /api/orders/vendor/orders
// @access  Private (Vendor)
exports.getVendorOrders = async (req, res) => {
  try {
    const vendorId = req.vendorId || req.targetVendorId || req.user.id;
    const vendorIds = [req.user.id.toString()];
    if (vendorId) vendorIds.push(vendorId.toString());

    const orders = await Order.find({ "items.vendor": { $in: [req.user.id, vendorId] } })
      .populate("user", "Fullname email")
      .sort({ createdAt: -1 });

    // Filter order items to only include products belonging to this vendor
    const filteredOrders = orders.map((order) => {
      const vendorItems = order.items.filter(
        (item) => item.vendor && vendorIds.includes(item.vendor.toString()),
      );

      return {
        _id: order._id,
        orderNumber: order.orderNumber,
        user: order.user,
        source: order.source || "ONLINE",
        customer: order.customer,
        paidOffline: order.paidOffline,
        paymentMethod: order.paymentMethod,
        shippingAddress: order.shippingAddress,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        createdAt: order.createdAt,
        items: vendorItems,
        vendorSubtotal: vendorItems.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0,
        ),
        // Delivery fees for this seller's parcels (paid to the seller, no commission).
        vendorShippingFee: (order.shippingBreakdown || [])
          .filter((s) => s.vendor && vendorIds.includes(s.vendor.toString()))
          .reduce((sum, s) => sum + (s.fee || 0), 0),
        shippingMethod: order.shippingMethod,
      };
    });

    return res.status(200).json({ orders: filteredOrders });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Update vendor-specific order status / item status
// @route   PATCH /api/orders/vendor/:id/status
// @access  Private (Vendor)
// Fulfilment steps a seller (or admin) may move a PAID order through.
// DELIVERED is only reachable through delivery confirmation with the buyer's
// code, and payment status only through the payment provider.
const FULFILMENT_FLOW = ["CONFIRMED", "PROCESSING", "READY_FOR_SHIPMENT", "SHIPPED", "OUT_FOR_DELIVERY"];
const DELIVERY_OTP_MAX_ATTEMPTS = 5;

async function advanceFulfilment({ order, status, actor }) {
  const next = String(status || "").toUpperCase();
  if (!FULFILMENT_FLOW.includes(next)) {
    throw checkoutService.httpError(400, "Choose one of: processing, ready for shipment, shipped, out for delivery. Delivery is confirmed with the buyer's code.");
  }
  if (order.paymentStatus !== "PAID") {
    throw checkoutService.httpError(400, "Only paid orders can be fulfilled.");
  }
  const current = FULFILMENT_FLOW.indexOf(order.orderStatus === "PENDING" ? "CONFIRMED" : order.orderStatus);
  if (current === -1) {
    throw checkoutService.httpError(400, `This order is ${String(order.orderStatus).toLowerCase()} and can no longer change.`);
  }
  if (FULFILMENT_FLOW.indexOf(next) <= current) {
    throw checkoutService.httpError(400, "An order can only move forward.");
  }
  order.orderStatus = next;
  if (next === "SHIPPED" && !order.shippedAt) order.shippedAt = new Date();
  await order.save();
  socketService.emitOrderStatusUpdate(order);
  notifications.orderStatusChanged(order, actor).catch(() => {});
  return order;
}

// @desc    Seller moves its order forward (processing → shipped → out for delivery)
// @route   PATCH /api/orders/vendor/status   { orderId, status }
// @access  Private (Vendor, vendor staff with canManageOrders, Super Admin)
exports.updateVendorOrderStatus = async (req, res) => {
  try {
    const { orderId, status, paymentStatus } = req.body;
    if (paymentStatus !== undefined) {
      return res.status(400).json({ message: "Payment status is set by the payment provider and cannot be changed here." });
    }
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found." });

    const vendorIds = [String(req.user.id)];
    if (req.vendorId || req.targetVendorId) vendorIds.push(String(req.vendorId || req.targetVendorId));
    const ownsItems = order.items.some((item) => item.vendor && vendorIds.includes(String(item.vendor)));
    if (!ownsItems && req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Access denied: You do not own items in this order." });
    }

    if (String(status || "").toUpperCase() === "CANCELLED") {
      const result = await cancelOrder({ orderId: order._id, actor: req.user });
      return res.status(200).json({ message: "Order cancelled and the buyer refunded.", order: result.order });
    }
    await advanceFulfilment({ order, status, actor: req.user });
    return res.status(200).json({ message: "Order updated successfully", order });
  } catch (error) {
    return sendError(res, error);
  }
};

// @desc    Update Order Status (e.g., PENDING -> PROCESSING -> SHIPPED -> DELIVERED)
// @route   PATCH /api/orders/:id/status
// @access  Private (Vendor / Admin)
// @desc    Move an order forward by id (same rules as the vendor route)
// @route   PATCH /api/orders/:id/status   { status }
// @access  Private (Vendor owning items, Super Admin)
exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "A valid order ID is required." });
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found." });

    if (req.user.role !== "super_admin") {
      const ownsItems = order.items.some((item) => item.vendor && String(item.vendor) === String(req.user.id));
      if (!ownsItems) return res.status(403).json({ message: "Access denied: You do not own items in this order." });
    }

    if (String(req.body.status || "").toUpperCase() === "CANCELLED") {
      const result = await cancelOrder({ orderId: order._id, actor: req.user });
      return res.status(200).json({ message: "Order cancelled and the buyer refunded.", order: result.order });
    }
    await advanceFulfilment({ order, status: req.body.status, actor: req.user });
    return res.status(200).json({ message: `Order status updated to ${order.orderStatus}.`, order });
  } catch (error) {
    return sendError(res, error);
  }
};


// @desc    Confirm Order Delivery & Release Escrow Funds
// @route   PATCH /api/orders/:id/deliver
// @access  Private (Admin / Delivery Agent)
// @desc    Confirm delivery with the buyer's 6-digit code and release escrow
// @route   PATCH /api/orders/:id/deliver   { deliveryOtp }
// @access  Private (Super Admin, assigned courier, or a vendor for its own items)
// A vendor's confirmation releases only that vendor's money; the order is
// DELIVERED once every vendor in it has handed over (or a courier/admin
// confirms the whole order).
exports.confirmOrderDelivery = async (req, res) => {
  const { id } = req.params;
  if (!id || !mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "A valid order ID is required." });
  }
  const code = String(req.body.deliveryOtp || "").trim();

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findById(id).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Order not found." });
    }

    const role = req.user.role;
    const orderVendors = [...new Set(order.items.filter((i) => i.vendor).map((i) => String(i.vendor)))];
    const isVendor = role === "vendor" || (role === "super_admin" && req.user.isSellerEnabled && orderVendors.includes(String(req.user.id)));
    if (role === "vendor" && !orderVendors.includes(String(req.user.id))) {
      await session.abortTransaction();
      return res.status(403).json({ message: "You do not sell items in this order." });
    }
    if (role === "delivery" && String(order.courier || "") !== String(req.user.id)) {
      await session.abortTransaction();
      return res.status(403).json({ message: "This delivery is not assigned to you." });
    }

    if (["DELIVERED", "COMPLETED"].includes(order.orderStatus)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "This order is already delivered." });
    }
    if (["CANCELLED", "REFUNDED", "RETURNED", "FAILED"].includes(order.orderStatus)) {
      await session.abortTransaction();
      return res.status(400).json({ message: `A ${order.orderStatus.toLowerCase()} order cannot be delivered.` });
    }
    // Only paid orders can be delivered. This also keeps a DISPUTED order's
    // escrow frozen until an admin resolves the dispute.
    if (order.paymentStatus !== "PAID") {
      await session.abortTransaction();
      return res.status(400).json({
        message: order.paymentStatus === "DISPUTED"
          ? "This order is under dispute review and cannot be delivered yet."
          : "Only paid orders can be marked as delivered.",
      });
    }

    if ((order.deliveryOtpAttempts || 0) >= DELIVERY_OTP_MAX_ATTEMPTS) {
      await session.abortTransaction();
      return res.status(423).json({ message: "Too many wrong codes. MVEC support must confirm this delivery." });
    }
    if (!order.deliveryOtp || code !== order.deliveryOtp) {
      await session.abortTransaction();
      await Order.updateOne({ _id: order._id }, { $inc: { deliveryOtpAttempts: 1 } });
      const left = DELIVERY_OTP_MAX_ATTEMPTS - (order.deliveryOtpAttempts || 0) - 1;
      return res.status(400).json({ message: left > 0 ? `Wrong delivery code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Wrong delivery code. This delivery is now locked for MVEC support." });
    }

    const releaseFor = isVendor && role !== "super_admin" ? [String(req.user.id)] : orderVendors;
    for (const vendorId of releaseFor) {
      await releaseVendorEscrowFunds(order._id, vendorId, session);
    }
    const delivered = new Set([...(order.deliveredVendors || []).map(String), ...releaseFor]);
    order.deliveredVendors = [...delivered];

    const complete = orderVendors.every((v) => delivered.has(v));
    if (complete) {
      order.orderStatus = "DELIVERED";
      order.isDelivered = true;
      order.deliveredAt = new Date();
    }
    await order.save({ session });

    // Affiliate commission is approved once the whole order is delivered.
    if (complete) {
      await financialService.approveAffiliateCommissionsForOrder({ orderId: order._id, session });
    }

    await session.commitTransaction();
    socketService.emitOrderStatusUpdate(order);
    notifications.orderDelivered(order, { complete, vendorIds: releaseFor }).catch(() => {});

    return res.status(200).json({
      message: complete
        ? "Delivery confirmed. The seller's payment has been released."
        : "Your items are confirmed delivered and your payment is released. The order completes when the other sellers deliver.",
      order: (() => { const o = order.toJSON(); delete o.deliveryOtp; return o; })(),
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    return sendError(res, error, "We could not confirm this delivery. Please try again.");
  } finally {
    session.endSession();
  }
};

// @desc    Assigned courier picked the parcel up
// @route   PATCH /api/orders/:id/out-for-delivery
// @access  Private (assigned courier, Super Admin)
exports.markOutForDelivery = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "A valid order ID is required." });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found." });
    if (req.user.role !== "super_admin" && String(order.courier || "") !== String(req.user.id)) {
      return res.status(403).json({ message: "This delivery is not assigned to you." });
    }
    await advanceFulfilment({ order, status: "OUT_FOR_DELIVERY", actor: req.user });
    return res.status(200).json({ message: "Marked out for delivery. The buyer has been notified.", order });
  } catch (error) {
    return sendError(res, error);
  }
};

// @desc    Assign (or clear) the courier delivering an order
// @route   PATCH /api/orders/:id/courier   { courierId | null }
// @access  Private (Super Admin)
exports.assignCourier = async (req, res) => {
  try {
    const { id } = req.params;
    const { courierId } = req.body;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "A valid order ID is required." });
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found." });
    if (order.paymentStatus !== "PAID" || ["DELIVERED", "COMPLETED", "CANCELLED"].includes(order.orderStatus)) {
      return res.status(400).json({ message: "Only paid orders that are not yet delivered can be assigned." });
    }
    if (courierId) {
      const User = require("../models/User");
      const courier = mongoose.isValidObjectId(courierId) ? await User.findOne({ _id: courierId, role: "delivery" }) : null;
      if (!courier) return res.status(400).json({ message: "Choose a courier account." });
      order.courier = courier._id;
    } else {
      order.courier = null;
    }
    await order.save();
    socketService.emitOrderStatusUpdate(order);
    if (order.courier) notifications.courierAssigned(order).catch(() => {});
    return res.status(200).json({ message: order.courier ? "Courier assigned." : "Courier removed.", order });
  } catch (error) {
    return sendError(res, error);
  }
};

// @desc    Get all orders across marketplace (Admin)
// @route   GET /api/orders
// @access  Private (Super Admin / Admin)
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("user", "Fullname email phone")
      .populate("items.vendor", "Fullname companyName email phone")
      .sort({ createdAt: -1 });

    return res.status(200).json({ orders });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/*
 * Buyer-initiated cancellation.
 *  - An unpaid order can be cancelled at any time before payment.
 *  - A paid order can be cancelled within 30 minutes of payment, before the
 *    seller starts shipping. Held escrow is reversed and a refund is recorded.
 * Stock is always returned.
 */
// @route   POST /api/orders/:id/cancel
// @access  Private (Buyer / Super Admin)
const BUYER_CANCEL_WINDOW_MS = 30 * 60 * 1000;
const BUYER_CANCELLABLE = ["PENDING", "CONFIRMED", "PROCESSING"];
const SELLER_CANCELLABLE = ["PENDING", "CONFIRMED", "PROCESSING", "READY_FOR_SHIPMENT"];

/**
 * Cancel an order and undo everything it set in motion: held escrow, payment
 * records, stock, affiliate commission. A paid order's money is sent back to
 * the number that paid. Used by buyers (30 minutes after paying), sellers who
 * cannot fulfil (before shipping) and admins.
 * @returns {{ order, isPaid, refundSent }}
 */
async function cancelOrder({ orderId, actor, reason }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  let order;
  let isPaid = false;
  let paidWith = null;
  try {
    order = await Order.findById(orderId).session(session);
    if (!order) throw checkoutService.httpError(404, "Order not found.");

    const role = actor.role;
    const isBuyer = String(order.user) === String(actor.id);
    const sellerOwnsAll = order.items.length > 0 && order.items.every((i) => i.vendor && String(i.vendor) === String(actor.id));
    if (role === "super_admin") {
      // admins may cancel anything not yet shipped
    } else if (isBuyer) {
      if (!BUYER_CANCELLABLE.includes(order.orderStatus)) {
        throw checkoutService.httpError(400, "This order is already being delivered or closed and cannot be cancelled.");
      }
    } else if (role === "vendor" && order.items.some((i) => String(i.vendor) === String(actor.id))) {
      if (!sellerOwnsAll) throw checkoutService.httpError(400, "This order includes other sellers' items. Ask MVEC support to cancel it.");
    } else {
      throw checkoutService.httpError(403, "Access denied.");
    }
    if (!isBuyer && !SELLER_CANCELLABLE.includes(order.orderStatus)) {
      throw checkoutService.httpError(400, "Orders can only be cancelled before they ship.");
    }
    if (!["PENDING", "PAID"].includes(order.paymentStatus)) {
      throw checkoutService.httpError(400, "This order is under review and cannot be cancelled right now.");
    }

    isPaid = order.paymentStatus === "PAID";
    if (isPaid) {
      if (isBuyer && role !== "super_admin") {
        const paidAt = new Date(order.paidAt || order.updatedAt || order.createdAt).getTime();
        if (!Number.isFinite(paidAt) || Date.now() - paidAt >= BUYER_CANCEL_WINDOW_MS) {
          throw checkoutService.httpError(400, "The 30-minute cancellation period has ended. Use Report a problem instead.");
        }
      }
      await financialService.refundHeldEscrowForOrder({
        orderId: order._id,
        session,
        reversalKey: `order-cancel:${order._id}`,
        reversalReason: "Order cancelled and refunded",
      });
      paidWith = await Payment.findOne({ parentOrder: order._id, status: "SUCCESS" }).sort({ paidAt: -1, createdAt: -1 }).session(session);
      await Payment.updateMany({ parentOrder: order._id, status: "SUCCESS" }, { status: "REFUNDED" }, { session });
      order.paymentStatus = "REFUNDED";
    } else {
      await Payment.updateMany({ parentOrder: order._id, status: "PENDING" }, { status: "CANCELLED" }, { session });
    }
    order.cancellationReason = reason || (isBuyer
      ? (isPaid ? "Buyer cancelled within 30 minutes of payment" : "Buyer cancelled before payment")
      : role === "vendor" ? "Seller could not fulfil the order" : "Cancelled by MVEC");
    order.orderStatus = "CANCELLED";
    await order.save({ session });
    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  // The cancellation is committed; the follow-ups below are logged on failure
  // instead of being reported as a failed cancel.
  try {
    await affiliateAttribution.reverseOrderCommission({
      orderId: order._id,
      key: `order-cancel:${order._id}`,
      reason: isPaid ? "Order cancelled and refunded" : "Order cancelled before payment",
    });
  } catch (err) {
    console.error(`Affiliate commission reversal failed for order ${order._id}:`, err.message);
  }
  await checkoutService.restoreStock(
    (order.items || []).filter((item) => item.product).map((item) => ({ product: item.product, quantity: item.quantity })),
  );
  socketService.emitOrderStatusUpdate(order);

  let refundSent = false;
  if (isPaid) {
    const refundPhone = paidWith?.phoneNumber || order.recipient?.phone;
    if (refundPhone) {
      const refund = await disbursementService.queue({
        kind: "REFUND",
        recipient: order.user,
        phone: refundPhone,
        amount: order.totalAmount,
        order: order._id,
        idempotencyKey: `refund:${order._id}`,
      }).catch((err) => { console.error("Refund queue failed:", err.message); return null; });
      refundSent = refund?.status === "SUCCESS";
    }
  }
  await notifications.orderCancelled(order, {
    refunded: isPaid,
    reason: String(order.user) === String(actor.id) ? undefined : `${order.cancellationReason}.${isPaid ? " Your full refund is on its way to your mobile money." : ""}`,
  }).catch(() => {});
  return { order, isPaid, refundSent };
}

// @desc    Cancel an order (buyer, the seller before shipping, or an admin)
// @route   POST /api/orders/:id/cancel   { reason? }
// @access  Private
exports.cancelOrderByBuyer = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : undefined;
    const { order, isPaid, refundSent } = await cancelOrder({ orderId: req.params.id, actor: req.user, reason });
    return res.status(200).json({
      message: isPaid
        ? refundSent
          ? "Order cancelled. The refund was sent to the buyer's mobile money number."
          : "Order cancelled. The refund is being sent to the buyer's mobile money number."
        : "Order cancelled.",
      order,
    });
  } catch (error) {
    return sendError(res, error, "We could not cancel this order. Please try again.");
  }
};

/**
 * Internal Escrow Release Helper
 * One settlement exists per order item, so a vendor can have several. Each is
 * released through the financial service, which keeps the double-entry ledger,
 * platform shares and wallets consistent (and is the same code the admin manual
 * release uses).
 */
async function releaseVendorEscrowFunds(orderId, vendorId, session) {
  const settlements = await Settlement.find({
    order: orderId,
    vendor: vendorId,
    status: "HELD",
  }).session(session);

  for (const settlement of settlements) {
    await financialService.releaseEscrowToVendor({ settlementId: settlement._id, session });
  }
}

// Delegate to the finance service so delivery releases escrow exactly like
// the admin release does: correct double-entry ledger rows, platform /
// developer / admin shares and wallet balances in one place.
async function releaseSettlement(settlement, orderId, vendorId, session) {
  await financialService.releaseEscrowToVendor({ settlementId: settlement._id, session });
}
