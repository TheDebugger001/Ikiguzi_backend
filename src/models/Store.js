const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // One store per vendor user account
    },
    storeName: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    logo: { type: String, default: "" },
    banner: { type: String, default: "" },
    description: { type: String, default: "" },
    businessCategory: { type: String, default: "General" },
    contactEmail: { type: String, required: true },
    contactPhone: { type: String, required: true },
    location: { type: mongoose.Schema.Types.Mixed, default: "" },
    address: {
      street: String,
      city: { type: String, default: "Kigali" },
      country: { type: String, default: "Rwanda" },
    },
    policies: {
      returnPolicy: { type: String, default: "" },
      shippingPolicy: { type: String, default: "" },
    },
    businessAddress: { type: String, default: "" },
    businessPhone: { type: String, default: "" },
    taxId: { type: String, default: "" },
    operatingHours: { type: mongoose.Schema.Types.Mixed, default: {} },
    shippingRules: {
      type: [{
        id: String,
        name: { type: String, required: true },
        type: { type: String, enum: ["flat", "free", "percentage"], default: "flat" },
        amount: { type: Number, min: 0, default: 0 },
        minimumOrder: { type: Number, min: 0, default: 0 },
        etaDays: { type: Number, min: 0, default: 2 },
      }],
      default: [],
    },
    defaultShippingRuleId: { type: String, default: null },
    twoFactorEnabled: { type: Boolean, default: false },
    marketplaceLive: { type: Boolean, default: true },
    socialLinks: {
      website: String,
      instagram: String,
      twitter: String,
    },
    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "SUSPENDED", "REJECTED", "CLOSED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Store", storeSchema);