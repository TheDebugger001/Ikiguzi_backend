const mongoose = require("mongoose");

const vendorWalletSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    pendingBalance: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    availableBalance: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    totalEarned: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    totalWithdrawn: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    // Debt owed back to the platform when a RELEASED settlement is clawed back
    // after a refund. Future payouts are reduced by this balance.
    clawbackBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: "RWF",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VendorWallet", vendorWalletSchema);