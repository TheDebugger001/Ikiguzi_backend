"use strict";

/** Phase 4: shipping, promotions, reviews, monetization, messaging, suppliers, support, disputes, affiliates, wholesale (generated from src/database/spec at the time of writing; edit with new migrations). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("shipping_zones", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      publicId: { type: Sequelize.STRING(32), allowNull: true, unique: true },
      storeId: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "stores", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      vendorId: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      name: { type: Sequelize.STRING(150), allowNull: false },
      countries: { type: Sequelize.JSON, allowNull: true },
      provinces: { type: Sequelize.JSON, allowNull: true },
      districts: { type: Sequelize.JSON, allowNull: true },
      postalCodes: { type: Sequelize.JSON, allowNull: true },
      fee: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      expressFee: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      pickupFee: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      freeOverAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      eta: { type: Sequelize.STRING(60), allowNull: true, defaultValue: "1–3 days" },
      methods: { type: Sequelize.JSON, allowNull: true },
      status: { type: Sequelize.ENUM("ACTIVE", "PAUSED"), allowNull: false, defaultValue: "ACTIVE" },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("shipping_zones", ["storeId"]);
    await queryInterface.addIndex("shipping_zones", ["vendorId"]);
    await queryInterface.addIndex("shipping_zones", ["status"]);
    await queryInterface.createTable("promotions", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      publicId: { type: Sequelize.STRING(32), allowNull: true, unique: true },
      storeId: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "stores", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      vendorId: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      productId: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "products", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      categoryId: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "categories", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      name: { type: Sequelize.STRING(150), allowNull: false },
      code: { type: Sequelize.STRING(60), allowNull: false },
      type: { type: Sequelize.ENUM("PERCENT", "FIXED", "FREE_SHIPPING"), allowNull: false, defaultValue: "PERCENT" },
      value: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.ENUM("DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "EXPIRED", "CANCELLED"), allowNull: false, defaultValue: "DRAFT" },
      startsAt: { type: Sequelize.DATE, allowNull: true },
      endsAt: { type: Sequelize.DATE, allowNull: true },
      usageLimit: { type: Sequelize.INTEGER, allowNull: true },
      usedCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      minOrderAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      createdById: { type: Sequelize.CHAR(24), allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("promotions", ["vendorId"]);
    await queryInterface.addIndex("promotions", ["code"]);
    await queryInterface.addIndex("promotions", ["status"]);
    await queryInterface.createTable("reviews", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      userId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      productId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "products", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      parentOrderId: { type: Sequelize.CHAR(24), allowNull: false },
      rating: { type: Sequelize.INTEGER, allowNull: false },
      reviewText: { type: Sequelize.TEXT, allowNull: true },
      images: { type: Sequelize.JSON, allowNull: true },
      status: { type: Sequelize.ENUM("PENDING", "PUBLISHED", "HIDDEN"), allowNull: false, defaultValue: "PUBLISHED" },
      isVerifiedPurchase: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      vendorReplyText: { type: Sequelize.TEXT, allowNull: true },
      vendorReplyRepliedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("reviews", ["productId"]);
    await queryInterface.addIndex("reviews", ["userId","productId","parentOrderId"], { unique: true });
    await queryInterface.createTable("advertisements", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      publicId: { type: Sequelize.STRING(32), allowNull: true, unique: true },
      vendorId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "vendors", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      product: { type: Sequelize.STRING(255), allowNull: false },
      productRefId: { type: Sequelize.CHAR(24), allowNull: true, references: { model: "products", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
      placement: { type: Sequelize.ENUM("HOMEPAGE_HERO", "CATEGORY_BANNER", "SEARCH_RESULTS", "FEATURED", "PROMOTION"), allowNull: false, defaultValue: "SEARCH_RESULTS" },
      budget: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      startDate: { type: Sequelize.DATE, allowNull: true },
      endDate: { type: Sequelize.DATE, allowNull: true },
      status: { type: Sequelize.ENUM("PENDING", "ACTIVE", "PAUSED", "REJECTED", "COMPLETED"), allowNull: false, defaultValue: "PENDING" },
      impressions: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      clicks: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("advertisements", ["vendorId"]);
    await queryInterface.addIndex("advertisements", ["status"]);
    await queryInterface.createTable("subscriptions", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      publicId: { type: Sequelize.STRING(32), allowNull: true, unique: true },
      vendorId: { type: Sequelize.CHAR(24), allowNull: false, unique: true, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      plan: { type: Sequelize.ENUM("FREE", "PREMIUM"), allowNull: false, defaultValue: "FREE" },
      status: { type: Sequelize.ENUM("ACTIVE", "CANCELLED", "EXPIRED"), allowNull: false, defaultValue: "ACTIVE" },
      price: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      billingCycle: { type: Sequelize.ENUM("FREE", "MONTHLY", "YEARLY"), allowNull: false, defaultValue: "FREE" },
      startDate: { type: Sequelize.DATE, allowNull: true },
      renewalDate: { type: Sequelize.DATE, allowNull: true },
      autoRenew: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.createTable("buyer_subscriptions", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      publicId: { type: Sequelize.STRING(32), allowNull: true, unique: true },
      buyerId: { type: Sequelize.CHAR(24), allowNull: false, unique: true, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      plan: { type: Sequelize.ENUM("FREE", "PREMIUM"), allowNull: false, defaultValue: "FREE" },
      status: { type: Sequelize.ENUM("ACTIVE", "CANCELLED", "EXPIRED"), allowNull: false, defaultValue: "ACTIVE" },
      price: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      billingCycle: { type: Sequelize.ENUM("FREE", "MONTHLY", "YEARLY"), allowNull: false, defaultValue: "FREE" },
      startDate: { type: Sequelize.DATE, allowNull: true },
      renewalDate: { type: Sequelize.DATE, allowNull: true },
      autoRenew: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.createTable("notifications", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      recipientId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      type: { type: Sequelize.ENUM("ORDER", "DELIVERY", "PAYMENT", "PAYOUT", "STOCK", "REVIEW", "MESSAGE", "SUBSCRIPTION", "ADMIN", "SYSTEM"), allowNull: false, defaultValue: "SYSTEM" },
      title: { type: Sequelize.STRING(255), allowNull: false },
      message: { type: Sequelize.TEXT, allowNull: true },
      reference: { type: Sequelize.STRING(255), allowNull: true, defaultValue: "" },
      channel: { type: Sequelize.ENUM("IN_APP", "SMS", "PUSH", "EMAIL"), allowNull: false, defaultValue: "IN_APP" },
      isRead: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      readAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("notifications", ["recipientId","isRead","createdAt"]);
    await queryInterface.createTable("conversations", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      participants: { type: Sequelize.JSON, allowNull: true },
      subject: { type: Sequelize.STRING(255), allowNull: true, defaultValue: "" },
      lastMessage: { type: Sequelize.TEXT, allowNull: true },
      lastMessageAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.createTable("messages", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      conversationId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "conversations", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      senderId: { type: Sequelize.CHAR(24), allowNull: false },
      content: { type: Sequelize.TEXT, allowNull: false },
      attachments: { type: Sequelize.JSON, allowNull: true },
      readBy: { type: Sequelize.JSON, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("messages", ["conversationId","createdAt"]);
    await queryInterface.createTable("suppliers", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      publicId: { type: Sequelize.STRING(32), allowNull: true, unique: true },
      userId: { type: Sequelize.CHAR(24), allowNull: false, unique: true, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      businessName: { type: Sequelize.STRING(150), allowNull: false },
      slug: { type: Sequelize.STRING(190), allowNull: true, unique: true },
      logoUrl: { type: Sequelize.STRING(500), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      phone: { type: Sequelize.STRING(30), allowNull: false },
      email: { type: Sequelize.STRING(190), allowNull: false },
      verificationStatus: { type: Sequelize.ENUM("UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"), allowNull: false, defaultValue: "UNVERIFIED" },
      ratingAvg: { type: Sequelize.DOUBLE, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.ENUM("ACTIVE", "SUSPENDED", "BLOCKED", "UNDER_REVIEW"), allowNull: false, defaultValue: "ACTIVE" },
      location: { type: Sequelize.JSON, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.createTable("support_cases", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      ticketNumber: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      openedById: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      subject: { type: Sequelize.STRING(255), allowNull: false },
      category: { type: Sequelize.ENUM("ORDER", "PAYMENT", "ACCOUNT", "VENDOR_ONBOARDING", "TECHNICAL", "OTHER"), allowNull: false, defaultValue: "OTHER" },
      priority: { type: Sequelize.ENUM("LOW", "MEDIUM", "HIGH", "URGENT"), allowNull: false, defaultValue: "MEDIUM" },
      status: { type: Sequelize.ENUM("OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"), allowNull: false, defaultValue: "OPEN" },
      description: { type: Sequelize.TEXT, allowNull: false },
      assignedToId: { type: Sequelize.CHAR(24), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("support_cases", ["openedById"]);
    await queryInterface.addIndex("support_cases", ["status"]);
    await queryInterface.createTable("support_case_comments", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      supportCaseId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "support_cases", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      authorId: { type: Sequelize.CHAR(24), allowNull: false },
      message: { type: Sequelize.TEXT, allowNull: false },
      attachments: { type: Sequelize.JSON, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: true },
      updatedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex("support_case_comments", ["supportCaseId","position"]);
    await queryInterface.createTable("translations", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      key: { type: Sequelize.STRING(190), allowNull: false, unique: true },
      module: { type: Sequelize.STRING(80), allowNull: true, defaultValue: "common" },
      translationsEn: { type: Sequelize.TEXT, allowNull: false },
      translationsRw: { type: Sequelize.TEXT, allowNull: false },
      translationsFr: { type: Sequelize.TEXT, allowNull: false },
      isApproved: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("translations", ["module"]);
    await queryInterface.createTable("abuse_reports", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      reportNumber: { type: Sequelize.STRING(60), allowNull: true, unique: true },
      reporterId: { type: Sequelize.CHAR(24), allowNull: false },
      targetUserId: { type: Sequelize.CHAR(24), allowNull: false },
      targetStoreId: { type: Sequelize.CHAR(24), allowNull: true },
      targetRole: { type: Sequelize.ENUM("buyer", "vendor", "supplier", "affiliate", "super_admin", "developer"), allowNull: true },
      relatedOrderId: { type: Sequelize.CHAR(24), allowNull: true },
      reasonCategory: { type: Sequelize.ENUM("FRAUDULENT_ACTIVITY", "HARASSMENT_OR_ABUSE", "NON_COMPLIANT_PRODUCT_OR_ORDER", "OTHER_POLICY_VIOLATION"), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      evidenceUrls: { type: Sequelize.JSON, allowNull: true },
      incidentDate: { type: Sequelize.DATE, allowNull: true },
      status: { type: Sequelize.ENUM("INVESTIGATE", "PENDING", "RESOLVED", "REJECTED"), allowNull: false, defaultValue: "PENDING" },
      adminNotes: { type: Sequelize.TEXT, allowNull: true },
      resolvedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("abuse_reports", ["targetUserId"]);
    await queryInterface.addIndex("abuse_reports", ["status"]);
    await queryInterface.createTable("disputes", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      disputeNumber: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      orderId: { type: Sequelize.CHAR(24), allowNull: false },
      raisedById: { type: Sequelize.CHAR(24), allowNull: false },
      vendorId: { type: Sequelize.CHAR(24), allowNull: false },
      reason: { type: Sequelize.ENUM("ITEM_NOT_RECEIVED", "DAMAGED_GOODS", "WRONG_ITEM", "INCOMPLETE_ORDER", "SLA_BREACH", "OTHER"), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.ENUM("OPEN", "UNDER_REVIEW", "EVIDENCE_SUBMITTED", "RESOLVED_BUYER_REFUNDED", "RESOLVED_VENDOR_RELEASED", "RESOLVED_SPLIT", "REJECTED"), allowNull: false, defaultValue: "OPEN" },
      disputedAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      arbitrationDecisionDecision: { type: Sequelize.ENUM("REFUND_BUYER", "RELEASE_TO_VENDOR", "SPLIT_SETTLEMENT"), allowNull: true },
      arbitrationDecisionBuyerRefundAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 },
      arbitrationDecisionVendorReleaseAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 },
      arbitrationDecisionArbitratedById: { type: Sequelize.CHAR(24), allowNull: true },
      arbitrationDecisionNotes: { type: Sequelize.TEXT, allowNull: true },
      arbitrationDecisionDecidedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("disputes", ["orderId"]);
    await queryInterface.addIndex("disputes", ["vendorId"]);
    await queryInterface.addIndex("disputes", ["status"]);
    await queryInterface.createTable("dispute_evidences", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      disputeId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "disputes", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      submittedById: { type: Sequelize.CHAR(24), allowNull: false },
      senderRole: { type: Sequelize.ENUM("buyer", "vendor", "super_admin"), allowNull: false },
      message: { type: Sequelize.TEXT, allowNull: true },
      attachments: { type: Sequelize.JSON, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("dispute_evidences", ["disputeId"]);
    await queryInterface.createTable("affiliate_accounts", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      affiliateUserId: { type: Sequelize.CHAR(24), allowNull: false, unique: true, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      referralCode: { type: Sequelize.STRING(60), allowNull: true, unique: true },
      displayName: { type: Sequelize.STRING(150), allowNull: true, defaultValue: "" },
      bio: { type: Sequelize.TEXT, allowNull: true },
      website: { type: Sequelize.STRING(300), allowNull: true, defaultValue: "" },
      country: { type: Sequelize.STRING(80), allowNull: true, defaultValue: "Rwanda" },
      commissionRate: { type: Sequelize.DOUBLE, allowNull: false, defaultValue: 0 },
      paymentMethod: { type: Sequelize.ENUM("MTN_MOMO", "AIRTEL_MONEY", "BANK_TRANSFER"), allowNull: false, defaultValue: "MTN_MOMO" },
      accountDetailsPhoneNumber: { type: Sequelize.STRING(30), allowNull: true, defaultValue: "" },
      accountDetailsAccountName: { type: Sequelize.STRING(150), allowNull: true, defaultValue: "" },
      accountDetailsBankName: { type: Sequelize.STRING(120), allowNull: true, defaultValue: "" },
      accountDetailsAccountNumber: { type: Sequelize.STRING(60), allowNull: true, defaultValue: "" },
      verificationStatus: { type: Sequelize.ENUM("UNVERIFIED", "PENDING", "UNDER_REVIEW", "VERIFIED", "REJECTED"), allowNull: false, defaultValue: "UNVERIFIED" },
      verificationSubmittedAt: { type: Sequelize.DATE, allowNull: true },
      verificationReviewedAt: { type: Sequelize.DATE, allowNull: true },
      verificationNotes: { type: Sequelize.TEXT, allowNull: true },
      verificationDocuments: { type: Sequelize.JSON, allowNull: true },
      preferencesDefaultPayoutMethod: { type: Sequelize.STRING(40), allowNull: true, defaultValue: "MTN_MOMO" },
      preferencesEmailNotifications: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      preferencesPushNotifications: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      preferencesPayoutAlerts: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      preferencesMarketingEmails: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      preferencesLanguage: { type: Sequelize.STRING(40), allowNull: true, defaultValue: "English" },
      preferencesThemeMode: { type: Sequelize.STRING(20), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.createTable("affiliate_campaigns", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      campaignCode: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(150), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      banner: { type: Sequelize.STRING(500), allowNull: true, defaultValue: "" },
      commissionRate: { type: Sequelize.DOUBLE, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.ENUM("ACTIVE", "PAUSED", "EXPIRED"), allowNull: false, defaultValue: "ACTIVE" },
      startsAt: { type: Sequelize.DATE, allowNull: true },
      endsAt: { type: Sequelize.DATE, allowNull: true },
      products: { type: Sequelize.JSON, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("affiliate_campaigns", ["status"]);
    await queryInterface.createTable("affiliate_campaign_members", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      campaignId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "affiliate_campaigns", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      affiliateUserId: { type: Sequelize.CHAR(24), allowNull: false },
      joinedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex("affiliate_campaign_members", ["affiliateUserId"]);
    await queryInterface.addIndex("affiliate_campaign_members", ["campaignId","position"]);
    await queryInterface.createTable("affiliate_clicks", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      affiliateUserId: { type: Sequelize.CHAR(24), allowNull: false },
      linkId: { type: Sequelize.CHAR(24), allowNull: true },
      affiliateCode: { type: Sequelize.STRING(60), allowNull: true, defaultValue: "" },
      buyerUserId: { type: Sequelize.CHAR(24), allowNull: true },
      visitorIp: { type: Sequelize.STRING(64), allowNull: true, defaultValue: "" },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("affiliate_clicks", ["linkId"]);
    await queryInterface.addIndex("affiliate_clicks", ["affiliateCode"]);
    await queryInterface.addIndex("affiliate_clicks", ["affiliateUserId","createdAt"]);
    await queryInterface.createTable("affiliate_links", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      affiliateCode: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      affiliateUserId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      targetProductId: { type: Sequelize.CHAR(24), allowNull: true },
      campaignId: { type: Sequelize.CHAR(24), allowNull: true },
      label: { type: Sequelize.STRING(255), allowNull: true, defaultValue: "" },
      lastClickedAt: { type: Sequelize.DATE, allowNull: true },
      clickCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      conversionCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("affiliate_links", ["affiliateUserId"]);
    await queryInterface.addIndex("affiliate_links", ["campaignId"]);
    await queryInterface.createTable("affiliate_payouts", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      payoutNumber: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      affiliateUserId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      paymentMethod: { type: Sequelize.ENUM("MTN_MOMO", "AIRTEL_MONEY", "BANK_TRANSFER"), allowNull: false },
      accountDetailsPhoneNumber: { type: Sequelize.STRING(30), allowNull: true },
      accountDetailsAccountName: { type: Sequelize.STRING(150), allowNull: true },
      accountDetailsBankName: { type: Sequelize.STRING(120), allowNull: true },
      accountDetailsAccountNumber: { type: Sequelize.STRING(60), allowNull: true },
      status: { type: Sequelize.ENUM("PENDING", "APPROVED", "PROCESSING", "COMPLETED", "REJECTED"), allowNull: false, defaultValue: "PENDING" },
      approvedById: { type: Sequelize.CHAR(24), allowNull: true },
      transactionReference: { type: Sequelize.STRING(120), allowNull: true },
      rejectionReason: { type: Sequelize.STRING(500), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("affiliate_payouts", ["affiliateUserId"]);
    await queryInterface.addIndex("affiliate_payouts", ["status"]);
    await queryInterface.createTable("affiliate_wallets", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      affiliateUserId: { type: Sequelize.CHAR(24), allowNull: false, unique: true, references: { model: "users", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      pendingBalance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      availableBalance: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      totalWithdrawn: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.createTable("conversion_audits", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      affiliateUserId: { type: Sequelize.CHAR(24), allowNull: false },
      linkId: { type: Sequelize.CHAR(24), allowNull: true },
      targetProductId: { type: Sequelize.CHAR(24), allowNull: true },
      orderId: { type: Sequelize.CHAR(24), allowNull: true },
      referralCode: { type: Sequelize.STRING(60), allowNull: true, defaultValue: "" },
      conversionValue: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      commissionEarned: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.ENUM("PENDING", "APPROVED", "PAID", "REJECTED"), allowNull: false, defaultValue: "PENDING" },
      convertedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("conversion_audits", ["orderId"]);
    await queryInterface.addIndex("conversion_audits", ["status"]);
    await queryInterface.addIndex("conversion_audits", ["affiliateUserId","convertedAt"]);
    await queryInterface.createTable("wholesale_products", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      supplierId: { type: Sequelize.CHAR(24), allowNull: false },
      name: { type: Sequelize.STRING(255), allowNull: false },
      shortDescription: { type: Sequelize.STRING(500), allowNull: true, defaultValue: "" },
      category: { type: Sequelize.STRING(120), allowNull: true, defaultValue: "General" },
      unit: { type: Sequelize.STRING(40), allowNull: true, defaultValue: "piece" },
      wholesalePrice: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      retailPrice: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      moq: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      stockQuantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      bulkDiscount: { type: Sequelize.DOUBLE, allowNull: false, defaultValue: 0 },
      mediaMainImage: { type: Sequelize.STRING(1000), allowNull: true, defaultValue: "" },
      mediaGallery: { type: Sequelize.JSON, allowNull: true },
      status: { type: Sequelize.ENUM("ACTIVE", "OUT_OF_STOCK", "ARCHIVED"), allowNull: false, defaultValue: "ACTIVE" },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("wholesale_products", ["supplierId"]);
    await queryInterface.addIndex("wholesale_products", ["status"]);
    await queryInterface.createTable("wholesale_orders", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      orderNumber: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      vendorId: { type: Sequelize.CHAR(24), allowNull: false },
      supplierId: { type: Sequelize.CHAR(24), allowNull: false },
      totalAmount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      status: { type: Sequelize.ENUM("PENDING_PAYMENT", "ESCROW_HELD", "SHIPPED", "DELIVERED", "CONFIRMED_RELEASED", "DISPUTED", "CANCELLED"), allowNull: false, defaultValue: "PENDING_PAYMENT" },
      deliveryOtp: { type: Sequelize.STRING(12), allowNull: true },
      shippedAt: { type: Sequelize.DATE, allowNull: true },
      deliveredAt: { type: Sequelize.DATE, allowNull: true },
      confirmedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("wholesale_orders", ["vendorId"]);
    await queryInterface.addIndex("wholesale_orders", ["supplierId"]);
    await queryInterface.addIndex("wholesale_orders", ["status"]);
    await queryInterface.createTable("wholesale_order_items", {
      id: { type: Sequelize.CHAR(24), primaryKey: true, allowNull: false },
      wholesaleOrderId: { type: Sequelize.CHAR(24), allowNull: false, references: { model: "wholesale_orders", key: "id" }, onDelete: "CASCADE", onUpdate: "CASCADE" },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      productId: { type: Sequelize.CHAR(24), allowNull: false },
      productName: { type: Sequelize.STRING(255), allowNull: false },
      unitPrice: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      quantity: { type: Sequelize.INTEGER, allowNull: false },
      moq: { type: Sequelize.INTEGER, allowNull: false },
    });
    await queryInterface.addIndex("wholesale_order_items", ["wholesaleOrderId","position"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("wholesale_order_items");
    await queryInterface.dropTable("wholesale_orders");
    await queryInterface.dropTable("wholesale_products");
    await queryInterface.dropTable("conversion_audits");
    await queryInterface.dropTable("affiliate_wallets");
    await queryInterface.dropTable("affiliate_payouts");
    await queryInterface.dropTable("affiliate_links");
    await queryInterface.dropTable("affiliate_clicks");
    await queryInterface.dropTable("affiliate_campaign_members");
    await queryInterface.dropTable("affiliate_campaigns");
    await queryInterface.dropTable("affiliate_accounts");
    await queryInterface.dropTable("dispute_evidences");
    await queryInterface.dropTable("disputes");
    await queryInterface.dropTable("abuse_reports");
    await queryInterface.dropTable("translations");
    await queryInterface.dropTable("support_case_comments");
    await queryInterface.dropTable("support_cases");
    await queryInterface.dropTable("suppliers");
    await queryInterface.dropTable("messages");
    await queryInterface.dropTable("conversations");
    await queryInterface.dropTable("notifications");
    await queryInterface.dropTable("buyer_subscriptions");
    await queryInterface.dropTable("subscriptions");
    await queryInterface.dropTable("advertisements");
    await queryInterface.dropTable("reviews");
    await queryInterface.dropTable("promotions");
    await queryInterface.dropTable("shipping_zones");
  },
};
