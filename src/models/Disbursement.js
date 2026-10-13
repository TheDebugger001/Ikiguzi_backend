// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("Disbursement");
  return;
}

const mongoose = require("mongoose");

// Money MVEC sends out to a mobile money number: buyer refunds and affiliate
// withdrawals. One document per transfer, tracked until the provider
// confirms it, retried a few times on failure.
const disbursementSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["REFUND", "AFFILIATE_PAYOUT"], required: true, index: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    phone: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    affiliatePayout: { type: mongoose.Schema.Types.ObjectId, ref: "AffiliatePayout", default: null },
    // Prevents queueing the same refund twice (e.g. "refund:<orderId>").
    idempotencyKey: { type: String, required: true, unique: true },
    status: { type: String, enum: ["QUEUED", "SENT", "SUCCESS", "FAILED"], default: "QUEUED", index: true },
    gatewayReference: { type: String, index: true, sparse: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    nextAttemptAt: { type: Date, default: Date.now },
    completedAt: Date,
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

module.exports = mongoose.model("Disbursement", disbursementSchema);
