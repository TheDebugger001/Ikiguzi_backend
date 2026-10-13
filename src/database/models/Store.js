const { DataTypes, primaryKey, foreignKey, withIds } = require("./_shared");

module.exports = (sequelize) => {
  const Store = sequelize.define("Store", {
    id: primaryKey(),
    vendorId: foreignKey(false), // owner user id (`vendor` in Mongoose)
    isPrimary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    storeName: { type: DataTypes.STRING(150), allowNull: false, unique: true },
    slug: { type: DataTypes.STRING(190), allowNull: false, unique: true, set(v) { this.setDataValue("slug", String(v || "").toLowerCase()); } },
    logo: { type: DataTypes.STRING(500), allowNull: false, defaultValue: "" },
    banner: { type: DataTypes.STRING(500), allowNull: false, defaultValue: "" },
    description: { type: DataTypes.TEXT, allowNull: true },
    businessCategory: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "General" },
    contactEmail: { type: DataTypes.STRING(190), allowNull: false },
    contactPhone: { type: DataTypes.STRING(20), allowNull: false },
    location: { type: DataTypes.JSON, allowNull: true }, // Mixed in Mongoose
    addressStreet: { type: DataTypes.STRING(255), allowNull: true },
    addressCity: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "Kigali" },
    addressCountry: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "Rwanda" },
    returnPolicy: { type: DataTypes.TEXT, allowNull: true },
    shippingPolicy: { type: DataTypes.TEXT, allowNull: true },
    businessAddress: { type: DataTypes.STRING(255), allowNull: false, defaultValue: "" },
    businessPhone: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "" },
    taxId: { type: DataTypes.STRING(60), allowNull: false, defaultValue: "" },
    operatingHours: { type: DataTypes.JSON, allowNull: true },
    shippingRules: { type: DataTypes.JSON, allowNull: true },
    defaultShippingRuleId: { type: DataTypes.STRING(64), allowNull: true },
    twoFactorEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    marketplaceLive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    socialLinks: { type: DataTypes.JSON, allowNull: true },
    status: { type: DataTypes.ENUM("PENDING", "ACTIVE", "SUSPENDED", "REJECTED", "CLOSED"), allowNull: false, defaultValue: "PENDING" },
  }, { tableName: "stores", timestamps: true });

  Store.associate = (m) => {
    Store.belongsTo(m.User, { as: "owner", foreignKey: "vendorId" });
    Store.hasMany(m.Staff, { as: "staff", foreignKey: "storeId" });
  };

  // Mongo shape: `vendor`, nested `address` and `policies`.
  Store.prototype.toApi = function () {
    const { vendorId, owner, addressStreet, addressCity, addressCountry, returnPolicy, shippingPolicy, ...rest } = withIds(this);
    return {
      ...rest,
      vendor: owner ? this.owner.toApi() : vendorId,
      address: { street: addressStreet, city: addressCity, country: addressCountry },
      policies: { returnPolicy: returnPolicy || "", shippingPolicy: shippingPolicy || "" },
      shippingRules: rest.shippingRules || [],
      operatingHours: rest.operatingHours || {},
    };
  };
  return Store;
};
