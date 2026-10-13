const mongoose = require("mongoose");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const PaymentWebhookLog = require("../models/PaymentWebhookLog");
const financialService = require("./financial.service");
const pricingService = require("./pricing.service");
const socketService = require("./socket.service");
const affiliateAttribution = require("./affiliateAttribution.service");

/**
 * Record a webhook callback that was intentionally ignored (e.g. non-successful
 * status). Persisting it under the external id keeps our idempotency semantics
 * clear and avoids it ever being confused with a successful transaction.
 */
exports.recordIgnoredWebhook = async ({ provider, externalTransactionId, amount = 0, payload = {} }) => {
  if (!externalTransactionId) return null;
  try {
    return await PaymentWebhookLog.create({
      provider,
      externalTransactionId,
      internalOrderId: null,
      status: "IGNORED",
      amount: Number(amount) || 0,
      currency: "RWF",
      rawPayload: payload,
      errorMessage: "Transaction status not SUCCESSFUL. Ignored.",
    });
  } catch (err) {
    // Duplicate idempotency record — safe to swallow.
    return null;
  }
};


/**
 * Process payment callback idempotently
 */
exports.processPaymentWebhook = async ({ provider, externalTransactionId, orderId, paymentId = null, amount, payload, gatewayFee = 0 }) => {
  // 1. Idempotency Check: Prevent duplicate processing if already handled
  const existingLog = await PaymentWebhookLog.findOne({ externalTransactionId });
  if (existingLog && existingLog.status === "PROCESSED") {
    return { status: "ALREADY_PROCESSED", log: existingLog };
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 2. Fetch Order
    const order = await Order.findById(orderId).session(session);
    if (!order) {
      throw new Error(`Order #${orderId} not found.`);
    }

    if (order.paymentStatus === "PAID") {
      await session.abortTransaction();
      session.endSession();
      return { status: "ALREADY_PAID", order };
    }

    // A late payment on a cancelled/expired order must not revive it: its
    // stock has already been returned. The failure is logged below so an
    // admin can refund the buyer.
    if (order.orderStatus === "CANCELLED") {
      throw new Error(`Order #${orderId} was cancelled before this payment arrived. Refund required.`);
    }

    // 3. Verify Amount
    if (order.totalAmount !== amount) {
      throw new Error(`Mismatched payment amount. Expected: ${order.totalAmount}, Received: ${amount}`);
    }

    // 4. Update Order Status & Legacy Status Field
    order.paymentStatus = "PAID";
    order.orderStatus = "PROCESSING";
    order.paidAt = new Date();
    if (!order.deliveryOtp) {
      order.deliveryOtp = Math.floor(100000 + Math.random() * 900000).toString();
    }
    await order.save({ session });

    // 4b. Update Payment Record Status
    // Target the exact payment attempt when known; an order can have several.
    await Payment.findOneAndUpdate(
      paymentId ? { _id: paymentId } : { parentOrder: order._id },
      {
        status: "SUCCESS",
        gatewayReference: externalTransactionId,
        gatewayFee,
        paidAt: new Date(),
      },
      { session }
    );

    // 5. Generate Pricing Snapshots & Lock Escrow Funds per Vendor Item
    for (const item of order.items) {
      // Attribution is per order item: only promoted items earn a commission.
      const aff = affiliateAttribution.itemAffiliate(order, item);
      const hasAffiliate = !!aff;
      const affiliateUserId = hasAffiliate ? aff.user : null;

      const snapshot = await pricingService.createItemPricingSnapshot({
        orderId: order._id,
        item,
        session,
        hasAffiliate,
        gatewayFee,
      });

      const settlement = await financialService.lockPaymentInEscrow({
        orderId: order._id,
        vendorId: item.vendor,
        grossAmount: snapshot.grossTotal,
        commissionAmount: snapshot.commissionAmount,
        session,
        split: snapshot,
        affiliateUserId,
        orderItemId: item._id,
      });

      await affiliateAttribution.recordConversion({ order, item, settlement, session });
    }

    // 5b. Delivery fees are held for the seller of each parcel, commission-free.
    for (const parcel of order.shippingBreakdown || []) {
      if (!parcel.vendor || !(parcel.fee > 0)) continue;
      await financialService.lockPaymentInEscrow({
        orderId: order._id,
        vendorId: parcel.vendor,
        grossAmount: parcel.fee,
        commissionAmount: 0,
        session,
      });
    }

    // 6. Record or Update Idempotency Webhook Log & Explicitly Clear Previous Errors
    const webhookLog = await PaymentWebhookLog.findOneAndUpdate(
      { externalTransactionId },
      {
        provider,
        externalTransactionId,
        internalOrderId: order._id,
        status: "PROCESSED",
        errorMessage: null, // Explicitly reset stale validation error from prior retries
        amount,
        rawPayload: payload,
      },
      { upsert: true, new: true, session }
    );

    await session.commitTransaction();
    session.endSession();

    // Tell the buyer's open payment page (and dashboards) straight away.
    socketService.emitOrderStatusUpdate(order);
    socketService.emitToRoom(`user:${order.user}`, "payment_confirmed", { orderId: order._id.toString() });
    await require("./notification.service").paymentConfirmed(order).catch((err) => console.error("Payment notification failed:", err.message));

    return { status: "SUCCESS", order, webhookLog };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    // Log failure record for auditing
    await PaymentWebhookLog.findOneAndUpdate(
      { externalTransactionId },
      {
        provider,
        externalTransactionId,
        internalOrderId: orderId,
        status: "FAILED",
        amount,
        rawPayload: payload,
        errorMessage: error.message,
      },
      { upsert: true }
    );

    throw error;
  }
};
/**
 * Apply a final Paypack result to a payment. Used by both the Paypack webhook
 * and the status-polling endpoint, so it must be safe to call more than once.
 *
 * Payments linked to an order go through processPaymentWebhook (escrow and
 * commission); standalone payments only change their own status.
 */
exports.settlePaypackPayment = async ({ payment, status, amount, fee = 0, payload = {} }) => {
  if (status === "SUCCESSFUL") {
    if (payment.parentOrder) {
      return exports.processPaymentWebhook({
        provider: "PAYPACK",
        externalTransactionId: payment.gatewayReference,
        orderId: payment.parentOrder,
        paymentId: payment._id,
        amount,
        payload,
        gatewayFee: fee,
      });
    }

    if (Number(amount) !== payment.amount) {
      throw new Error(`Mismatched payment amount. Expected: ${payment.amount}, Received: ${amount}`);
    }

    // Only a PENDING payment can transition, which makes repeated callbacks no-ops.
    const updated = await Payment.findOneAndUpdate(
      { _id: payment._id, status: "PENDING" },
      { status: "SUCCESS", paidAt: new Date(), gatewayFee: fee, gatewayResponse: payload },
      { returnDocument: "after" }
    );
    return { status: updated ? "SUCCESS" : "ALREADY_PROCESSED", payment: updated };
  }

  if (status === "FAILED") {
    const updated = await Payment.findOneAndUpdate(
      { _id: payment._id, status: "PENDING" },
      { status: "FAILED", gatewayResponse: payload },
      { returnDocument: "after" }
    );
    return { status: updated ? "FAILED" : "ALREADY_PROCESSED", payment: updated };
  }

  return { status: "PENDING" };
};
