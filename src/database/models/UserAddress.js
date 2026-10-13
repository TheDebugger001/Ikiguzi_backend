const { DataTypes, primaryKey, foreignKey, withIds } = require("./_shared");

// Embedded `addresses` array of the Mongoose User, as its own table.
module.exports = (sequelize) => {
  const UserAddress = sequelize.define("UserAddress", {
    id: primaryKey(),
    userId: foreignKey(false),
    type: { type: DataTypes.ENUM("HOME", "OFFICE", "PARENTS", "OTHER"), allowNull: false, defaultValue: "HOME" },
    country: { type: DataTypes.STRING(80), allowNull: false },
    provinceState: { type: DataTypes.STRING(80), allowNull: false },
    cityDistrict: { type: DataTypes.STRING(80), allowNull: false },
    sector: { type: DataTypes.STRING(80), allowNull: true },
    street: { type: DataTypes.STRING(255), allowNull: false },
    building: { type: DataTypes.STRING(120), allowNull: true },
    apartment: { type: DataTypes.STRING(60), allowNull: true },
    postalCode: { type: DataTypes.STRING(20), allowNull: true },
    phone: { type: DataTypes.STRING(20), allowNull: false },
    deliveryInstructions: { type: DataTypes.STRING(500), allowNull: true },
    isDefaultShipping: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isDefaultBilling: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, { tableName: "user_addresses", timestamps: true });

  UserAddress.associate = (m) => UserAddress.belongsTo(m.User, { foreignKey: "userId" });
  UserAddress.prototype.toApi = function () {
    const { userId, createdAt, updatedAt, ...rest } = withIds(this);
    return rest;
  };
  return UserAddress;
};
