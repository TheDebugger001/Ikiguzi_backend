"use strict";

/** stores: storefronts; a vendor user may own several, one isPrimary. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("stores", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      vendorId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      isPrimary: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      storeName: { type: Sequelize.STRING(150), allowNull: false, unique: true },
      slug: { type: Sequelize.STRING(190), allowNull: false, unique: true },
      logo: { type: Sequelize.STRING(500), allowNull: false, defaultValue: "" },
      banner: { type: Sequelize.STRING(500), allowNull: false, defaultValue: "" },
      description: { type: Sequelize.TEXT, allowNull: true },
      businessCategory: { type: Sequelize.STRING(120), allowNull: false, defaultValue: "General" },
      contactEmail: { type: Sequelize.STRING(190), allowNull: false },
      contactPhone: { type: Sequelize.STRING(20), allowNull: false },
      location: { type: Sequelize.JSON, allowNull: true },
      addressStreet: { type: Sequelize.STRING(255), allowNull: true },
      addressCity: { type: Sequelize.STRING(120), allowNull: false, defaultValue: "Kigali" },
      addressCountry: { type: Sequelize.STRING(80), allowNull: false, defaultValue: "Rwanda" },
      returnPolicy: { type: Sequelize.TEXT, allowNull: true },
      shippingPolicy: { type: Sequelize.TEXT, allowNull: true },
      businessAddress: { type: Sequelize.STRING(255), allowNull: false, defaultValue: "" },
      businessPhone: { type: Sequelize.STRING(20), allowNull: false, defaultValue: "" },
      taxId: { type: Sequelize.STRING(60), allowNull: false, defaultValue: "" },
      operatingHours: { type: Sequelize.JSON, allowNull: true },
      shippingRules: { type: Sequelize.JSON, allowNull: true },
      defaultShippingRuleId: { type: Sequelize.STRING(64), allowNull: true },
      twoFactorEnabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      marketplaceLive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      socialLinks: { type: Sequelize.JSON, allowNull: true },
      status: { type: Sequelize.ENUM("PENDING", "ACTIVE", "SUSPENDED", "REJECTED", "CLOSED"), allowNull: false, defaultValue: "PENDING" },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("stores", ["vendorId", "isPrimary", "createdAt"]);
    await queryInterface.addIndex("stores", ["status"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("stores");
  },
};
