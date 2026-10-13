"use strict";

/** stock_movements: audit trail of manual inventory operations. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const storeRef = { type: Sequelize.CHAR(24), allowNull: true, references: { model: "stores", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" };
    await queryInterface.createTable("stock_movements", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      vendorId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      productId: { type: Sequelize.CHAR(24), allowNull: false }, // no FK: history outlives deleted products
      productName: { type: Sequelize.STRING(255), allowNull: false, defaultValue: "" },
      storeId: storeRef,
      type: { type: Sequelize.ENUM("RESTOCK", "REMOVE", "COUNT", "TRANSFER"), allowNull: false },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      before: { type: Sequelize.INTEGER, allowNull: true },
      after: { type: Sequelize.INTEGER, allowNull: true },
      fromStoreId: storeRef,
      toStoreId: storeRef,
      reason: { type: Sequelize.STRING(60), allowNull: false, defaultValue: "" },
      note: { type: Sequelize.STRING(300), allowNull: false, defaultValue: "" },
      performedById: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("stock_movements", ["vendorId", "createdAt"]);
    await queryInterface.addIndex("stock_movements", ["productId"]);
    await queryInterface.addIndex("stock_movements", ["storeId"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("stock_movements");
  },
};
