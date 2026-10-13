"use strict";

/** products: catalog. media gallery/thumbnails/videos are JSON; attributes are columns. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const money = (allowNull = true) => ({ type: Sequelize.DECIMAL(14, 2), allowNull });
    await queryInterface.createTable("products", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      publicId: { type: Sequelize.STRING(32), allowNull: true, unique: true },
      vendorId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      storeId: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "stores", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      supplierId: { type: Sequelize.CHAR(24), allowNull: true }, // FK added with the suppliers table (phase 4)
      categoryId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "categories", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      brand: { type: Sequelize.STRING(120), allowNull: true },
      name: { type: Sequelize.STRING(255), allowNull: false },
      slug: { type: Sequelize.STRING(300), allowNull: true, unique: true },
      sku: { type: Sequelize.STRING(64), allowNull: true, unique: true },
      description: { type: Sequelize.TEXT, allowNull: false },
      shortDescription: { type: Sequelize.STRING(300), allowNull: true },
      price: money(false),
      costPrice: money(),
      discountPrice: money(),
      discountType: { type: Sequelize.ENUM("PERCENT", "FIXED"), allowNull: true },
      discountValue: money(),
      stockQuantity: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      lowStockThreshold: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 5 },
      status: { type: Sequelize.ENUM("DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE", "OUT_OF_STOCK"), allowNull: false, defaultValue: "DRAFT" },
      mainImage: { type: Sequelize.STRING(1000), allowNull: false },
      gallery: { type: Sequelize.JSON, allowNull: true },
      thumbnails: { type: Sequelize.JSON, allowNull: true },
      videos: { type: Sequelize.JSON, allowNull: true },
      color: { type: Sequelize.STRING(80), allowNull: true },
      size: { type: Sequelize.STRING(80), allowNull: true },
      material: { type: Sequelize.STRING(120), allowNull: true },
      weight: { type: Sequelize.STRING(80), allowNull: true },
      capacity: { type: Sequelize.STRING(80), allowNull: true },
      model: { type: Sequelize.STRING(120), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("products", ["vendorId", "status"]);
    await queryInterface.addIndex("products", ["categoryId", "status"]);
    await queryInterface.addIndex("products", ["storeId"]);
    await queryInterface.addIndex("products", ["price"]);
    await queryInterface.addIndex("products", ["brand"]);
    // Replaces the MongoDB text index on name/description/sku/brand.
    await queryInterface.addIndex("products", ["name", "description", "sku", "brand"], { type: "FULLTEXT", name: "products_search" });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("products");
  },
};
