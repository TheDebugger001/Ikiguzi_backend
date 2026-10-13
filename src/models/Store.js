// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("Store");
  return;
}

const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    // A vendor may own several stores; exactly one is flagged isPrimary and is
    // used wherever a single store is implied (staff, legacy /stores/mine).
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    isPrimary: { type: Boolean, default: false },
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

storeSchema.index({ vendor: 1, isPrimary: -1, createdAt: 1 });

module.exports = mongoose.model("Store", storeSchema);