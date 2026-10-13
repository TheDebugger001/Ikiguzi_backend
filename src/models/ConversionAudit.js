// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("ConversionAudit");
  return;
}

const mongoose = require("mongoose");

const conversionAuditSchema = new mongoose.Schema(
  {
    affiliateUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    link: { type: mongoose.Schema.Types.ObjectId, ref: "AffiliateLink", default: null },
    targetProduct: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    referralCode: { type: String, default: "" },
    conversionValue: { type: Number, default: 0, min: 0 },
    commissionEarned: { type: Number, default: 0, min: 0 },
    // One row per attributed order item (the commission record).
    orderItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
    settlement: { type: mongoose.Schema.Types.ObjectId, ref: "Settlement", default: null },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    quantity: { type: Number, default: 1 },
    clickedAt: { type: Date, default: null },
    // Cumulative amount clawed back by refunds/cancellations. Never exceeds
    // commissionEarned; the original amount is preserved for audit.
    reversedAmount: { type: Number, default: 0, min: 0 },
    // Unrecoverable part of a reversal (affiliate had already withdrawn it).
    unrecoveredAmount: { type: Number, default: 0, min: 0 },
    reversals: [
      {
        key: { type: String, required: true },
        amount: { type: Number, required: true, min: 0 },
        reason: { type: String, default: "" },
        at: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "PAID", "REJECTED", "REVERSED"],
      default: "PENDING",
      index: true,
    },
    convertedAt: { type: Date, default: Date.now },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Repeated webhooks / jobs can never create a second commission for an item.
conversionAuditSchema.index(
  { order: 1, orderItemId: 1 },
  { unique: true, partialFilterExpression: { orderItemId: { $type: "objectId" } } }
);

conversionAuditSchema.index({ affiliateUser: 1, convertedAt: -1 });

module.exports = mongoose.model("ConversionAudit", conversionAuditSchema);