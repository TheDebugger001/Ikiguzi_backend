"use strict";

/** Phase 3: carts, orders, payments, escrow, ledger, wallets, payouts (generated from src/database/spec at the time of writing; edit with new migrations). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("carts", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      userId: { type: Sequelize.CHAR(24), allowNull: false, unique: true, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      totalAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.createTable("cart_items", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      cartId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "carts", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      productId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "products", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      price: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
    });
    await queryInterface.addIndex("cart_items", ["cartId","position"]);
    await queryInterface.createTable("orders", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      userId: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      source: { type: Sequelize.ENUM("ONLINE", "MANUAL"), allowNull: false, defaultValue: "ONLINE" },
      customerName: { type: Sequelize.STRING(150), allowNull: true },
      customerPhone: { type: Sequelize.STRING(30), allowNull: true },
      customerEmail: { type: Sequelize.STRING(190), allowNull: true },
      createdById: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      paidOffline: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      offlinePaymentMethod: { type: Sequelize.ENUM("CASH", "MOMO", "BANK"), allowNull: true },
      sellerNote: { type: Sequelize.STRING(500), allowNull: true, defaultValue: "" },
      orderNumber: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      shippingAddressStreet: { type: Sequelize.STRING(255), allowNull: false },
      shippingAddressCity: { type: Sequelize.STRING(120), allowNull: false },
      shippingAddressState: { type: Sequelize.STRING(120), allowNull: false },
      shippingAddressCountry: { type: Sequelize.STRING(80), allowNull: false },
      shippingAddressPostalCode: { type: Sequelize.STRING(20), allowNull: true },
      shippingAddressProvince: { type: Sequelize.STRING(120), allowNull: true },
      shippingAddressDistrict: { type: Sequelize.STRING(120), allowNull: true },
      shippingAddressSector: { type: Sequelize.STRING(120), allowNull: true },
      subtotal: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      shippingFee: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      shippingMethod: { type: Sequelize.ENUM("STANDARD", "EXPRESS", "PICKUP"), allowNull: false, defaultValue: "STANDARD" },
      totalAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      paymentStatus: { type: Sequelize.ENUM("PENDING", "CONFIRMED", "PAID", "FAILED", "REFUNDED"), allowNull: false, defaultValue: "PENDING" },
      orderStatus: { type: Sequelize.ENUM("PENDING", "CONFIRMED", "PROCESSING", "READY_FOR_SHIPMENT", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "CANCELLED", "RETURNED", "REFUNDED", "FAILED"), allowNull: false, defaultValue: "PENDING" },
      paymentMethod: { type: Sequelize.ENUM("MOMO", "AIRTEL", "CASH_ON_DELIVERY", "CARD", "BANK", "CASH"), allowNull: false, defaultValue: "MOMO" },
      deliveryOtp: { type: Sequelize.STRING(12), allowNull: true },
      isDelivered: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      deliveredAt: { type: Sequelize.DATE, allowNull: true },
      slaBreached: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      slaBreachedAt: { type: Sequelize.DATE, allowNull: true },
      cancellationReason: { type: Sequelize.TEXT, allowNull: true },
      adminNotes: { type: Sequelize.TEXT, allowNull: true },
      paymentReference: { type: Sequelize.STRING(120), allowNull: true },
      affiliateCode: { type: Sequelize.STRING(60), allowNull: true },
      affiliateUserId: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      status: { type: Sequelize.STRING(30), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("orders", ["userId"]);
    await queryInterface.addIndex("orders", ["source"]);
    await queryInterface.addIndex("orders", ["paymentStatus"]);
    await queryInterface.addIndex("orders", ["orderStatus"]);
    await queryInterface.createTable("order_items", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      orderId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "orders", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      productId: { type: Sequelize.CHAR(24), allowNull: true },
      vendorId: { type: Sequelize.CHAR(24), allowNull: true },
      categoryId: { type: Sequelize.CHAR(24), allowNull: true },
      name: { type: Sequelize.STRING(255), allowNull: false },
      price: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      quantity: { type: Sequelize.INTEGER, allowNull: false },
      image: { type: Sequelize.STRING(1000), allowNull: true },
    });
    await queryInterface.addIndex("order_items", ["productId"]);
    await queryInterface.addIndex("order_items", ["vendorId"]);
    await queryInterface.addIndex("order_items", ["orderId","position"]);
    await queryInterface.createTable("order_parcels", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      orderId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "orders", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      vendorId: { type: Sequelize.CHAR(24), allowNull: true },
      storeId: { type: Sequelize.CHAR(24), allowNull: true },
      storeName: { type: Sequelize.STRING(150), allowNull: true },
      zoneId: { type: Sequelize.CHAR(24), allowNull: true },
      zoneName: { type: Sequelize.STRING(150), allowNull: true },
      method: { type: Sequelize.STRING(20), allowNull: true },
      fee: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      eta: { type: Sequelize.STRING(60), allowNull: true },
    });
    await queryInterface.addIndex("order_parcels", ["vendorId"]);
    await queryInterface.addIndex("order_parcels", ["orderId","position"]);
    await queryInterface.createTable("payments", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      parentOrderId: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "orders", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      userId: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      transactionReference: { type: Sequelize.STRING(120), allowNull: false, unique: true },
      gatewayReference: { type: Sequelize.STRING(120), allowNull: true, unique: true },
      method: { type: Sequelize.ENUM("MOMO", "AIRTEL", "CASH_ON_DELIVERY"), allowNull: false },
      gateway: { type: Sequelize.ENUM("PAYPACK", "MOMO", "AIRTEL"), allowNull: true },
      phoneNumber: { type: Sequelize.STRING(30), allowNull: true },
      provider: { type: Sequelize.ENUM("MTN", "AIRTEL", "CASH"), allowNull: false },
      status: { type: Sequelize.ENUM("PENDING", "PROCESSING", "SUCCESS", "FAILED", "REFUNDED", "CANCELLED"), allowNull: false, defaultValue: "PENDING" },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "RWF" },
      gatewayFee: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      gatewayResponse: { type: Sequelize.JSON, allowNull: true },
      paidAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("payments", ["parentOrderId"]);
    await queryInterface.addIndex("payments", ["userId"]);
    await queryInterface.addIndex("payments", ["status"]);
    await queryInterface.createTable("payment_webhook_logs", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      provider: { type: Sequelize.ENUM("MTN_MOMO", "AIRTEL_MONEY", "PAYPACK"), allowNull: false },
      externalTransactionId: { type: Sequelize.STRING(120), allowNull: false, unique: true },
      internalOrderIdId: { type: Sequelize.CHAR(24), allowNull: false },
      status: { type: Sequelize.ENUM("PENDING", "PROCESSED", "FAILED", "IGNORED"), allowNull: false, defaultValue: "PENDING" },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "RWF" },
      rawPayload: { type: Sequelize.JSON, allowNull: false },
      errorMessage: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("payment_webhook_logs", ["internalOrderIdId"]);
    await queryInterface.createTable("pricing_snapshots", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      orderId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "orders", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      productId: { type: Sequelize.CHAR(24), allowNull: false },
      vendorId: { type: Sequelize.CHAR(24), allowNull: false },
      unitPrice: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      quantity: { type: Sequelize.INTEGER, allowNull: false },
      grossTotal: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      commissionRuleAppliedId: { type: Sequelize.CHAR(24), allowNull: true },
      commissionRateType: { type: Sequelize.ENUM("PERCENTAGE", "FIXED"), allowNull: false },
      commissionRateValue: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      commissionAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      vendorNetEarnings: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      developerShare: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      adminShare: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      affiliateShare: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      gatewayFee: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      hasAffiliate: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "RWF" },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("pricing_snapshots", ["orderId"]);
    await queryInterface.createTable("settlements", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      settlementReference: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      orderId: { type: Sequelize.CHAR(24), allowNull: false },
      vendorId: { type: Sequelize.CHAR(24), allowNull: false },
      grossAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      commissionAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      netAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      developerShare: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      adminShare: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      affiliateShare: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      gatewayFee: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      affiliateUserId: { type: Sequelize.CHAR(24), allowNull: true },
      status: { type: Sequelize.ENUM("HELD", "RELEASED", "ADMIN_HOLD", "REFUNDED", "CANCELLED"), allowNull: false, defaultValue: "HELD" },
      releasedAt: { type: Sequelize.DATE, allowNull: true },
      adminHoldReason: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("settlements", ["orderId"]);
    await queryInterface.addIndex("settlements", ["vendorId"]);
    await queryInterface.addIndex("settlements", ["status"]);
    await queryInterface.createTable("ledger_accounts", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      accountNumber: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      accountType: { type: Sequelize.ENUM("ESCROW_HOLDING", "PLATFORM_REVENUE", "VENDOR_PAYABLE", "SUPPLIER_PAYABLE", "COURIER_PAYABLE", "BUYER_REFUND_HOLD", "DEVELOPER_REVENUE", "ADMIN_REVENUE", "AFFILIATE_COMMISSION", "GATEWAY_FEES"), allowNull: false },
      ownerId: { type: Sequelize.CHAR(24), allowNull: true },
      currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "RWF" },
      balance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("ledger_accounts", ["accountType"]);
    await queryInterface.createTable("ledger_entries", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      transactionReference: { type: Sequelize.STRING(120), allowNull: false },
      debitAccountId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "ledger_accounts", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      creditAccountId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "ledger_accounts", key: "id" }, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "RWF" },
      entryType: { type: Sequelize.ENUM("PAYMENT_ESCROW_LOCK", "ESCROW_RELEASE_VENDOR", "PLATFORM_COMMISSION_DEDUCTION", "COURIER_FEE_PAYOUT", "BUYER_REFUND", "ADMIN_MANUAL_ADJUSTMENT"), allowNull: false },
      relatedOrderId: { type: Sequelize.CHAR(24), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("ledger_entries", ["transactionReference"]);
    await queryInterface.addIndex("ledger_entries", ["relatedOrderId"]);
    await queryInterface.createTable("vendor_wallets", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      vendorId: { type: Sequelize.CHAR(24), allowNull: false, unique: true, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      pendingBalance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      availableBalance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      totalEarned: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      totalWithdrawn: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "RWF" },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.createTable("vendor_balances", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      vendorId: { type: Sequelize.CHAR(24), allowNull: false, unique: true, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      storeId: { type: Sequelize.CHAR(24), allowNull: true },
      totalEarned: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      commissionPaid: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      pendingBalance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      availableBalance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      withdrawnAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.createTable("payouts", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      vendorId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      payoutNumber: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      payoutMethod: { type: Sequelize.ENUM("MOMO", "AIRTEL"), allowNull: true, defaultValue: "MOMO" },
      payoutDetailsAccountName: { type: Sequelize.STRING(150), allowNull: false },
      payoutDetailsAccountNumber: { type: Sequelize.STRING(60), allowNull: false },
      payoutDetailsBankName: { type: Sequelize.STRING(80), allowNull: true, defaultValue: "MTN MoMo" },
      status: { type: Sequelize.ENUM("PENDING", "PROCESSING", "PAID", "REJECTED", "FAILED"), allowNull: false, defaultValue: "PENDING" },
      transferReference: { type: Sequelize.STRING(120), allowNull: true },
      rejectionReason: { type: Sequelize.STRING(500), allowNull: true },
      processedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("payouts", ["vendorId"]);
    await queryInterface.addIndex("payouts", ["status"]);
    await queryInterface.createTable("admin_wallets", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      adminUserId: { type: Sequelize.CHAR(24), allowNull: false, unique: true, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      pendingBalance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      availableBalance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      totalEarned: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      totalWithdrawn: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.createTable("admin_payouts", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      payoutNumber: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      adminUserId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      paymentMethod: { type: Sequelize.ENUM("MOMO", "AIRTEL"), allowNull: true, defaultValue: "MOMO" },
      accountDetailsAccountName: { type: Sequelize.STRING(150), allowNull: false },
      accountDetailsAccountNumber: { type: Sequelize.STRING(60), allowNull: false },
      accountDetailsBankName: { type: Sequelize.STRING(80), allowNull: true, defaultValue: "MTN MoMo" },
      status: { type: Sequelize.ENUM("PENDING", "PROCESSING", "PAID", "REJECTED", "FAILED"), allowNull: true, defaultValue: "PENDING" },
      transactionReference: { type: Sequelize.STRING(120), allowNull: true },
      rejectionReason: { type: Sequelize.STRING(500), allowNull: true },
      processedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("admin_payouts", ["adminUserId"]);
    await queryInterface.addIndex("admin_payouts", ["status"]);
    await queryInterface.createTable("developer_wallets", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      developerUserId: { type: Sequelize.CHAR(24), allowNull: false, unique: true, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      pendingBalance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      availableBalance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      totalEarned: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      totalWithdrawn: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.createTable("developer_payouts", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      payoutNumber: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      developerUserId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      paymentMethod: { type: Sequelize.ENUM("MOMO", "AIRTEL"), allowNull: true, defaultValue: "MOMO" },
      accountDetailsAccountName: { type: Sequelize.STRING(150), allowNull: false },
      accountDetailsAccountNumber: { type: Sequelize.STRING(60), allowNull: false },
      accountDetailsBankName: { type: Sequelize.STRING(80), allowNull: true, defaultValue: "MTN MoMo" },
      status: { type: Sequelize.ENUM("PENDING", "PROCESSING", "PAID", "REJECTED", "FAILED"), allowNull: true, defaultValue: "PENDING" },
      transactionReference: { type: Sequelize.STRING(120), allowNull: true },
      rejectionReason: { type: Sequelize.STRING(500), allowNull: true },
      processedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("developer_payouts", ["developerUserId"]);
    await queryInterface.addIndex("developer_payouts", ["status"]);
    await queryInterface.createTable("commission_rules", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      name: { type: Sequelize.STRING(150), allowNull: false },
      ruleType: { type: Sequelize.ENUM("GLOBAL", "CATEGORY", "VENDOR", "PRODUCT"), allowNull: false },
      targetCategoryId: { type: Sequelize.CHAR(24), allowNull: true },
      targetVendorId: { type: Sequelize.CHAR(24), allowNull: true },
      targetProductId: { type: Sequelize.CHAR(24), allowNull: true },
      rateType: { type: Sequelize.ENUM("PERCENTAGE", "FIXED"), allowNull: false, defaultValue: "PERCENTAGE" },
      rateValue: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.createTable("provider_statements", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      provider: { type: Sequelize.ENUM("MTN_MOMO", "AIRTEL_MONEY"), allowNull: false },
      externalTransactionId: { type: Sequelize.STRING(120), allowNull: false },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "RWF" },
      transactionDate: { type: Sequelize.DATE, allowNull: false },
      reconciliationStatus: { type: Sequelize.ENUM("MATCHED", "MISMATCHED", "MISSING_IN_LEDGER"), allowNull: false, defaultValue: "MISSING_IN_LEDGER" },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("provider_statements", ["externalTransactionId"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("provider_statements");
    await queryInterface.dropTable("commission_rules");
    await queryInterface.dropTable("developer_payouts");
    await queryInterface.dropTable("developer_wallets");
    await queryInterface.dropTable("admin_payouts");
    await queryInterface.dropTable("admin_wallets");
    await queryInterface.dropTable("payouts");
    await queryInterface.dropTable("vendor_balances");
    await queryInterface.dropTable("vendor_wallets");
    await queryInterface.dropTable("ledger_entries");
    await queryInterface.dropTable("ledger_accounts");
    await queryInterface.dropTable("settlements");
    await queryInterface.dropTable("pricing_snapshots");
    await queryInterface.dropTable("payment_webhook_logs");
    await queryInterface.dropTable("payments");
    await queryInterface.dropTable("order_parcels");
    await queryInterface.dropTable("order_items");
    await queryInterface.dropTable("orders");
    await queryInterface.dropTable("cart_items");
    await queryInterface.dropTable("carts");
  },
};
