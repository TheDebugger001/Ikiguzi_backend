// Describes every Mongoose model in one normalized form for the compat layer:
//   { name, Model (Sequelize), table, fields: { apiPath: Field }, children: { name: Child }, hidden, methods }
// Field: { path, column, kind, refModel, jsonDefault, apiDefault, alias }
//   kind: id-like "ref" | "refArray" | "json" | "date" | "number" | "bool" | "string"
const { models, specs } = require("..");
const { columnName } = require("../spec/define");

const KIND = { ref: "ref", json: "json", money: "number", number: "number", int: "number", bool: "bool", date: "date", string: "string", text: "string", enum: "string" };

// ---- spec-based tables (phases 3–4) ---------------------------------------
const tableToName = {};
const fromSpecFields = (fields) => Object.fromEntries(Object.entries(fields).map(([path, f]) => [path, {
  path,
  column: columnName(path, f),
  kind: f.type === "json" && f.array && f.ref ? "refArray" : KIND[f.type],
  refTable: f.ref || null,
  jsonDefault: f.type === "json" ? f.default : undefined,
  apiDefault: f.apiDefault,
}]));

// ---- hand-written tables (phases 1–2): API path -> column -------------------
const F = (kind, column, refModel) => ({ kind, column, refModel });
const LEGACY = {
  User: {
    Model: "User",
    fields: {
      Fullname: F("string"), email: F("string"), password: F("string"), gender: F("string"), phone: F("string"),
      googleId: F("string"), email_verified: F("bool"), role: F("string"), isSellerEnabled: F("bool"), status: F("string"),
      companyName: F("string"), resetPasswordToken: F("string"), resetPasswordExpires: F("date"), isVendorStaff: F("bool"),
      lastPasswordChangeAt: F("date"),
      businessName: F("string"), description: F("string"), logoUrl: F("string"), category: F("string"), location: F("json"),
      avatarUrl: F("string"), isOnboarded: F("bool"), verificationStatus: F("string"),
      wishlist: { ...F("json"), jsonDefault: [] },
      resetPasswordCode: F("string"), resetPasswordCodeExpires: F("date"), resetPasswordAttempts: F("number"),
      isSupplierStaff: F("bool"),
    },
    hidden: ["isVendorStaff", "isSupplierStaff", "resetPasswordCode", "resetPasswordCodeExpires", "resetPasswordAttempts"],
    children: {
      addresses: {
        Model: "UserAddress", parentKey: "userId", orderBy: "createdAt",
        fields: {
          type: F("string"), country: F("string"), provinceState: F("string"), cityDistrict: F("string"), sector: F("string"), street: F("string"),
          building: F("string"), apartment: F("string"), postalCode: F("string"), phone: F("string"),
          deliveryInstructions: F("string"), isDefaultShipping: F("bool"), isDefaultBilling: F("bool"),
        },
      },
    },
  },
  Otp: {
    Model: "Otp",
    fields: { phone: F("string"), codeHash: F("string"), purpose: F("string"), email: F("string"), expiresAt: F("date"), attempts: F("number"), lastSentAt: F("date"), consumed: F("bool") },
  },
  Vendor: {
    Model: "Vendor",
    fields: {
      publicId: F("string"), user: F("ref", "userId", "User"), businessName: F("string"), slug: F("string"), logoUrl: F("string"),
      bannerUrl: F("string"), description: F("string"), category: F("string"), phone: F("string"), email: F("string"), commissionRate: F("number"),
      verificationStatus: F("string"), ratingAvg: F("number"), status: F("string"), location: F("json"),
    },
  },
  Store: {
    Model: "Store",
    fields: {
      vendor: F("ref", "vendorId", "User"), isPrimary: F("bool"), storeName: F("string"), slug: F("string"), logo: F("string"),
      banner: F("string"), description: F("string"), businessCategory: F("string"), contactEmail: F("string"), contactPhone: F("string"),
      location: F("json"), "address.street": F("string", "addressStreet"), "address.city": F("string", "addressCity"),
      "address.country": F("string", "addressCountry"), "policies.returnPolicy": F("string", "returnPolicy"),
      "policies.shippingPolicy": F("string", "shippingPolicy"), businessAddress: F("string"), businessPhone: F("string"),
      taxId: F("string"), operatingHours: { ...F("json"), jsonDefault: {} }, shippingRules: { ...F("json"), jsonDefault: [] },
      defaultShippingRuleId: F("string"), twoFactorEnabled: F("bool"), marketplaceLive: F("bool"), socialLinks: F("json"), status: F("string"),
    },
  },
  Staff: {
    Model: "Staff",
    fields: {
      store: F("ref", "storeId", "Store"), vendorOwner: F("ref", "vendorOwnerId", "User"), user: F("ref", "userId", "User"),
      role: F("string"), email: F("string"), invitationTokenHash: F("string"), invitationExpiresAt: F("date"),
      ...Object.fromEntries(["canViewDashboard", "canManageProducts", "canManageOrders", "canManagePayouts", "canManageStaff", "canViewAnalytics", "canManageSettings"]
        .map((p) => [`permissions.${p}`, F("bool", p)])),
      status: F("string"),
      // Legacy alias fields kept in sync by the Mongoose pre-save hook.
      vendor_id: { ...F("ref", "storeId", "Store"), alias: true },
      user_id: { ...F("ref", "userId", "User"), alias: true },
      permission_role: { ...F("string", "role"), alias: true },
    },
    hidden: ["invitationTokenHash", "invitationExpiresAt"],
  },
  Category: {
    Model: "Category",
    fields: { name: F("string"), slug: F("string"), parentId: F("ref", "parentId", "Category"), description: F("string"), imageUrl: F("string"), sortOrder: F("number"), active: F("bool") },
  },
  Product: {
    Model: "Product",
    fields: {
      publicId: F("string"), vendor: F("ref", "vendorId", "User"), store: F("ref", "storeId", "Store"), supplier: F("ref", "supplierId", "Supplier"),
      category: F("ref", "categoryId", "Category"), brand: F("string"), name: F("string"), slug: F("string"), sku: F("string"),
      description: F("string"), shortDescription: F("string"), price: F("number"), costPrice: F("number"), discountPrice: F("number"),
      discountType: F("string"), discountValue: F("number"), discount: F("json"), stockQuantity: F("number"), lowStockThreshold: F("number"), status: F("string"),
      "media.mainImage": F("string", "mainImage"), "media.gallery": { ...F("json", "gallery"), jsonDefault: [] },
      "media.thumbnails": { ...F("json", "thumbnails"), jsonDefault: [] }, "media.videos": { ...F("json", "videos"), jsonDefault: [] },
      ...Object.fromEntries(["color", "size", "material", "weight", "capacity", "model"].map((a) => [`attributes.${a}`, F("string", a)])),
    },
  },
  StockMovement: {
    Model: "StockMovement",
    fields: {
      vendor: F("ref", "vendorId", "User"), product: F("ref", "productId", "Product"), productName: F("string"), store: F("ref", "storeId", "Store"),
      type: F("string"), quantity: F("number"), before: F("number"), after: F("number"), fromStore: F("ref", "fromStoreId", "Store"),
      toStore: F("ref", "toStoreId", "Store"), reason: F("string"), note: F("string"), performedBy: F("ref", "performedById", "User"),
    },
  },
};

// Instance methods declared on Mongoose schemas.
const METHODS = {
  Cart: {
    calculateTotal() { this.totalAmount = (this.items || []).reduce((t, i) => t + Number(i.price) * Number(i.quantity), 0); },
  },
  AffiliateCampaign: {
    isMember(userId) { const id = String(userId); return (this.members || []).some((m) => String(m.affiliateUser?._id || m.affiliateUser) === id); },
  },
};

const normalizeLegacyFields = (fields) => Object.fromEntries(Object.entries(fields).map(([path, f]) => [path, { path, column: f.column || path, kind: f.kind, refModel: f.refModel, jsonDefault: f.jsonDefault, alias: !!f.alias }]));

const registry = {};

for (const [name, def] of Object.entries(LEGACY)) {
  const Model = models[def.Model];
  registry[name] = {
    name, Model, table: Model.tableName, timestamps: true,
    fields: normalizeLegacyFields(def.fields),
    hidden: def.hidden || [],
    children: Object.fromEntries(Object.entries(def.children || {}).map(([cname, c]) => [cname, {
      name: cname, Model: models[c.Model], parentKey: c.parentKey, orderBy: c.orderBy, noId: false, hasPosition: false,
      fields: normalizeLegacyFields(c.fields),
    }])),
    methods: METHODS[name] || {},
  };
  tableToName[Model.tableName] = name;
}

for (const spec of specs) {
  const Model = models[spec.model];
  registry[spec.model] = {
    name: spec.model, Model, table: spec.table, timestamps: spec.timestamps === undefined ? true : spec.timestamps,
    fields: fromSpecFields(spec.fields),
    hidden: spec.hidden || [],
    children: Object.fromEntries(Object.entries(spec.children || {}).map(([cname, c]) => [cname, {
      name: cname, Model: Model.children[cname], parentKey: c.parentKey, noId: !!c.noId, hasPosition: true,
      fields: fromSpecFields(c.fields),
    }])),
    methods: METHODS[spec.model] || {},
  };
  tableToName[spec.table] = spec.model;
}

// Resolve spec ref tables to Mongoose model names.
const resolveRefs = (fields) => Object.values(fields).forEach((f) => { if (f.refTable && !f.refModel) f.refModel = tableToName[f.refTable] || null; });
for (const entry of Object.values(registry)) {
  resolveRefs(entry.fields);
  Object.values(entry.children).forEach((c) => resolveRefs(c.fields));
}

// Timestamps are queryable/sortable like any field; Sequelize maintains them.
for (const entry of Object.values(registry)) {
  if (!entry.timestamps) continue;
  entry.fields.createdAt = { path: "createdAt", column: "createdAt", kind: "date", timestamp: true };
  if (entry.timestamps !== "createdAt") entry.fields.updatedAt = { path: "updatedAt", column: "updatedAt", kind: "date", timestamp: true };
}

// Extra Mongoose names registered for the same collections.
registry.vendor_team_members = registry.Staff;

module.exports = { registry };
