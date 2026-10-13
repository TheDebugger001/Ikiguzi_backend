// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("User");
  return;
}

const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["HOME", "OFFICE", "PARENTS", "OTHER"],
      default: "HOME",
    },
    country: { type: String, required: true },
    provinceState: { type: String, required: true },
    cityDistrict: { type: String, required: true },
    sector: String,
    street: { type: String, required: true },
    building: String,
    apartment: String,
    postalCode: String,
    phone: { type: String, required: true },
    deliveryInstructions: String,
    isDefaultShipping: { type: Boolean, default: false },
    isDefaultBilling: { type: Boolean, default: false },
  },
  { _id: true },
);

const userSchema = new mongoose.Schema(
  {
    Fullname: {
      type: String,
      required: [true, "Full name is required"],
    },
    email: {
      type: String,
      required: [false, "Email is required"],
      unique: true,
      // Phone-only accounts carry no email; without `sparse` the second
      // such user would collide with the first on a null key (E11000).
      sparse: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: function () {
        // Required only if user did NOT register via Google OAuth
        return !this.googleId && !this.isVendorStaff && !this.isSupplierStaff;
      },
    },
    // Optional: the sign-up form offers "Prefer not to say".
    gender: {
      type: String,
      enum: ["male", "female", "other"],
    },
    phone: {
      type: String,
      // Google OAuth accounts carry no phone; `sparse` keeps them from
      // colliding on the unique index.
      unique: true,
      sparse: true,
      required: function () {
        return !this.googleId && !this.isVendorStaff && !this.isSupplierStaff;
      },
      validate: {
        validator: function (v) {
          // If phone is empty (e.g. Google OAuth sign-up), skip regex validation
          if (!v) return true;
          // Accepts Rwandan format (+250788888888 or 0788888888)
          return /^(\+250|0)?7[2389]\d{7}$/.test(v);
        },
        message: (props) => `${props.value} is not a valid phone number!`,
      },
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true, // Allows multiple documents without a googleId
    },
    email_verified: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      // "delivery" = MVEC courier, created by an admin (never self sign-up).
      enum: ["buyer", "vendor", "supplier", "affiliate", "super_admin", "developer", "delivery"],
      default: "buyer",
    },
    // Super admins can also operate their own vendor account without
    // surrendering administrative privileges.
    isSellerEnabled: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["ACTIVE", "SUSPEND", "BLOCK", "INVESTIGATE"],
      default: "ACTIVE",
    },
    companyName: {
      type: String,
      required: function () {
        return this.role === "vendor" && !this.isVendorStaff;
      },
    },
    businessName: { type: String, default: "" },
    description: { type: String, default: "" },
    logoUrl: { type: String, default: "" },
    category: { type: String, default: "" },
    location: { type: mongoose.Schema.Types.Mixed, default: null },
    isOnboarded: { type: Boolean, default: function () { return !["vendor", "supplier"].includes(this.role); } },
    verificationStatus: { type: String, enum: ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"], default: function () { return ["vendor", "supplier"].includes(this.role) ? "UNVERIFIED" : "VERIFIED"; } },

    avatarUrl: { type: String, default: "" },
    // Saved products, synced across the buyer's devices.
    wishlist: [
      {
        _id: false,
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
        savedPrice: { type: Number, default: 0 },
        savedAt: { type: Date, default: Date.now },
      },
    ],
    addresses: [addressSchema],

    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    // 6-digit reset code (stored hashed) sent by email or SMS.
    resetPasswordCode: { type: String, select: false },
    resetPasswordCodeExpires: { type: Date, select: false },
    resetPasswordAttempts: { type: Number, default: 0, select: false },
    isVendorStaff: { type: Boolean, default: false, select: false },
    isSupplierStaff: { type: Boolean, default: false, select: false },
    lastPasswordChangeAt: { type: Date },
  },
  { timestamps: true },
);

// Pre-save validation to enforce a single default shipping/billing address
userSchema.pre("save", function () {
  if (this.isModified("addresses")) {
    const defaultShippingCount = this.addresses.filter(
      (addr) => addr.isDefaultShipping,
    ).length;
    const defaultBillingCount = this.addresses.filter(
      (addr) => addr.isDefaultBilling,
    ).length;

    if (defaultShippingCount > 1) {
      throw new Error("Only one address can be set as default shipping.");
    }
    if (defaultBillingCount > 1) {
      throw new Error("Only one address can be set as default billing.");
    }
  }
});

const User = mongoose.model("User", userSchema);

module.exports = User;
