"use strict";

/** vendors: seller business profile (one per vendor user). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("vendors", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      publicId: { type: Sequelize.STRING(32), allowNull: true, unique: true },
      userId: { type: Sequelize.CHAR(24), allowNull: false, unique: true, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      businessName: { type: Sequelize.STRING(150), allowNull: false },
      slug: { type: Sequelize.STRING(190), allowNull: true, unique: true },
      logoUrl: { type: Sequelize.STRING(500), allowNull: true },
      bannerUrl: { type: Sequelize.STRING(500), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      phone: { type: Sequelize.STRING(20), allowNull: false },
      email: { type: Sequelize.STRING(190), allowNull: false },
      commissionRate: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      verificationStatus: { type: Sequelize.ENUM("UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"), allowNull: false, defaultValue: "UNVERIFIED" },
      ratingAvg: { type: Sequelize.DECIMAL(3, 2), allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.ENUM("ACTIVE", "SUSPENDED", "BLOCKED", "UNDER_REVIEW"), allowNull: false, defaultValue: "ACTIVE" },
      location: { type: Sequelize.JSON, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("vendors", ["status"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("vendors");
  },
};
