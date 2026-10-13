"use strict";

/** user_addresses: the embedded `addresses` array of the Mongoose User. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("user_addresses", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      userId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      type: { type: Sequelize.ENUM("HOME", "OFFICE", "PARENTS", "OTHER"), allowNull: false, defaultValue: "HOME" },
      country: { type: Sequelize.STRING(80), allowNull: false },
      provinceState: { type: Sequelize.STRING(80), allowNull: false },
      cityDistrict: { type: Sequelize.STRING(80), allowNull: false },
      street: { type: Sequelize.STRING(255), allowNull: false },
      building: { type: Sequelize.STRING(120), allowNull: true },
      apartment: { type: Sequelize.STRING(60), allowNull: true },
      postalCode: { type: Sequelize.STRING(20), allowNull: true },
      phone: { type: Sequelize.STRING(20), allowNull: false },
      deliveryInstructions: { type: Sequelize.STRING(500), allowNull: true },
      isDefaultShipping: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      isDefaultBilling: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("user_addresses", ["userId"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("user_addresses");
  },
};
