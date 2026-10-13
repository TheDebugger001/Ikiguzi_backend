const { DataTypes, primaryKey, withIds } = require("./_shared");

module.exports = (sequelize) => {
  const Otp = sequelize.define("Otp", {
    id: primaryKey(),
    phone: { type: DataTypes.STRING(20), allowNull: false },
    codeHash: { type: DataTypes.STRING(128), allowNull: false },
    purpose: { type: DataTypes.ENUM("registration", "login"), allowNull: false },
    email: { type: DataTypes.STRING(190), allowNull: true, set(v) { this.setDataValue("email", v ? String(v).trim().toLowerCase() : null); } },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastSentAt: { type: DataTypes.DATE, allowNull: true },
    consumed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, { tableName: "otps", timestamps: true });
  Otp.prototype.toApi = function () { return withIds(this); };
  return Otp;
};
