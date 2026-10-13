"use strict";

/**
 * Affiliate / checkout / vendor-module columns and tables that the application
 * writes but the first phase migrations did not create. Additive and idempotent:
 * nothing is dropped, truncated or rewritten; ENUMs are only extended and one
 * NOT NULL column is relaxed. Safe to run on a database that already has data.
 *
 *   new tables  affiliate_attributions, disbursements, supplier_reviews,
 *               supplier_supply_requests(+_lines,+_events), supplier_team_members
 *   new columns users, user_addresses, vendors, staff, products, orders, order_items,
 *               settlements, notifications, suppliers, affiliate_clicks,
 *               affiliate_links, conversion_audits
 *   enums       users.role += delivery, orders.paymentStatus += DISPUTED,
 *               conversion_audits.status += REVERSED
 */
const addColumnOnce = async (qi, table, column, definition) => {
  const existing = await qi.describeTable(table);
  if (!existing[column]) await qi.addColumn(table, column, definition);
};

const addIndexOnce = async (qi, table, fields, options = {}) => {
  const indexes = await qi.showIndex(table);
  const wanted = fields.join(",");
  const exists = indexes.some((i) => i.fields.map((f) => f.attribute).join(",") === wanted && (!options.unique || i.unique));
  if (!exists) await qi.addIndex(table, fields, options);
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = new Set(await queryInterface.showAllTables());

    // ---- new tables (parents before children) --------------------------------
    if (!tables.has("affiliate_attributions")) {
      await queryInterface.createTable("affiliate_attributions", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      visitorId: { type: Sequelize.STRING(32), allowNull: false },
      productId: { type: Sequelize.CHAR(24), allowNull: false },
      linkId: { type: Sequelize.CHAR(24), allowNull: false },
      affiliateUserId: { type: Sequelize.CHAR(24), allowNull: false },
      affiliateCode: { type: Sequelize.STRING(60), allowNull: false },
      clickedAt: { type: Sequelize.DATE(3), allowNull: false },
      createdAt: { type: Sequelize.DATE(3), allowNull: false },
      updatedAt: { type: Sequelize.DATE(3), allowNull: false },
      });
    }
    await addIndexOnce(queryInterface, "affiliate_attributions", ["affiliateUserId"]);
    await addIndexOnce(queryInterface, "affiliate_attributions", ["visitorId","productId"], { unique: true });
    if (!tables.has("disbursements")) {
      await queryInterface.createTable("disbursements", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      kind: { type: Sequelize.ENUM("REFUND", "AFFILIATE_PAYOUT"), allowNull: false },
      recipientId: { type: Sequelize.CHAR(24), allowNull: false },
      phone: { type: Sequelize.STRING(30), allowNull: false },
      amount: { type: Sequelize.DECIMAL(14,2), allowNull: false },
      orderId: { type: Sequelize.CHAR(24), allowNull: true },
      affiliatePayoutId: { type: Sequelize.CHAR(24), allowNull: true },
      idempotencyKey: { type: Sequelize.STRING(190), allowNull: false, unique: true },
      status: { type: Sequelize.ENUM("QUEUED", "SENT", "SUCCESS", "FAILED"), allowNull: false, defaultValue: "QUEUED" },
      gatewayReference: { type: Sequelize.STRING(120), allowNull: true },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      lastError: { type: Sequelize.TEXT, allowNull: true },
      nextAttemptAt: { type: Sequelize.DATE(3), allowNull: true },
      completedAt: { type: Sequelize.DATE(3), allowNull: true },
      createdAt: { type: Sequelize.DATE(3), allowNull: false },
      updatedAt: { type: Sequelize.DATE(3), allowNull: false },
      });
    }
    await addIndexOnce(queryInterface, "disbursements", ["kind"]);
    await addIndexOnce(queryInterface, "disbursements", ["orderId"]);
    await addIndexOnce(queryInterface, "disbursements", ["status"]);
    await addIndexOnce(queryInterface, "disbursements", ["gatewayReference"]);
    if (!tables.has("supplier_reviews")) {
      await queryInterface.createTable("supplier_reviews", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      supplierId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "suppliers", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      vendorId: { type: Sequelize.CHAR(24), allowNull: false },
      wholesaleOrderId: { type: Sequelize.CHAR(24), allowNull: false },
      rating: { type: Sequelize.INTEGER, allowNull: false },
      comment: { type: Sequelize.TEXT, allowNull: true },
      reply: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE(3), allowNull: false },
      updatedAt: { type: Sequelize.DATE(3), allowNull: false },
      });
    }
    await addIndexOnce(queryInterface, "supplier_reviews", ["supplierId","vendorId","wholesaleOrderId"], { unique: true });
    await addIndexOnce(queryInterface, "supplier_reviews", ["supplierId","createdAt"]);
    if (!tables.has("supplier_supply_requests")) {
      await queryInterface.createTable("supplier_supply_requests", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      supplierId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "suppliers", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      reference: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      neededBy: { type: Sequelize.DATE(3), allowNull: false },
      note: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.ENUM("SUBMITTED", "UNDER_REVIEW", "APPROVED", "SOURCING", "IN_TRANSIT", "RECEIVED", "REJECTED", "CANCELLED"), allowNull: false, defaultValue: "SUBMITTED" },
      decision: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE(3), allowNull: false },
      updatedAt: { type: Sequelize.DATE(3), allowNull: false },
      });
    }
    await addIndexOnce(queryInterface, "supplier_supply_requests", ["status"]);
    await addIndexOnce(queryInterface, "supplier_supply_requests", ["supplierId","createdAt"]);
    if (!tables.has("supplier_supply_request_lines")) {
      await queryInterface.createTable("supplier_supply_request_lines", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      product: { type: Sequelize.STRING(255), allowNull: false },
      category: { type: Sequelize.STRING(120), allowNull: true, defaultValue: "General" },
      units: { type: Sequelize.INTEGER, allowNull: false },
      unit: { type: Sequelize.STRING(60), allowNull: false },
      unitPrice: { type: Sequelize.DECIMAL(14,2), allowNull: false },
      note: { type: Sequelize.TEXT, allowNull: true },
      supplyRequestId: { type: Sequelize.CHAR(24), allowNull: false },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      });
    }
    if (!tables.has("supplier_supply_request_events")) {
      await queryInterface.createTable("supplier_supply_request_events", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      at: { type: Sequelize.DATE(3), allowNull: true },
      title: { type: Sequelize.STRING(255), allowNull: false },
      detail: { type: Sequelize.TEXT, allowNull: true },
      supplyRequestId: { type: Sequelize.CHAR(24), allowNull: false },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      });
    }
    if (!tables.has("supplier_team_members")) {
      await queryInterface.createTable("supplier_team_members", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      supplierId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "suppliers", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      userId: { type: Sequelize.CHAR(24), allowNull: true },
      fullName: { type: Sequelize.STRING(150), allowNull: false },
      phone: { type: Sequelize.STRING(30), allowNull: false },
      email: { type: Sequelize.STRING(190), allowNull: true, defaultValue: "" },
      role: { type: Sequelize.ENUM("OPERATIONS", "WAREHOUSE", "FULFILMENT", "FINANCE", "VIEWER"), allowNull: false, defaultValue: "VIEWER" },
      status: { type: Sequelize.ENUM("ACTIVE", "INVITED", "SUSPENDED"), allowNull: false, defaultValue: "ACTIVE" },
      note: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE(3), allowNull: false },
      updatedAt: { type: Sequelize.DATE(3), allowNull: false },
      });
    }
    await addIndexOnce(queryInterface, "supplier_team_members", ["userId"]);
    await addIndexOnce(queryInterface, "supplier_team_members", ["supplierId","createdAt"]);

    // ---- new columns on existing tables -------------------------------------
    await addColumnOnce(queryInterface, "users", "businessName", { type: Sequelize.STRING(150), allowNull: true });
    await addColumnOnce(queryInterface, "users", "description", { type: Sequelize.TEXT, allowNull: true });
    await addColumnOnce(queryInterface, "users", "logoUrl", { type: Sequelize.STRING(500), allowNull: true });
    await addColumnOnce(queryInterface, "users", "category", { type: Sequelize.STRING(120), allowNull: true });
    await addColumnOnce(queryInterface, "users", "location", { type: Sequelize.JSON, allowNull: true });
    await addColumnOnce(queryInterface, "users", "avatarUrl", { type: Sequelize.STRING(500), allowNull: true });
    await addColumnOnce(queryInterface, "users", "isOnboarded", { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
    await addColumnOnce(queryInterface, "users", "verificationStatus", { type: Sequelize.ENUM("UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"), allowNull: false, defaultValue: "VERIFIED" });
    await addColumnOnce(queryInterface, "users", "wishlist", { type: Sequelize.JSON, allowNull: true });
    await addColumnOnce(queryInterface, "users", "resetPasswordCode", { type: Sequelize.STRING(255), allowNull: true });
    await addColumnOnce(queryInterface, "users", "resetPasswordCodeExpires", { type: Sequelize.DATE(3), allowNull: true });
    await addColumnOnce(queryInterface, "users", "resetPasswordAttempts", { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addColumnOnce(queryInterface, "users", "isSupplierStaff", { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await addColumnOnce(queryInterface, "user_addresses", "sector", { type: Sequelize.STRING(80), allowNull: true });
    await addColumnOnce(queryInterface, "vendors", "category", { type: Sequelize.STRING(120), allowNull: true });
    await addColumnOnce(queryInterface, "staff", "email", { type: Sequelize.STRING(190), allowNull: true });
    await addColumnOnce(queryInterface, "staff", "invitationTokenHash", { type: Sequelize.STRING(128), allowNull: true });
    await addColumnOnce(queryInterface, "staff", "invitationExpiresAt", { type: Sequelize.DATE(3), allowNull: true });
    await addColumnOnce(queryInterface, "products", "discount", { type: Sequelize.JSON, allowNull: true });
    await addColumnOnce(queryInterface, "orders", "deliveryOtpAttempts", { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addColumnOnce(queryInterface, "orders", "recipientName", { type: Sequelize.STRING(150), allowNull: true });
    await addColumnOnce(queryInterface, "orders", "recipientPhone", { type: Sequelize.STRING(30), allowNull: true });
    await addColumnOnce(queryInterface, "orders", "recipientEmail", { type: Sequelize.STRING(190), allowNull: true });
    await addColumnOnce(queryInterface, "orders", "deliveryMethod", { type: Sequelize.ENUM("standard", "express"), allowNull: true, defaultValue: "standard" });
    await addColumnOnce(queryInterface, "orders", "paidAt", { type: Sequelize.DATE(3), allowNull: true });
    await addColumnOnce(queryInterface, "orders", "shippedAt", { type: Sequelize.DATE(3), allowNull: true });
    await addColumnOnce(queryInterface, "orders", "paymentReminderSentAt", { type: Sequelize.DATE(3), allowNull: true });
    await addColumnOnce(queryInterface, "orders", "courierId", { type: Sequelize.CHAR(24), allowNull: true });
    await addColumnOnce(queryInterface, "orders", "deliveredVendors", { type: Sequelize.JSON, allowNull: true });
    await addColumnOnce(queryInterface, "order_items", "affiliateUserId", { type: Sequelize.CHAR(24), allowNull: true });
    await addColumnOnce(queryInterface, "order_items", "affiliateLinkId", { type: Sequelize.CHAR(24), allowNull: true });
    await addColumnOnce(queryInterface, "order_items", "affiliateCode", { type: Sequelize.STRING(60), allowNull: true });
    await addColumnOnce(queryInterface, "order_items", "affiliateClickedAt", { type: Sequelize.DATE(3), allowNull: true });
    await addIndexOnce(queryInterface, "order_items", ["affiliateUserId"]);
    await addColumnOnce(queryInterface, "settlements", "orderItemId", { type: Sequelize.CHAR(24), allowNull: true });
    await addIndexOnce(queryInterface, "settlements", ["orderId","orderItemId"], { unique: true });
    await addColumnOnce(queryInterface, "notifications", "link", { type: Sequelize.STRING(500), allowNull: true, defaultValue: "" });
    await addColumnOnce(queryInterface, "suppliers", "category", { type: Sequelize.STRING(120), allowNull: true, defaultValue: "" });
    await addColumnOnce(queryInterface, "affiliate_clicks", "productId", { type: Sequelize.CHAR(24), allowNull: true });
    await addColumnOnce(queryInterface, "affiliate_clicks", "visitorId", { type: Sequelize.STRING(32), allowNull: true, defaultValue: "" });
    await addIndexOnce(queryInterface, "affiliate_clicks", ["productId"]);
    await addIndexOnce(queryInterface, "affiliate_clicks", ["visitorId"]);
    await addColumnOnce(queryInterface, "affiliate_links", "status", { type: Sequelize.ENUM("ACTIVE", "TERMINATED"), allowNull: false, defaultValue: "ACTIVE" });
    await addColumnOnce(queryInterface, "affiliate_links", "terminatedAt", { type: Sequelize.DATE(3), allowNull: true });
    await addIndexOnce(queryInterface, "affiliate_links", ["status"]);
    await addColumnOnce(queryInterface, "conversion_audits", "orderItemId", { type: Sequelize.CHAR(24), allowNull: true });
    await addColumnOnce(queryInterface, "conversion_audits", "settlementId", { type: Sequelize.CHAR(24), allowNull: true });
    await addColumnOnce(queryInterface, "conversion_audits", "buyerId", { type: Sequelize.CHAR(24), allowNull: true });
    await addColumnOnce(queryInterface, "conversion_audits", "quantity", { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 });
    await addColumnOnce(queryInterface, "conversion_audits", "clickedAt", { type: Sequelize.DATE(3), allowNull: true });
    await addColumnOnce(queryInterface, "conversion_audits", "reversedAmount", { type: Sequelize.DECIMAL(14,2), allowNull: false, defaultValue: 0 });
    await addColumnOnce(queryInterface, "conversion_audits", "unrecoveredAmount", { type: Sequelize.DECIMAL(14,2), allowNull: false, defaultValue: 0 });
    await addColumnOnce(queryInterface, "conversion_audits", "reversals", { type: Sequelize.JSON, allowNull: true });
    await addColumnOnce(queryInterface, "conversion_audits", "approvedAt", { type: Sequelize.DATE(3), allowNull: true });
    await addIndexOnce(queryInterface, "conversion_audits", ["orderId","orderItemId"], { unique: true });

    // ---- ENUMs are extended in place (existing values and rows are kept) ------
    const modify = (table, column, values, nullable, def) =>
      queryInterface.sequelize.query(
        `ALTER TABLE \`${table}\` MODIFY \`${column}\` ENUM(${values.map((v) => queryInterface.sequelize.escape(v)).join(",")}) ${nullable ? "NULL" : "NOT NULL"} DEFAULT ${queryInterface.sequelize.escape(def)}`
      );
    await modify("users", "role", ["buyer", "vendor", "supplier", "affiliate", "super_admin", "developer", "delivery"], false, "buyer");
    await modify("orders", "paymentStatus", ["PENDING", "CONFIRMED", "PAID", "FAILED", "REFUNDED", "DISPUTED"], false, "PENDING");
    await modify("conversion_audits", "status", ["PENDING", "APPROVED", "PAID", "REJECTED", "REVERSED"], false, "PENDING");

    // Province is now separate; the legacy "state" is optional (checkout no longer sends it).
    await queryInterface.sequelize.query("ALTER TABLE `orders` MODIFY `shippingAddressState` VARCHAR(120) NULL");

    // ---- backfill role-dependent defaults (Mongoose computes them from role) -----
    // Vendors/suppliers who already have a profile row are onboarded and take its
    // verification status; vendors/suppliers without one still have to onboard.
    await queryInterface.sequelize.query(
      "UPDATE users u JOIN vendors v ON v.userId = u.id SET u.isOnboarded = 1, u.verificationStatus = v.verificationStatus WHERE u.role = 'vendor' AND u.isVendorStaff = 0"
    );
    await queryInterface.sequelize.query(
      "UPDATE users u JOIN suppliers s ON s.userId = u.id SET u.isOnboarded = 1, u.verificationStatus = s.verificationStatus WHERE u.role = 'supplier'"
    );
    await queryInterface.sequelize.query(
      "UPDATE users u SET u.isOnboarded = 0, u.verificationStatus = 'UNVERIFIED' WHERE u.role IN ('vendor','supplier') AND u.isVendorStaff = 0 AND NOT EXISTS (SELECT 1 FROM vendors v WHERE v.userId = u.id) AND NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.userId = u.id)"
    );
  },

  // Reverses only what this migration added. Run it knowingly: it drops the
  // new tables and columns (and therefore their data).
  async down(queryInterface) {
    await queryInterface.dropTable("affiliate_attributions");
    await queryInterface.dropTable("disbursements");
    await queryInterface.dropTable("supplier_reviews");
    await queryInterface.dropTable("supplier_supply_requests");
    await queryInterface.dropTable("supplier_supply_request_lines");
    await queryInterface.dropTable("supplier_supply_request_events");
    await queryInterface.dropTable("supplier_team_members");
  },
};
