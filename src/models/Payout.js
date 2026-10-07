const mongoose = require("mongoose");

// Vendor Balance Summary Ledger
const vendorBalanceSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
    },
    totalEarned: { type: Number, default: 0 },      // Total gross vendor sales lifetime
    commissionPaid: { type: Number, default: 0 },  // Total 10% platform fees deducted lifetime
    pendingBalance: { type: Number, default: 0 },  // 90% net earnings from active/undelivered orders
    availableBalance: { type: Number, default: 0 },// Funds available for immediate withdrawal
    withdrawnAmount: { type: Number, default: 0 }, // Total payouts completed
  },
  { timestamps: true }
);

// Individual Payout Request Record
const payoutSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    payoutNumber: {
      type: String,
      unique: true,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1000, "Minimum payout request amount is 1,000 RWF"],
    },
    payoutMethod: {
      type: String,
      enum: ["MOMO", "AIRTEL", "BANK"],
      default: "MOMO",
    },
    payoutDetails: {
      accountName: { type: String, required: true },
      accountNumber: { type: String, required: true }, // MoMo phone number (e.g., 250788123456) or Bank account #
      bankName: { type: String, default: "MTN MoMo" },  // "MTN MoMo", "Airtel Money", or Bank Name
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "PAID", "REJECTED", "FAILED"],
      default: "PENDING",
    },
    transferReference: String, // Gateway transfer reference ID
    rejectionReason: String,
    note: { type: String, default: "" },
    processedAt: Date,
  },
  { timestamps: true }
);

const VendorBalance = mongoose.model("VendorBalance", vendorBalanceSchema);
const Payout = mongoose.model("Payout", payoutSchema);

module.exports = { VendorBalance, Payout };