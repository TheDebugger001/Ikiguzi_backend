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
        return !this.googleId && !this.isVendorStaff;
      },
    },
    gender: {
      type: String,
      enum: ["male", "female", "other"],
      required: function () {
        return !this.googleId && !this.isVendorStaff;
      },
    },
    phone: {
      type: String,
      // Google OAuth accounts carry no phone; `sparse` keeps them from
      // colliding on the unique index.
      unique: true,
      sparse: true,
      required: function () {
        return !this.googleId && !this.isVendorStaff;
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
      enum: ["buyer", "vendor", "supplier", "affiliate", "super_admin", "developer"],
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

    addresses: [addressSchema],

    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    isVendorStaff: { type: Boolean, default: false, select: false },
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
