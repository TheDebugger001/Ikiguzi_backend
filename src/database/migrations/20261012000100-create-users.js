"use strict";

/** users: Mongoose `User` (embedded addresses move to user_addresses). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("users", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      Fullname: { type: Sequelize.STRING(150), allowNull: false },
      email: { type: Sequelize.STRING(190), allowNull: true, unique: true },
      password: { type: Sequelize.STRING(255), allowNull: true },
      gender: { type: Sequelize.ENUM("male", "female", "other"), allowNull: true },
      phone: { type: Sequelize.STRING(20), allowNull: true, unique: true },
      googleId: { type: Sequelize.STRING(64), allowNull: true, unique: true },
      email_verified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      role: { type: Sequelize.ENUM("buyer", "vendor", "supplier", "affiliate", "super_admin", "developer"), allowNull: false, defaultValue: "buyer" },
      isSellerEnabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: Sequelize.ENUM("ACTIVE", "SUSPEND", "BLOCK", "INVESTIGATE"), allowNull: false, defaultValue: "ACTIVE" },
      companyName: { type: Sequelize.STRING(150), allowNull: true },
      resetPasswordToken: { type: Sequelize.STRING(255), allowNull: true },
      resetPasswordExpires: { type: Sequelize.DATE, allowNull: true },
      isVendorStaff: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      lastPasswordChangeAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("users", ["role"]);
    await queryInterface.addIndex("users", ["resetPasswordToken"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("users");
  },
};
