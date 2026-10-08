const mongoose = require("mongoose");

// Per-affiliate profile, verification record and user preferences. The User
// document keeps the auth identity (name, email, phone, role); everything the
// affiliate dashboard edits lives here so it never leaks into shared auth data.
const affiliateAccountSchema = new mongoose.Schema(
  {
    affiliateUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // Account-level referral code (links carry their own code too).
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    // Public publisher identity.
    displayName: { type: String, default: "" },
    bio: { type: String, default: "" },
    website: { type: String, default: "" },
    country: { type: String, default: "Rwanda" },

    commissionRate: { type: Number, default: 0, min: 0 },

    paymentMethod: {
      type: String,
      enum: ["MTN_MOMO", "AIRTEL_MONEY", "BANK_TRANSFER"],
      default: "MTN_MOMO",
    },
    accountDetails: {
      phoneNumber: { type: String, default: "" },
      accountName: { type: String, default: "" },
      bankName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
    },

    verification: {
      status: {
        type: String,
        enum: ["UNVERIFIED", "PENDING", "UNDER_REVIEW", "VERIFIED", "REJECTED"],
        default: "UNVERIFIED",
      },
      submittedAt: { type: Date, default: null },
      reviewedAt: { type: Date, default: null },
      notes: { type: String, default: "" },
      documents: { type: [String], default: [] },
    },

    preferences: {
      defaultPayoutMethod: { type: String, default: "MTN_MOMO" },
      emailNotifications: { type: Boolean, default: true },
      pushNotifications: { type: Boolean, default: true },
      payoutAlerts: { type: Boolean, default: true },
      marketingEmails: { type: Boolean, default: false },
      language: { type: String, default: "English" },
      themeMode: { type: String, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AffiliateAccount", affiliateAccountSchema);
