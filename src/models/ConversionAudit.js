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
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "PAID", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    convertedAt: { type: Date, default: Date.now },
    approvedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

conversionAuditSchema.index({ affiliateUser: 1, convertedAt: -1 });

module.exports = mongoose.model("ConversionAudit", conversionAuditSchema);