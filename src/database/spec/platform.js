// Phase 4 tables: shipping, promotions, reviews, monetization, messaging,
// suppliers, support, disputes, affiliates, wholesale.
const crypto = require("crypto");
const { ref, str, text, int, num, money, bool, date, en, json } = require("./fields");

const ROLES = ["buyer", "vendor", "supplier", "affiliate", "super_admin", "developer"];
const PAYMENT_METHODS = ["MTN_MOMO", "AIRTEL_MONEY", "BANK_TRANSFER"];
const slugify = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// Same renewal rule as the Mongoose subscription pre-save hooks.
const subscriptionHook = (prefix, skipFree) => async (row) => {
  if (!row.publicId) row.publicId = `${prefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  if (!row.startDate) row.startDate = new Date();
  if (row.status === "ACTIVE" && !row.renewalDate && !(skipFree && row.billingCycle === "FREE")) {
    const renewal = new Date(row.startDate);
    if (row.billingCycle === "YEARLY") renewal.setFullYear(renewal.getFullYear() + 1);
    else if (row.billingCycle === "MONTHLY") renewal.setMonth(renewal.getMonth() + 1);
    row.renewalDate = renewal;
  }
};
const subscription = (owner, prefix, model, table, collection, skipFree) => ({
  model, table, collection,
  hooks: { beforeSave: subscriptionHook(prefix, skipFree) },
  fields: {
    publicId: str({ len: 32, unique: true }),
    [owner]: ref("users", { required: true, unique: true, onDelete: "CASCADE" }),
    plan: en(["FREE", "PREMIUM"], { default: "FREE", required: true }),
    status: en(["ACTIVE", "CANCELLED", "EXPIRED"], { default: "ACTIVE", required: true }),
    price: money({ required: true, default: 0 }),
    billingCycle: en(["FREE", "MONTHLY", "YEARLY"], { default: "FREE", required: true }),
    startDate: date(),
    renewalDate: date(),
    autoRenew: bool(true),
  },
});
const affiliateAccountDetails = {
  "accountDetails.phoneNumber": str({ len: 30, default: "" }),
  "accountDetails.accountName": str({ len: 150, default: "" }),
  "accountDetails.bankName": str({ len: 120, default: "" }),
  "accountDetails.accountNumber": str({ len: 60, default: "" }),
};

module.exports = [
  {
    model: "ShippingZone", table: "shipping_zones", collection: "shippingzones", publicId: "MVEC-ZONE",
    fields: {
      publicId: str({ len: 32, unique: true }),
      store: ref("stores", { index: true }),
      vendor: ref("users", { index: true, onDelete: "CASCADE" }),
      name: str({ len: 150, required: true }),
      countries: json(["Rwanda"]),
      provinces: json([]),
      districts: json([]),
      postalCodes: json([]),
      fee: money({ required: true, default: 0 }),
      expressFee: money(),
      pickupFee: money({ required: true, default: 0 }),
      freeOverAmount: money({ required: true, default: 0 }),
      eta: str({ len: 60, default: "1–3 days" }),
      methods: json(["STANDARD"]),
      status: en(["ACTIVE", "PAUSED"], { default: "ACTIVE", required: true, index: true }),
    },
  },
  {
    model: "Promotion", table: "promotions", collection: "promotions", publicId: "MVEC-PRM",
    fields: {
      publicId: str({ len: 32, unique: true }),
      store: ref("stores"),
      vendor: ref("users", { index: true, onDelete: "CASCADE" }),
      product: ref("products"),
      category: ref("categories"),
      name: str({ len: 150, required: true }),
      code: str({ len: 60, required: true, uppercase: true, index: true }),
      type: en(["PERCENT", "FIXED", "FREE_SHIPPING"], { default: "PERCENT", required: true }),
      value: money({ required: true, default: 0 }),
      status: en(["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "EXPIRED", "CANCELLED"], { default: "DRAFT", required: true, index: true }),
      startsAt: date(),
      endsAt: date(),
      usageLimit: int(),
      usedCount: int({ required: true, default: 0 }),
      minOrderAmount: money({ required: true, default: 0 }),
      createdBy: ref("users", { required: true, fk: false }),
    },
  },
  {
    model: "Review", table: "reviews", collection: "reviews",
    indexes: [{ fields: ["userId", "productId", "parentOrderId"], unique: true }],
    fields: {
      user: ref("users", { required: true, onDelete: "CASCADE" }),
      product: ref("products", { required: true, index: true, onDelete: "CASCADE" }),
      parentOrder: ref("orders", { required: true, fk: false }),
      rating: int({ required: true }),
      reviewText: text(),
      images: json([]),
      status: en(["PENDING", "PUBLISHED", "HIDDEN"], { default: "PUBLISHED", required: true }),
      isVerifiedPurchase: bool(true),
      "vendorReply.text": text({ apiDefault: "" }),
      "vendorReply.repliedAt": date(),
    },
  },
  {
    model: "Advertisement", table: "advertisements", collection: "advertisements", publicId: "MVEC-AD",
    fields: {
      publicId: str({ len: 32, unique: true }),
      vendor: ref("vendors", { required: true, index: true, onDelete: "CASCADE" }), // Vendor profile id
      product: str({ required: true }),
      productId: { type: "ref", ref: "products", column: "productRefId" },
      placement: en(["HOMEPAGE_HERO", "CATEGORY_BANNER", "SEARCH_RESULTS", "FEATURED", "PROMOTION"], { default: "SEARCH_RESULTS", required: true }),
      budget: money({ required: true }),
      startDate: date(),
      endDate: date(),
      status: en(["PENDING", "ACTIVE", "PAUSED", "REJECTED", "COMPLETED"], { default: "PENDING", required: true, index: true }),
      impressions: int({ required: true, default: 0 }),
      clicks: int({ required: true, default: 0 }),
    },
  },
  subscription("vendor", "MVEC-SUB", "Subscription", "subscriptions", "subscriptions", false),
  subscription("buyer", "MVEC-BSUB", "BuyerSubscription", "buyer_subscriptions", "buyersubscriptions", true),
  {
    model: "Notification", table: "notifications", collection: "notifications",
    indexes: [{ fields: ["recipientId", "isRead", "createdAt"] }],
    fields: {
      recipient: ref("users", { required: true, onDelete: "CASCADE" }),
      type: en(["ORDER", "DELIVERY", "PAYMENT", "PAYOUT", "STOCK", "REVIEW", "MESSAGE", "SUBSCRIPTION", "ADMIN", "SYSTEM"], { default: "SYSTEM", required: true }),
      title: str({ required: true }),
      message: text({ apiDefault: "" }),
      reference: str({ default: "" }),
      link: str({ len: 500, default: "" }),
      channel: en(["IN_APP", "SMS", "PUSH", "EMAIL"], { default: "IN_APP", required: true }),
      isRead: bool(false),
      readAt: date(),
    },
  },
  {
    model: "Conversation", table: "conversations", collection: "conversations",
    fields: {
      participants: json([], { ref: "users", array: true }), // user ids; queried with JSON_CONTAINS
      subject: str({ default: "" }),
      lastMessage: text({ apiDefault: "" }),
      lastMessageAt: date(),
    },
  },
  {
    model: "Message", table: "messages", collection: "messages",
    indexes: [{ fields: ["conversationId", "createdAt"] }],
    fields: {
      conversation: ref("conversations", { required: true, onDelete: "CASCADE" }),
      sender: ref("users", { required: true, fk: false }),
      content: text({ required: true }),
      attachments: json([]),
      readBy: json([], { ref: "users", array: true }),
    },
  },
  {
    model: "Supplier", table: "suppliers", collection: "suppliers",
    hooks: {
      async beforeSave(row) {
        if (!row.publicId) row.publicId = `MVEC-SUP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        if (row.changed("businessName") || !row.slug) {
          const Model = row.constructor;
          const base = slugify(row.businessName);
          let candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
          for (let i = 0; i < 5 && (await Model.count({ where: { slug: candidate } })); i++) candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
          row.slug = candidate;
        }
      },
    },
    fields: {
      publicId: str({ len: 32, unique: true }),
      user: ref("users", { required: true, unique: true, onDelete: "CASCADE" }),
      businessName: str({ len: 150, required: true }),
      slug: str({ len: 190, unique: true }),
      logoUrl: str({ len: 500 }),
      description: text({ apiDefault: "" }),
      category: str({ len: 120, default: "" }),
      phone: str({ len: 30, required: true }),
      email: str({ len: 190, required: true, lowercase: true }),
      verificationStatus: en(["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"], { default: "UNVERIFIED", required: true }),
      ratingAvg: num({ required: true, default: 0 }),
      status: en(["ACTIVE", "SUSPENDED", "BLOCKED", "UNDER_REVIEW"], { default: "ACTIVE", required: true }),
      location: json(null),
    },
  },
  {
    model: "SupportCase", table: "support_cases", collection: "supportcases",
    fields: {
      ticketNumber: str({ len: 60, required: true, unique: true }),
      openedBy: ref("users", { required: true, index: true, onDelete: "CASCADE" }),
      subject: str({ required: true }),
      category: en(["ORDER", "PAYMENT", "ACCOUNT", "VENDOR_ONBOARDING", "TECHNICAL", "OTHER"], { default: "OTHER", required: true }),
      priority: en(["LOW", "MEDIUM", "HIGH", "URGENT"], { default: "MEDIUM", required: true }),
      status: en(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"], { default: "OPEN", required: true, index: true }),
      description: text({ required: true }),
      assignedTo: ref("users", { fk: false }),
    },
    children: {
      comments: {
        model: "SupportCaseComment", table: "support_case_comments", parentKey: "supportCaseId", timestamps: true,
        fields: {
          author: ref("users", { required: true, fk: false }),
          message: text({ required: true }),
          attachments: json([]),
          createdAt: date(),
          updatedAt: date(),
        },
      },
    },
  },
  {
    model: "Translation", table: "translations", collection: "translations",
    fields: {
      key: str({ len: 190, required: true, unique: true }),
      module: str({ len: 80, default: "common", index: true }),
      "translations.en": text({ required: true }),
      "translations.rw": text({ required: true }),
      "translations.fr": text({ required: true }),
      isApproved: bool(true),
    },
  },
  {
    model: "AbuseReport", table: "abuse_reports", collection: "abusereports",
    fields: {
      reportNumber: str({ len: 60, unique: true }),
      reporter: ref("users", { required: true, fk: false }),
      targetUser: ref("users", { required: true, fk: false, index: true }),
      targetStore: ref("stores", { fk: false }),
      targetRole: en(ROLES),
      relatedOrder: ref("orders", { fk: false }),
      reasonCategory: en(["FRAUDULENT_ACTIVITY", "HARASSMENT_OR_ABUSE", "NON_COMPLIANT_PRODUCT_OR_ORDER", "OTHER_POLICY_VIOLATION"], { required: true }),
      description: text({ required: true }),
      evidenceUrls: json([]),
      incidentDate: date(),
      status: en(["INVESTIGATE", "PENDING", "RESOLVED", "REJECTED"], { default: "PENDING", required: true, index: true }),
      adminNotes: text({ apiDefault: "" }),
      resolvedAt: date(),
    },
  },
  {
    model: "Dispute", table: "disputes", collection: "disputes",
    fields: {
      disputeNumber: str({ len: 60, required: true, unique: true }),
      order: ref("orders", { required: true, index: true, fk: false }),
      raisedBy: ref("users", { required: true, fk: false }),
      vendor: ref("users", { required: true, fk: false, index: true }),
      reason: en(["ITEM_NOT_RECEIVED", "DAMAGED_GOODS", "WRONG_ITEM", "INCOMPLETE_ORDER", "SLA_BREACH", "OTHER"], { required: true }),
      description: text({ required: true }),
      status: en(["OPEN", "UNDER_REVIEW", "EVIDENCE_SUBMITTED", "RESOLVED_BUYER_REFUNDED", "RESOLVED_VENDOR_RELEASED", "RESOLVED_SPLIT", "REJECTED"], { default: "OPEN", required: true, index: true }),
      disputedAmount: money({ required: true }),
      "arbitrationDecision.decision": en(["REFUND_BUYER", "RELEASE_TO_VENDOR", "SPLIT_SETTLEMENT"]),
      "arbitrationDecision.buyerRefundAmount": money({ default: 0 }),
      "arbitrationDecision.vendorReleaseAmount": money({ default: 0 }),
      "arbitrationDecision.arbitratedBy": ref("users", { fk: false }),
      "arbitrationDecision.notes": text(),
      "arbitrationDecision.decidedAt": date(),
    },
  },
  {
    model: "DisputeEvidence", table: "dispute_evidences", collection: "disputeevidences",
    fields: {
      dispute: ref("disputes", { required: true, index: true, onDelete: "CASCADE" }),
      submittedBy: ref("users", { required: true, fk: false }),
      senderRole: en(["buyer", "vendor", "super_admin"], { required: true }),
      message: text(),
      attachments: json([]), // [{ fileUrl, fileType, fileName }]
    },
  },
  {
    model: "AffiliateAccount", table: "affiliate_accounts", collection: "affiliateaccounts",
    fields: {
      affiliateUser: ref("users", { required: true, unique: true, onDelete: "CASCADE" }),
      referralCode: str({ len: 60, unique: true }),
      displayName: str({ len: 150, default: "" }),
      bio: text({ apiDefault: "" }),
      website: str({ len: 300, default: "" }),
      country: str({ len: 80, default: "Rwanda" }),
      commissionRate: num({ required: true, default: 0 }),
      paymentMethod: en(PAYMENT_METHODS, { default: "MTN_MOMO", required: true }),
      ...affiliateAccountDetails,
      "verification.status": en(["UNVERIFIED", "PENDING", "UNDER_REVIEW", "VERIFIED", "REJECTED"], { default: "UNVERIFIED", required: true }),
      "verification.submittedAt": date(),
      "verification.reviewedAt": date(),
      "verification.notes": text({ apiDefault: "" }),
      "verification.documents": json([]),
      "preferences.defaultPayoutMethod": str({ len: 40, default: "MTN_MOMO" }),
      "preferences.emailNotifications": bool(true),
      "preferences.pushNotifications": bool(true),
      "preferences.payoutAlerts": bool(true),
      "preferences.marketingEmails": bool(false),
      "preferences.language": str({ len: 40, default: "English" }),
      "preferences.themeMode": str({ len: 20 }),
    },
  },
  {
    model: "AffiliateCampaign", table: "affiliate_campaigns", collection: "affiliatecampaigns",
    fields: {
      campaignCode: str({ len: 60, required: true, unique: true }),
      name: str({ len: 150, required: true }),
      description: text({ apiDefault: "" }),
      banner: str({ len: 500, default: "" }),
      commissionRate: num({ required: true, default: 0 }),
      status: en(["ACTIVE", "PAUSED", "EXPIRED"], { default: "ACTIVE", required: true, index: true }),
      startsAt: date(),
      endsAt: date(),
      products: json([], { ref: "products", array: true }), // product ids
    },
    children: {
      members: {
        model: "AffiliateCampaignMember", table: "affiliate_campaign_members", parentKey: "campaignId", noId: true,
        fields: {
          affiliateUser: ref("users", { required: true, fk: false, index: true }),
          joinedAt: date(),
        },
      },
    },
  },
  {
    model: "AffiliateClick", table: "affiliate_clicks", collection: "affiliateclicks", timestamps: "createdAt",
    indexes: [{ fields: ["affiliateUserId", "createdAt"] }],
    fields: {
      affiliateUser: ref("users", { required: true, fk: false }),
      link: ref("affiliate_links", { fk: false, index: true }),
      affiliateCode: str({ len: 60, default: "", index: true }),
      buyerUser: ref("users", { fk: false }),
      visitorIp: str({ len: 64, default: "" }),
      product: ref("products", { fk: false, index: true }),
      // Opaque server-minted browser id: unique-visitor counts and last-click attribution.
      visitorId: str({ len: 32, default: "", index: true }),
    },
  },
  {
    model: "AffiliateLink", table: "affiliate_links", collection: "affiliatelinks",
    fields: {
      affiliateCode: str({ len: 60, required: true, unique: true }),
      affiliateUser: ref("users", { required: true, index: true, onDelete: "CASCADE" }),
      targetProduct: ref("products", { fk: false }),
      campaign: ref("affiliate_campaigns", { fk: false, index: true }),
      label: str({ default: "" }),
      lastClickedAt: date(),
      clickCount: int({ required: true, default: 0 }),
      conversionCount: int({ required: true, default: 0 }),
      isActive: bool(true),
      // Soft termination: the row, its clicks and commissions are kept.
      status: en(["ACTIVE", "TERMINATED"], { default: "ACTIVE", required: true, index: true }),
      terminatedAt: date(),
    },
  },
  {
    model: "AffiliatePayout", table: "affiliate_payouts", collection: "affiliatepayouts",
    fields: {
      payoutNumber: str({ len: 60, required: true, unique: true }),
      affiliateUser: ref("users", { required: true, index: true, onDelete: "CASCADE" }),
      amount: money({ required: true }),
      paymentMethod: en(PAYMENT_METHODS, { required: true }),
      "accountDetails.phoneNumber": str({ len: 30 }),
      "accountDetails.accountName": str({ len: 150 }),
      "accountDetails.bankName": str({ len: 120 }),
      "accountDetails.accountNumber": str({ len: 60 }),
      status: en(["PENDING", "APPROVED", "PROCESSING", "COMPLETED", "REJECTED"], { default: "PENDING", required: true, index: true }),
      approvedBy: ref("users", { fk: false }),
      transactionReference: str({ len: 120 }),
      rejectionReason: str({ len: 500 }),
    },
  },
  {
    model: "AffiliateWallet", table: "affiliate_wallets", collection: "affiliatewallets",
    fields: {
      affiliateUser: ref("users", { required: true, unique: true, onDelete: "CASCADE" }),
      pendingBalance: money({ required: true, default: 0 }),
      availableBalance: money({ required: true, default: 0 }),
      totalWithdrawn: money({ required: true, default: 0 }),
    },
  },
  {
    model: "ConversionAudit", table: "conversion_audits", collection: "conversionaudits",
    indexes: [{ fields: ["affiliateUserId", "convertedAt"] }, { fields: ["orderId", "orderItemId"], unique: true }],
    fields: {
      affiliateUser: ref("users", { required: true, fk: false }),
      link: ref("affiliate_links", { fk: false }),
      targetProduct: ref("products", { fk: false }),
      order: ref("orders", { fk: false, index: true }),
      referralCode: str({ len: 60, default: "" }),
      conversionValue: money({ required: true, default: 0 }),
      commissionEarned: money({ required: true, default: 0 }),
      // One row per attributed order item (the commission record).
      orderItemId: { type: "ref", ref: null, fk: false, column: "orderItemId" },
      settlement: ref("settlements", { fk: false }),
      buyer: ref("users", { fk: false }),
      quantity: int({ required: true, default: 1 }),
      clickedAt: date(),
      reversedAmount: money({ required: true, default: 0 }),
      unrecoveredAmount: money({ required: true, default: 0 }),
      // [{ key, amount, reason, at }]; JSON so $push is supported by the compat layer.
      reversals: json([]),
      status: en(["PENDING", "APPROVED", "PAID", "REJECTED", "REVERSED"], { default: "PENDING", required: true, index: true }),
      convertedAt: date(),
      approvedAt: date(),
    },
  },
  {
    model: "WholesaleProduct", table: "wholesale_products", collection: "wholesaleproducts",
    hooks: {
      beforeValidate(row) {
        if (row.stockQuantity <= 0 && row.status !== "ARCHIVED") row.status = "OUT_OF_STOCK";
      },
    },
    fields: {
      supplier: ref("suppliers", { required: true, index: true, fk: false }),
      name: str({ required: true }),
      shortDescription: str({ len: 500, default: "" }),
      category: str({ len: 120, default: "General" }),
      unit: str({ len: 40, default: "piece" }),
      wholesalePrice: money({ required: true }),
      retailPrice: money({ required: true, default: 0 }),
      moq: int({ required: true, default: 1 }),
      stockQuantity: int({ required: true, default: 0 }),
      bulkDiscount: num({ required: true, default: 0 }),
      "media.mainImage": str({ len: 1000, default: "" }),
      "media.gallery": json([]),
      status: en(["ACTIVE", "OUT_OF_STOCK", "ARCHIVED"], { default: "ACTIVE", required: true, index: true }),
    },
  },
  {
    model: "WholesaleOrder", table: "wholesale_orders", collection: "wholesaleorders",
    hidden: ["deliveryOtp"], // select:false in Mongoose
    fields: {
      orderNumber: str({ len: 60, required: true, unique: true }),
      vendor: ref("users", { required: true, index: true, fk: false }),
      supplier: ref("users", { required: true, index: true, fk: false }),
      totalAmount: money({ required: true }),
      status: en(["PENDING_PAYMENT", "ESCROW_HELD", "SHIPPED", "DELIVERED", "CONFIRMED_RELEASED", "DISPUTED", "CANCELLED"], { default: "PENDING_PAYMENT", required: true, index: true }),
      deliveryOtp: str({ len: 12 }),
      shippedAt: date(),
      deliveredAt: date(),
      confirmedAt: date(),
    },
    children: {
      items: {
        model: "WholesaleOrderItem", table: "wholesale_order_items", parentKey: "wholesaleOrderId",
        fields: {
          product: ref("wholesale_products", { required: true, fk: false }),
          productName: str({ required: true }),
          unitPrice: money({ required: true }),
          quantity: int({ required: true }),
          moq: int({ required: true }),
        },
      },
    },
  },
  {
    model: "AffiliateAttribution", table: "affiliate_attributions", collection: "affiliateattributions",
    // Last-click attribution: at most one row per (visitor, product).
    indexes: [{ fields: ["visitorId", "productId"], unique: true }],
    fields: {
      visitorId: str({ len: 32, required: true }),
      product: ref("products", { required: true, fk: false }),
      link: ref("affiliate_links", { required: true, fk: false }),
      affiliateUser: ref("users", { required: true, fk: false, index: true }),
      affiliateCode: str({ len: 60, required: true }),
      clickedAt: date({ required: true }),
    },
  },
  {
    model: "Disbursement", table: "disbursements", collection: "disbursements",
    fields: {
      kind: en(["REFUND", "AFFILIATE_PAYOUT"], { required: true, index: true }),
      recipient: ref("users", { required: true, fk: false }),
      phone: str({ len: 30, required: true }),
      amount: money({ required: true }),
      order: ref("orders", { fk: false, index: true }),
      affiliatePayout: ref("affiliate_payouts", { fk: false }),
      idempotencyKey: str({ len: 190, required: true, unique: true }),
      status: en(["QUEUED", "SENT", "SUCCESS", "FAILED"], { default: "QUEUED", required: true, index: true }),
      gatewayReference: str({ len: 120, index: true }),
      attempts: int({ required: true, default: 0 }),
      lastError: text({ apiDefault: "" }),
      nextAttemptAt: date(),
      completedAt: date(),
    },
  },
  {
    model: "SupplierReview", table: "supplier_reviews", collection: "supplierreviews",
    indexes: [{ fields: ["supplierId", "vendorId", "wholesaleOrderId"], unique: true }, { fields: ["supplierId", "createdAt"] }],
    fields: {
      supplier: ref("suppliers", { required: true, onDelete: "CASCADE" }),
      vendor: ref("users", { required: true, fk: false }),
      wholesaleOrder: ref("wholesale_orders", { required: true, fk: false }),
      rating: int({ required: true }),
      comment: text({ apiDefault: "" }),
      reply: text({ apiDefault: "" }),
    },
  },
  {
    model: "SupplierSupplyRequest", table: "supplier_supply_requests", collection: "suppliersupplyrequests",
    indexes: [{ fields: ["supplierId", "createdAt"] }],
    fields: {
      supplier: ref("suppliers", { required: true, onDelete: "CASCADE" }),
      reference: str({ len: 80, required: true, unique: true }),
      neededBy: date({ required: true }),
      note: text({ apiDefault: "" }),
      status: en(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "SOURCING", "IN_TRANSIT", "RECEIVED", "REJECTED", "CANCELLED"], { default: "SUBMITTED", required: true, index: true }),
      decision: text({ apiDefault: "" }),
    },
    children: {
      lines: {
        model: "SupplierSupplyRequestLine", table: "supplier_supply_request_lines", parentKey: "supplyRequestId", noId: true,
        fields: {
          product: str({ required: true }),
          category: str({ len: 120, default: "General" }),
          units: int({ required: true }),
          unit: str({ len: 60, required: true }),
          unitPrice: money({ required: true }),
          note: text({ apiDefault: "" }),
        },
      },
      events: {
        model: "SupplierSupplyRequestEvent", table: "supplier_supply_request_events", parentKey: "supplyRequestId", noId: true,
        fields: {
          at: date(),
          title: str({ required: true }),
          detail: text({ apiDefault: "" }),
        },
      },
    },
  },
  {
    model: "SupplierTeamMember", table: "supplier_team_members", collection: "supplierteammembers",
    indexes: [{ fields: ["supplierId", "createdAt"] }],
    fields: {
      supplier: ref("suppliers", { required: true, onDelete: "CASCADE" }),
      user: ref("users", { fk: false, index: true }),
      fullName: str({ len: 150, required: true }),
      phone: str({ len: 30, required: true }),
      email: str({ len: 190, default: "", lowercase: true }),
      role: en(["OPERATIONS", "WAREHOUSE", "FULFILMENT", "FINANCE", "VIEWER"], { default: "VIEWER", required: true }),
      status: en(["ACTIVE", "INVITED", "SUSPENDED"], { default: "ACTIVE", required: true }),
      note: text({ apiDefault: "" }),
    },
  },
];
