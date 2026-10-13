// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("Dispute");
  return;
}

const mongoose = require("mongoose");

const disputeSchema = new mongoose.Schema(
  {
    disputeNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    raisedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reason: {
      type: String,
      enum: [
        "ITEM_NOT_RECEIVED",
        "DAMAGED_GOODS",
        "WRONG_ITEM",
        "INCOMPLETE_ORDER",
        "SLA_BREACH",
        "OTHER",
      ],
      required: true,
    },
    description: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: [
        "OPEN",
        "UNDER_REVIEW",
        "EVIDENCE_SUBMITTED",
        "RESOLVED_BUYER_REFUNDED",
        "RESOLVED_VENDOR_RELEASED",
        "RESOLVED_SPLIT",
        "REJECTED",
      ],
      default: "OPEN",
      index: true,
    },
    disputedAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    arbitrationDecision: {
      decision: {
        type: String,
        enum: ["REFUND_BUYER", "RELEASE_TO_VENDOR", "SPLIT_SETTLEMENT"],
      },
      buyerRefundAmount: { type: Number, default: 0 },
      vendorReleaseAmount: { type: Number, default: 0 },
      arbitratedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      notes: { type: String },
      decidedAt: { type: Date },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Dispute", disputeSchema);