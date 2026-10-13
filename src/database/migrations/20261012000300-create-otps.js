"use strict";

/** otps: phone verification codes (hashed). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("otps", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      phone: { type: Sequelize.STRING(20), allowNull: false },
      codeHash: { type: Sequelize.STRING(128), allowNull: false },
      purpose: { type: Sequelize.ENUM("registration", "login"), allowNull: false },
      email: { type: Sequelize.STRING(190), allowNull: true },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      lastSentAt: { type: Sequelize.DATE, allowNull: true },
      consumed: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("otps", ["phone", "purpose"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("otps");
  },
};
