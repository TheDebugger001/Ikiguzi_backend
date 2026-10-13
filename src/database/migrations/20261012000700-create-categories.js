"use strict";

/** categories: marketplace categories; parentId makes subcategories. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("categories", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      name: { type: Sequelize.STRING(120), allowNull: false },
      slug: { type: Sequelize.STRING(190), allowNull: false, unique: true },
      parentId: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "categories", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      description: { type: Sequelize.TEXT, allowNull: true },
      imageUrl: { type: Sequelize.STRING(500), allowNull: true },
      sortOrder: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("categories", ["parentId"]);
    await queryInterface.addIndex("categories", ["active", "sortOrder", "name"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("categories");
  },
};
