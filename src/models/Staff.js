const mongoose = require("mongoose");

const staffSchema = new mongoose.Schema(
  {
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
    },
    vendorOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    email: { type: String, default: "", trim: true, lowercase: true },
    invitationTokenHash: { type: String, select: false },
    invitationExpiresAt: { type: Date, select: false },
    role: {
      type: String,
      enum: ["STORE_MANAGER", "ORDER_MANAGER", "CATALOG_MANAGER"],
      default: "ORDER_MANAGER",
    },
    permissions: {
      canManageProducts: { type: Boolean, default: false },
      canManageOrders: { type: Boolean, default: true },
      canViewAnalytics: { type: Boolean, default: false },
      canManageSettings: { type: Boolean, default: false },
    },
    status: {
      type: String,
      enum: ["INVITED", "ACTIVE", "SUSPENDED"],
      default: "ACTIVE",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Staff", staffSchema);