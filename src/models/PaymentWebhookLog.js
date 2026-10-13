// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("PaymentWebhookLog");
  return;
}

const mongoose = require("mongoose");

const paymentWebhookLogSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["MTN_MOMO", "AIRTEL_MONEY", "PAYPACK"],
      required: true,
    },
    // The provider's unique transaction/reference ID (Used for Idempotency)
    externalTransactionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    internalOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSED", "FAILED", "IGNORED"],
      default: "PENDING",
      required: true,
    },
    amount: { type: Number, required: true },
    currency: { type: String, default: "RWF", required: true },
    rawPayload: { type: mongoose.Schema.Types.Mixed, required: true },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaymentWebhookLog", paymentWebhookLogSchema);