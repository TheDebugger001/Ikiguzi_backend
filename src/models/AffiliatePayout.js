const mongoose = require("mongoose");

const affiliatePayoutSchema = new mongoose.Schema(
  {
    payoutNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    affiliateUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 10000, // Enforced minimum threshold
    },
    paymentMethod: {
      type: String,
      enum: ["MTN_MOMO", "AIRTEL_MONEY", "BANK_TRANSFER"],
      required: true,
    },
    accountDetails: {
      phoneNumber: { type: String },
      accountName: { type: String },
      bankName: { type: String },
      accountNumber: { type: String },
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "PROCESSING", "COMPLETED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    transactionReference: { type: String },
    rejectionReason: { type: String },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AffiliatePayout", affiliatePayoutSchema);