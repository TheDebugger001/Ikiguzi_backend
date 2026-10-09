const mongoose = require("mongoose");

const affiliateWalletSchema = new mongoose.Schema(
  {
    affiliateUser: {
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
    },
    availableBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalWithdrawn: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Lifetime commission earned (incremented atomically when a commission is
    // released) — the single source of truth for "total earned".
    totalEarned: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Commission currently locked into an open payout request. It has already
    // left availableBalance but is not yet paid out or refunded.
    lockedInPayouts: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Debt owed back to the platform when a RELEASED commission is clawed back
    // after a refund. Future payouts are reduced by this balance.
    clawbackBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AffiliateWallet", affiliateWalletSchema);