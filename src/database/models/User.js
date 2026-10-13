const { DataTypes, primaryKey, withIds } = require("./_shared");

module.exports = (sequelize) => {
  const User = sequelize.define("User", {
    id: primaryKey(),
    Fullname: { type: DataTypes.STRING(150), allowNull: false },
    email: { type: DataTypes.STRING(190), allowNull: true, unique: true, set(v) { this.setDataValue("email", v ? String(v).trim().toLowerCase() : null); } },
    password: { type: DataTypes.STRING(255), allowNull: true },
    gender: { type: DataTypes.ENUM("male", "female", "other"), allowNull: true },
    phone: { type: DataTypes.STRING(20), allowNull: true, unique: true, validate: { isRwandanPhone(v) { if (v && !/^(\+250|0)?7[2389]\d{7}$/.test(v)) throw new Error(`${v} is not a valid phone number!`); } } },
    googleId: { type: DataTypes.STRING(64), allowNull: true, unique: true },
    email_verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    role: { type: DataTypes.ENUM("buyer", "vendor", "supplier", "affiliate", "super_admin", "developer", "delivery"), allowNull: false, defaultValue: "buyer" },
    isSellerEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: { type: DataTypes.ENUM("ACTIVE", "SUSPEND", "BLOCK", "INVESTIGATE"), allowNull: false, defaultValue: "ACTIVE" },
    companyName: { type: DataTypes.STRING(150), allowNull: true },
    businessName: { type: DataTypes.STRING(150), allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    logoUrl: { type: DataTypes.STRING(500), allowNull: true },
    category: { type: DataTypes.STRING(120), allowNull: true },
    location: { type: DataTypes.JSON, allowNull: true }, // Mixed in Mongoose
    avatarUrl: { type: DataTypes.STRING(500), allowNull: true },
    // Vendors and suppliers must finish onboarding; everyone else starts onboarded/verified
    // (Mongoose computes these defaults from the role; see beforeValidate below).
    isOnboarded: { type: DataTypes.BOOLEAN, allowNull: false }, // default set in beforeValidate (role-based)
    verificationStatus: { type: DataTypes.ENUM("UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"), allowNull: false },
    wishlist: { type: DataTypes.JSON, allowNull: true }, // [{ product, savedPrice, savedAt }]
    resetPasswordCode: { type: DataTypes.STRING(255), allowNull: true },
    resetPasswordCodeExpires: { type: DataTypes.DATE, allowNull: true },
    resetPasswordAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isSupplierStaff: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    resetPasswordToken: { type: DataTypes.STRING(255), allowNull: true },
    resetPasswordExpires: { type: DataTypes.DATE, allowNull: true },
    isVendorStaff: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lastPasswordChangeAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: "users",
    timestamps: true,
    hooks: {
      // Role-dependent defaults, as in the Mongoose schema.
      beforeValidate(user) {
        if (!user.isNewRecord) return;
        const needsOnboarding = ["vendor", "supplier"].includes(user.role);
        if (user.isOnboarded === undefined || user.isOnboarded === null) user.isOnboarded = !needsOnboarding;
        if (!user.verificationStatus) user.verificationStatus = needsOnboarding ? "UNVERIFIED" : "VERIFIED";
      },
    },
    // Same rules as the Mongoose schema.
    validate: {
      requiredUnlessGoogleOrStaff() {
        if (this.googleId || this.isVendorStaff) return;
        if (!this.password) throw new Error("Password is required");
        if (!this.phone) throw new Error("Phone is required");
      },
      companyForVendors() {
        if (this.role === "vendor" && !this.isVendorStaff && !this.companyName) throw new Error("Company name is required");
      },
    },
    defaultScope: { attributes: { exclude: ["isVendorStaff", "isSupplierStaff", "resetPasswordCode", "resetPasswordCodeExpires", "resetPasswordAttempts"] } }, // select:false in Mongoose
  });

  User.associate = (m) => {
    User.hasMany(m.UserAddress, { as: "addresses", foreignKey: "userId", onDelete: "CASCADE" });
    User.hasOne(m.Vendor, { as: "vendorProfile", foreignKey: "userId" });
    User.hasMany(m.Store, { as: "stores", foreignKey: "vendorId" });
  };

  User.prototype.toApi = function () {
    const out = withIds(this);
    if (Array.isArray(out.addresses)) out.addresses = this.addresses.map((a) => a.toApi());
    return out;
  };

  return User;
};
