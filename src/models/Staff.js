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
      canViewDashboard: { type: Boolean, default: true },
      canManageProducts: { type: Boolean, default: false },
      canManageOrders: { type: Boolean, default: true },
      canManagePayouts: { type: Boolean, default: false },
      canManageStaff: { type: Boolean, default: false },
      canViewAnalytics: { type: Boolean, default: false },
      canManageSettings: { type: Boolean, default: false },
    },
    vendor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    permission_role: {
      type: String,
    },
    status: {
      type: String,
      enum: ["INVITED", "ACTIVE", "SUSPENDED"],
      default: "ACTIVE",
    },
  },
  { timestamps: true }
);

staffSchema.pre("save", function () {
  if (this.store && !this.vendor_id) this.vendor_id = this.store;
  if (this.vendor_id && !this.store) this.store = this.vendor_id;
  if (this.user && !this.user_id) this.user_id = this.user;
  if (this.user_id && !this.user) this.user = this.user_id;
  if (this.role && !this.permission_role) this.permission_role = this.role;
  if (this.permission_role && !this.role) this.role = this.permission_role;
});

const Staff = mongoose.models.Staff || mongoose.model("Staff", staffSchema);
if (!mongoose.models.vendor_team_members) {
  mongoose.model("vendor_team_members", staffSchema);
}

module.exports = Staff;