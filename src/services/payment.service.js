const mongoose = require("mongoose");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const WholesaleOrder = require("../models/WholesaleOrder");
const PaymentWebhookLog = require("../models/PaymentWebhookLog");
const ConversionAudit = require("../models/ConversionAudit");
const AffiliateLink = require("../models/AffiliateLink");
const financialService = require("./financial.service");
const pricingService = require("./pricing.service");
const wholesaleService = require("./wholesale.service");

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

    // 3. Verify Amount
    if (order.totalAmount !== amount) {
      throw new Error(`Mismatched payment amount. Expected: ${order.totalAmount}, Received: ${amount}`);
    }

    // 4. Update Order Status & Legacy Status Field
    order.paymentStatus = "PAID";
    order.orderStatus = "PROCESSING";
    order.status = "PAID"; // Reconcile top-level order status
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
    const hasAffiliateOrder = !!(order.affiliateUser && order.affiliateCode);
    const affiliateUserId = hasAffiliateOrder ? order.affiliateUser : null;
    const affiliateRate = Number(order.affiliateCommissionRate) || null;
    // When product-scoped, only these product ids earn commission.
    const productScoped = Array.isArray(order.affiliateProductIds) && order.affiliateProductIds.length > 0;
    const scopedIds = productScoped
      ? order.affiliateProductIds.map((id) => String(id))
      : null;
    const itemAffiliate = (item) => {
      const isScoped = scopedIds !== null
        ? scopedIds.includes(String(item.product || ""))
        : true;
      return hasAffiliateOrder && isScoped;
    };

    // Aggregate affiliate conversion data across the eligible items so we can
    // write a single ConversionAudit row per order.
    const conversion = { value: 0, commission: 0 };

    for (const item of order.items) {
      const hasAffiliate = itemAffiliate(item);
      const snapshot = await pricingService.createItemPricingSnapshot({
        orderId: order._id,
        item,
        session,
        hasAffiliate,
        gatewayFee,
        affiliateRatePercent: hasAffiliate ? affiliateRate : null,
      });

      await financialService.lockPaymentInEscrow({
        orderId: order._id,
        vendorId: item.vendor,
        grossAmount: snapshot.grossTotal,
        commissionAmount: snapshot.commissionAmount,
        session,
        split: snapshot,
        affiliateUserId,
      });

      if (hasAffiliate) {
        conversion.value += Number(snapshot.grossTotal) || 0;
        conversion.commission += Number(snapshot.affiliateShare) || 0;
      }
    }

    // 5b. Record the conversion and bump the link counter once per order.
    if (hasAffiliateOrder && conversion.commission > 0) {
      const targetProduct =
        productScoped && scopedIds.length === 1
          ? (() => {
              const match = order.affiliateProductIds.find((id) => String(id) === scopedIds[0]);
              return match || null;
            })()
          : null;
      await ConversionAudit.create(
        [
          {
            affiliateUser: affiliateUserId,
            link: order.affiliateLink || null,
            targetProduct,
            order: order._id,
            referralCode: order.affiliateCode,
            conversionValue: Math.round(conversion.value),
            commissionEarned: Math.round(conversion.commission),
            status: "PENDING",
          },
        ],
        { session }
      );
      if (order.affiliateLink) {
        await AffiliateLink.updateOne(
          { _id: order.affiliateLink },
          { $inc: { conversionCount: 1 } }
        ).session(session);
      }
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
 * Process a wholesale (B2B) payment callback idempotently. The callback is
 * otherwise identical to a retail Paypack callback, but routes the money into
 * the wholesale escrow flow instead of per-item retail settlements.
 */
exports.processWholesalePaymentWebhook = async ({ provider, externalTransactionId, paymentId = null, amount, payload, gatewayFee = 0 }) => {
  const existingLog = await PaymentWebhookLog.findOne({ externalTransactionId });
  if (existingLog && existingLog.status === "PROCESSED") {
    return { status: "ALREADY_PROCESSED", log: existingLog };
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment = paymentId
      ? await Payment.findById(paymentId).session(session)
      : await Payment.findOne({ gatewayReference: externalTransactionId }).session(session);
    if (!payment) throw new Error("Payment record not found.");

    const order = await WholesaleOrder.findById(payment.parentOrder).session(session);
    if (!order) throw new Error(`Wholesale order #${payment.parentOrder} not found.`);

    if (order.status === "ESCROW_HELD" && order.paymentStatus === "PAID") {
      await session.abortTransaction();
      session.endSession();
      return { status: "ALREADY_PAID", order };
    }

    // Verify the amount matches the order exactly.
    const expected = Number(order.totalAmount);
    const received = Number(amount);
    if (!(Math.abs(expected - received) < 1)) {
      throw new Error(`Mismatched payment amount. Expected: ${expected}, Received: ${received}`);
    }

    await Payment.findByIdAndUpdate(
      payment._id,
      {
        status: "SUCCESS",
        gatewayReference: externalTransactionId,
        gatewayFee: Number(gatewayFee) || 0,
        paidAt: new Date(),
      },
      { session }
    );

    await wholesaleService.holdWholesaleEscrow({
      orderId: order._id,
      paymentRef: externalTransactionId,
      session,
    });

    const webhookLog = await PaymentWebhookLog.findOneAndUpdate(
      { externalTransactionId },
      {
        provider,
        externalTransactionId,
        internalOrderId: order._id,
        status: "PROCESSED",
        errorMessage: null,
        amount: expected,
        rawPayload: payload,
      },
      { upsert: true, new: true, session }
    );

    await session.commitTransaction();
    session.endSession();

    return { status: "SUCCESS", order, webhookLog };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    await PaymentWebhookLog.findOneAndUpdate(
      { externalTransactionId },
      {
        provider,
        externalTransactionId,
        internalOrderId: paymentId || null,
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
 * Create a pending wholesale Payment record and trigger a Paypack USSD push.
 * Unlike the retail flow, the recipient is the vendor and the target order is
 * a WholesaleOrder (recorded via Payment.kind = WHOLESALE).
 */
exports.initiateWholesalePaypackPayment = async ({ orderId, phoneNumber, reqUserId }) => {
  const { formatRwandanPhone } = require("../utils/momo.util");
  const paypackService = require("./paypack.service");

  const phoneInfo = formatRwandanPhone(phoneNumber);
  if (!phoneInfo) {
    throw Object.assign(new Error("Invalid Rwandan phone number. Must start with 078/079 (MTN) or 073/072 (Airtel)."), { statusCode: 400 });
  }

  const order = await WholesaleOrder.findById(orderId);
  if (!order) throw Object.assign(new Error("Wholesale order not found."), { statusCode: 404 });
  if (String(order.vendor) !== String(reqUserId)) {
    throw Object.assign(new Error("You are not authorized to pay for this order."), { statusCode: 403 });
  }
  if (order.status === "ESCROW_HELD" && order.paymentStatus === "PAID") {
    throw Object.assign(new Error("Order is already paid."), { statusCode: 400 });
  }
  if (order.status !== "PENDING_PAYMENT") {
    throw Object.assign(new Error(`Order cannot be paid from status ${order.status}.`), { statusCode: 400 });
  }

  const transactionRef = `WSO-${order._id}-${Date.now()}`;
  const payment = await Payment.create({
    parentOrder: order._id,
    kind: "WHOLESALE",
    transactionReference: transactionRef,
    method: phoneInfo.provider === "MTN" ? "MOMO" : "AIRTEL",
    phoneNumber: phoneInfo.formattedNumber,
    provider: phoneInfo.provider,
    amount: order.totalAmount,
    currency: "RWF",
    status: "PENDING",
    gateway: "PAYPACK",
    gatewayResponse: { phase: "initiated" },
  });

  let gatewayReference = null;
  let pushStatus = "PENDING";
  try {
    const push = await paypackService.triggerUssdPush({
      amount: order.totalAmount,
      currency: "RWF",
      phone: phoneInfo.formattedNumber,
    });
    gatewayReference = push.reference || null;
    if (push.raw) payment.gatewayResponse = push.raw;
    if (push.status) pushStatus = push.status;
  } catch (pushError) {
    payment.gatewayResponse = { error: pushError.message };
    payment.status = "FAILED";
    await payment.save();
    throw Object.assign(new Error("Unable to reach the mobile money gateway. Payment not pushed."), {
      statusCode: 502,
      details: pushError.message,
    });
  }

  if (gatewayReference) payment.gatewayReference = gatewayReference;

  // Sandbox/demo: reconcile immediately so flows work without a live gateway.
  if (paypackService.isSandbox() && gatewayReference) {
    await exports.processWholesalePaymentWebhook({
      provider: "PAYPACK",
      externalTransactionId: gatewayReference || `${transactionRef}-dev`,
      paymentId: payment._id,
      amount: order.totalAmount,
      payload: { phase: "sandbox-autoconfirm" },
      gatewayFee: 0,
    });
  }

  await payment.save();

  return {
    message: `Payment prompt initiated for ${payment.method} (${phoneInfo.localNumber}). Please approve the USSD prompt on your phone.`,
    paymentRef: transactionRef,
    paymentId: payment._id,
    amount: order.totalAmount,
    gatewayReference,
    status: payment.status,
  };
};