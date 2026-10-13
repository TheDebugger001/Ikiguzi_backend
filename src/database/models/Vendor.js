const crypto = require("crypto");
const { DataTypes, primaryKey, foreignKey, withIds } = require("./_shared");

const slugify = (str) => String(str).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

module.exports = (sequelize) => {
  const Vendor = sequelize.define("Vendor", {
    id: primaryKey(),
    publicId: { type: DataTypes.STRING(32), allowNull: true, unique: true },
    userId: { ...foreignKey(false), unique: true },
    businessName: { type: DataTypes.STRING(150), allowNull: false },
    slug: { type: DataTypes.STRING(190), allowNull: true, unique: true },
    logoUrl: { type: DataTypes.STRING(500), allowNull: true },
    bannerUrl: { type: DataTypes.STRING(500), allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    category: { type: DataTypes.STRING(120), allowNull: true },
    phone: { type: DataTypes.STRING(20), allowNull: false },
    email: { type: DataTypes.STRING(190), allowNull: false, set(v) { this.setDataValue("email", String(v || "").trim().toLowerCase()); } },
    commissionRate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
    verificationStatus: { type: DataTypes.ENUM("UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"), allowNull: false, defaultValue: "UNVERIFIED" },
    ratingAvg: { type: DataTypes.DECIMAL(3, 2), allowNull: false, defaultValue: 0, validate: { min: 0, max: 5 } },
    status: { type: DataTypes.ENUM("ACTIVE", "SUSPENDED", "BLOCKED", "UNDER_REVIEW"), allowNull: false, defaultValue: "ACTIVE" },
    location: { type: DataTypes.JSON, allowNull: true }, // Mixed in Mongoose
  }, {
    tableName: "vendors",
    timestamps: true,
    hooks: {
      // Same as the Mongoose pre-save: publicId once, slug from businessName.
      async beforeSave(vendor) {
        if (!vendor.publicId) vendor.publicId = `MVEC-VND-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        if (vendor.changed("businessName") || !vendor.slug) {
          const base = slugify(vendor.businessName);
          let candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
          for (let i = 0; i < 5 && (await Vendor.count({ where: { slug: candidate } })); i++) {
            candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
          }
          vendor.slug = candidate;
        }
      },
    },
  });

  Vendor.associate = (m) => Vendor.belongsTo(m.User, { as: "user", foreignKey: "userId" });
  Vendor.prototype.toApi = function () {
    const { userId, user, ...rest } = withIds(this);
    return { ...rest, user: user ? this.user.toApi() : userId, commissionRate: Number(rest.commissionRate), ratingAvg: Number(rest.ratingAvg) };
  };
  return Vendor;
};
