const crypto = require("crypto");
const Payment = require("../models/Payment");
const paymentService = require("../services/payment.service");
const paypackService = require("../services/paypack.service");

/**
 * HMAC Validation Helper
 */
function verifyWebhookSignature(payload, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");
  const a = Buffer.from(hmac);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// @desc    MTN MoMo Payment Webhook Receiver
// @route   POST /api/webhooks/momo
// @access  Public (Provider Verified)
exports.handleMomoWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-momo-signature"];
    const isSandbox =
      process.env.NODE_ENV !== "production" || !process.env.MOMO_WEBHOOK_SECRET;

    if (
      !isSandbox &&
      !verifyWebhookSignature(
        req.body,
        signature,
        process.env.MOMO_WEBHOOK_SECRET,
      )
    ) {
      return res.status(401).json({ message: "Invalid webhook signature" });
    }

    // MoMo callback payload: { status, externalId, financialTransactionId, amount, fee }
    const { financialTransactionId, externalId, amount, fee } = req.body;
    const gatewayFee = Number(fee) || 0;

    // MoMo uses "SUCCESSFUL" for completed transactions
    if (req.body.status !== "SUCCESSFUL") {
      if (financialTransactionId || externalId) {
        await paymentService.recordIgnoredWebhook({
          provider: "MTN_MOMO",
          externalTransactionId: financialTransactionId || externalId,
          amount: Number(amount || 0),
          payload: req.body,
        });
      }
      return res.status(200).json({
        success: true,
        message: "Transaction status not successful. Ignored.",
      });
    }

    const externalTransactionId = financialTransactionId || externalId;

    // Resolve the internal order through the persisted Payment record.
    let orderId = null;
    if (externalTransactionId) {
      const payment = await Payment.findOne({
        $or: [
          { transactionReference: externalId },
          { gatewayReference: financialTransactionId || externalId },
          { gatewayReference: externalId },
        ],
      });
      if (payment) orderId = payment.parentOrder;
    }
    // Fallback: provider includes our internal order id as external reference.
    if (!orderId && externalId) {
      orderId = /^[0-9a-f]{24}$/i.test(externalId) ? externalId : null;
    }

    if (!orderId) {
      return res
        .status(404)
        .json({ message: "Unable to resolve order for webhook callback." });
    }

    const result = await paymentService.processPaymentWebhook({
      provider: "MTN_MOMO",
      externalTransactionId,
      orderId,
      amount: Number(amount),
      payload: req.body,
      gatewayFee,
    });

    return res
      .status(200)
      .json({
        success: true,
        message: "MoMo webhook processed successfully.",
        result,
      });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Airtel Money Payment Webhook Receiver
// @route   POST /api/webhooks/airtel
// @access  Public (Provider Verified)
exports.handleAirtelWebhook = async (req, res) => {
  try {
    // 1. Safe Signature Header Retrieval
    const signature =
      req.headers["x-airtel-signature"] ||
      req.headers["x-signature"] ||
      req.headers["authorization"];

    const isSandbox =
      process.env.NODE_ENV !== "production" ||
      !process.env.AIRTEL_WEBHOOK_SECRET;

    // 2. Signature Check (Pass req.rawBody or raw buffer if HMAC verification is used)
    if (!isSandbox) {
      const isValid = verifyWebhookSignature(
        req.rawBody || req.body,
        signature,
        process.env.AIRTEL_WEBHOOK_SECRET,
      );
      if (!isValid) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }
    }

    const { transaction, status } = req.body;

    // 3. Robust Extraction across V1 / V2 Webhook Schemas
    const externalTransactionId =
      transaction?.id || transaction?.airtel_money_id;
    const reference = transaction?.reference || req.body?.reference;
    const amount = Number(transaction?.amount);
    const gatewayFee = Number(transaction?.fee) || 0;

    // Standardize status extraction
    const statusCode = String(
      transaction?.status_code || transaction?.code || status?.code || "",
    ).toUpperCase();

    const isSuccess = ["TS", "200", "2000", "SUCCESS", "DP0001"].includes(
      statusCode,
    );

    // If transaction failed or pending, acknowledge webhook but do not fullfill order
    if (!isSuccess) {
      console.log(
        `[Airtel Webhook] Payment not successful for ref: ${reference}. Code: ${statusCode}`,
      );
      return res
        .status(200)
        .json({
          success: true,
          message:
            "Airtel transaction non-successful status received and recorded.",
        });
    }

    // 4. Resolve Internal Order / Payment Record
    let orderId = null;

    if (reference) {
      const payment = await Payment.findOne({
        $or: [
          { transactionReference: reference },
          { gatewayReference: reference },
          { _id: reference.match(/^[0-9a-f]{24}$/i) ? reference : null },
        ].filter(Boolean),
      });

      if (payment) {
        orderId = payment.parentOrder || payment._id;
      }
    }

    // Fallback: direct MongoDB ObjectId match if reference is the order ID directly
    if (!orderId && reference && /^[0-9a-f]{24}$/i.test(reference)) {
      orderId = reference;
    }

    if (!orderId) {
      console.error(
        `[Airtel Webhook] Unresolved order reference: ${reference}`,
      );
      return res
        .status(404)
        .json({ message: "Unable to resolve order for webhook callback." });
    }

    // 5. Process Successful Payment Execution
    const result = await paymentService.processPaymentWebhook({
      provider: "AIRTEL_MONEY",
      externalTransactionId,
      orderId,
      amount,
      payload: req.body,
      gatewayFee,
    });

    // Always respond with 200 OK so Airtel stops retrying the webhook
    return res
      .status(200)
      .json({
        success: true,
        message: "Airtel webhook processed successfully.",
        result,
      });
  } catch (error) {
    console.error("[Airtel Webhook Error]:", error);
    // Respond with 500 so gateway knows to retry later
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Paypack Payment Webhook Receiver
// @route   POST /api/webhooks/paypack
// @access  Public (Provider Verified via X-Paypack-Signature)
exports.handlePaypackWebhook = async (req, res) => {
  try {
    // Verify the signature whenever a webhook secret is configured.
    if (process.env.PAYPACK_WEBHOOK_SECRET) {
      const isValid = paypackService.verifyWebhookSignature(
        req.rawBody,
        req.headers["x-paypack-signature"],
      );
      if (!isValid) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }
    }

    // Payload: { event_id, event_kind, created_at, data: { ref, kind, amount, fee, status, ... } }
    const { event_kind: eventKind, data = {} } = req.body;

    // Only a processed CASHIN carries a final status; ignore everything else.
    if (eventKind !== "transaction:processed" || data.kind !== "CASHIN") {
      return res.status(200).json({ success: true, message: "Event ignored." });
    }

    const payment = await Payment.findOne({ gatewayReference: data.ref });
    if (!payment) {
      return res
        .status(404)
        .json({ message: "Unable to resolve payment for webhook callback." });
    }

    const status = paypackService.normalizeStatus(data.status);

    if (status !== "SUCCESSFUL") {
      if (status === "FAILED" && payment.status === "PENDING") {
        payment.status = "FAILED";
        payment.gatewayResponse = req.body;
        await payment.save();
      }
      return res.status(200).json({
        success: true,
        message: "Transaction status not successful. Recorded.",
      });
    }

    // Wholesale (B2B) payments flow through the same gateway but settle into
    // the wholesale escrow flow (no per-item retail settlements).
    if (payment.kind === "WHOLESALE") {
      const result = await paymentService.processWholesalePaymentWebhook({
        provider: "PAYPACK",
        externalTransactionId: data.ref,
        paymentId: payment._id,
        amount: Number(data.amount),
        payload: req.body,
        gatewayFee: Number(data.fee) || 0,
      });

      return res.status(200).json({
        success: true,
        message: "Paypack wholesale webhook processed successfully.",
        result,
      });
    }

    const result = await paymentService.processPaymentWebhook({
      provider: "PAYPACK",
      externalTransactionId: data.ref,
      orderId: payment.parentOrder,
      paymentId: payment._id,
      amount: Number(data.amount),
      payload: req.body,
      gatewayFee: Number(data.fee) || 0,
    });

    return res.status(200).json({
      success: true,
      message: "Paypack webhook processed successfully.",
      result,
    });
  } catch (error) {
    console.error("[Paypack Webhook Error]:", error);
    // Respond with 500 so Paypack retries later
    return res.status(500).json({ message: error.message });
  }
};
