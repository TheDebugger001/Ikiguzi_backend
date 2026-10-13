"use strict";

/** staff: vendor team members with per-permission flags. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("staff", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      storeId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "stores", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      vendorOwnerId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      userId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      role: { type: Sequelize.ENUM("STORE_MANAGER", "ORDER_MANAGER", "CATALOG_MANAGER"), allowNull: false, defaultValue: "ORDER_MANAGER" },
      canViewDashboard: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      canManageProducts: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      canManageOrders: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      canManagePayouts: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      canManageStaff: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      canViewAnalytics: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      canManageSettings: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: Sequelize.ENUM("INVITED", "ACTIVE", "SUSPENDED"), allowNull: false, defaultValue: "ACTIVE" },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("staff", ["storeId"]);
    await queryInterface.addIndex("staff", ["userId", "status"]);
    await queryInterface.addIndex("staff", ["vendorOwnerId"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("staff");
  },
};
