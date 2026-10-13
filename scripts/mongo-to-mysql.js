// Copies data from MongoDB (live) into MySQL, keeping every ObjectId as the
// MySQL primary key. Read-only on MongoDB; re-running updates existing rows.
//
// Usage: npm run db:copy-from-mongo            (all tables ported so far)
//        npm run db:copy-from-mongo -- users   (only some: any table name, e.g. users products orders order_items)
require("dotenv").config();
// One connection, so the FOREIGN_KEY_CHECKS=0 below applies to every insert.
process.env.DB_POOL_MAX = "1";
const crypto = require("crypto");
const mongoose = require("mongoose");
const { sequelize, models, specs } = require("../src/database");
const { columnName } = require("../src/database/spec/define");

const MONGO_URI = process.env.MONGO_URI;
const BATCH = 500;
const str = (v) => (v === undefined || v === null ? null : String(v));
const json = (v) => (v === undefined || v === null || v === "" ? null : v);

// Each step reads a Mongo collection and maps documents to MySQL rows.
const STEPS = {
  users: {
    collection: "users",
    model: "User",
    map: (u) => ({
      id: str(u._id), Fullname: u.Fullname || "User", email: u.email ? String(u.email).toLowerCase() : null,
      password: u.password ?? null, gender: u.gender ?? null, phone: u.phone ?? null, googleId: u.googleId ?? null,
      email_verified: !!u.email_verified, role: u.role || "buyer", isSellerEnabled: !!u.isSellerEnabled,
      status: u.status || "ACTIVE", companyName: u.companyName ?? null, resetPasswordToken: u.resetPasswordToken ?? null,
      resetPasswordExpires: u.resetPasswordExpires ?? null, isVendorStaff: !!u.isVendorStaff,
      lastPasswordChangeAt: u.lastPasswordChangeAt ?? null, createdAt: u.createdAt || new Date(), updatedAt: u.updatedAt || new Date(),
    }),
  },
  addresses: {
    collection: "users",
    model: "UserAddress",
    expand: (u) => (u.addresses || []).map((a) => ({
      id: str(a._id), userId: str(u._id), type: a.type || "HOME", country: a.country || "Rwanda",
      provinceState: a.provinceState || "", cityDistrict: a.cityDistrict || "", street: a.street || "",
      building: a.building ?? null, apartment: a.apartment ?? null, postalCode: a.postalCode ?? null,
      phone: a.phone || u.phone || "", deliveryInstructions: a.deliveryInstructions ?? null,
      isDefaultShipping: !!a.isDefaultShipping, isDefaultBilling: !!a.isDefaultBilling,
      createdAt: u.createdAt || new Date(), updatedAt: u.updatedAt || new Date(),
    })),
  },
  vendors: {
    collection: "vendors",
    model: "Vendor",
    map: (v) => ({
      id: str(v._id), publicId: v.publicId ?? null, userId: str(v.user), businessName: v.businessName,
      slug: v.slug ?? null, logoUrl: v.logoUrl ?? null, bannerUrl: v.bannerUrl ?? null, description: v.description || "",
      phone: v.phone || "", email: v.email || "", commissionRate: v.commissionRate || 0,
      verificationStatus: v.verificationStatus || "UNVERIFIED", ratingAvg: v.ratingAvg || 0, status: v.status || "ACTIVE",
      location: json(v.location), createdAt: v.createdAt || new Date(), updatedAt: v.updatedAt || new Date(),
    }),
  },
  stores: {
    collection: "stores",
    model: "Store",
    map: (s) => ({
      id: str(s._id), vendorId: str(s.vendor), isPrimary: !!s.isPrimary, storeName: s.storeName, slug: s.slug,
      logo: s.logo || "", banner: s.banner || "", description: s.description || "", businessCategory: s.businessCategory || "General",
      contactEmail: s.contactEmail || "", contactPhone: s.contactPhone || "", location: json(s.location),
      addressStreet: s.address?.street ?? null, addressCity: s.address?.city || "Kigali", addressCountry: s.address?.country || "Rwanda",
      returnPolicy: s.policies?.returnPolicy ?? null, shippingPolicy: s.policies?.shippingPolicy ?? null,
      businessAddress: s.businessAddress || "", businessPhone: s.businessPhone || "", taxId: s.taxId || "",
      operatingHours: json(s.operatingHours), shippingRules: json(s.shippingRules), defaultShippingRuleId: s.defaultShippingRuleId ?? null,
      twoFactorEnabled: !!s.twoFactorEnabled, marketplaceLive: s.marketplaceLive !== false, socialLinks: json(s.socialLinks),
      status: s.status || "PENDING", createdAt: s.createdAt || new Date(), updatedAt: s.updatedAt || new Date(),
    }),
  },
  staff: {
    collection: "staffs",
    model: "Staff",
    map: (s) => {
      const p = s.permissions || {};
      return {
        id: str(s._id), storeId: str(s.store || s.vendor_id), vendorOwnerId: str(s.vendorOwner), userId: str(s.user || s.user_id),
        role: s.role || s.permission_role || "ORDER_MANAGER",
        canViewDashboard: p.canViewDashboard !== false, canManageProducts: !!p.canManageProducts, canManageOrders: p.canManageOrders !== false,
        canManagePayouts: !!p.canManagePayouts, canManageStaff: !!p.canManageStaff, canViewAnalytics: !!p.canViewAnalytics,
        canManageSettings: !!p.canManageSettings, status: s.status || "ACTIVE",
        createdAt: s.createdAt || new Date(), updatedAt: s.updatedAt || new Date(),
      };
    },
  },
  categories: {
    collection: "categories",
    model: "Category",
    // Parents before children (self-referencing parentId foreign key).
    prepare: (docs) => {
      const byId = Object.fromEntries(docs.map((d) => [String(d._id), d]));
      const depth = (d, seen = new Set()) => (!d.parentId || seen.has(String(d._id)) || !byId[String(d.parentId)] ? 0 : 1 + depth(byId[String(d.parentId)], seen.add(String(d._id))));
      return docs.sort((a, b) => depth(a) - depth(b));
    },
    map: (c) => ({
      id: str(c._id), name: c.name, slug: c.slug, parentId: str(c.parentId), description: c.description ?? null,
      imageUrl: c.imageUrl ?? null, sortOrder: c.sortOrder || 0, active: c.active !== false,
      createdAt: c.createdAt || new Date(), updatedAt: c.updatedAt || new Date(),
    }),
  },
  products: {
    collection: "products",
    model: "Product",
    map: (p) => {
      const a = p.attributes || {};
      const m = p.media || {};
      return {
        id: str(p._id), publicId: p.publicId ?? null, vendorId: str(p.vendor), storeId: str(p.store), supplierId: str(p.supplier),
        categoryId: str(p.category), brand: p.brand ?? null, name: p.name, slug: p.slug ?? null, sku: p.sku ?? null,
        description: p.description || "", shortDescription: p.shortDescription ?? null,
        price: p.price ?? 0, costPrice: p.costPrice ?? null, discountPrice: p.discountPrice ?? null,
        discountType: p.discountType ?? null, discountValue: p.discountValue ?? null,
        stockQuantity: Math.max(0, p.stockQuantity || 0), lowStockThreshold: p.lowStockThreshold ?? 5, status: p.status || "DRAFT",
        mainImage: m.mainImage || "", gallery: m.gallery || [], thumbnails: m.thumbnails || [], videos: m.videos || [],
        color: a.color ?? null, size: a.size ?? null, material: a.material ?? null, weight: a.weight ?? null,
        capacity: a.capacity ?? null, model: a.model ?? null,
        createdAt: p.createdAt || new Date(), updatedAt: p.updatedAt || new Date(),
      };
    },
  },
  stock_movements: {
    collection: "stockmovements",
    model: "StockMovement",
    map: (m) => ({
      id: str(m._id), vendorId: str(m.vendor), productId: str(m.product), productName: m.productName || "",
      storeId: str(m.store), type: m.type, quantity: m.quantity || 0, before: m.before ?? null, after: m.after ?? null,
      fromStoreId: str(m.fromStore), toStoreId: str(m.toStore), reason: m.reason || "", note: m.note || "",
      performedById: str(m.performedBy), createdAt: m.createdAt || new Date(), updatedAt: m.updatedAt || new Date(),
    }),
  },
};

// Phase 3–4 tables: rows are derived generically from their specs.
const getPath = (obj, dotted) => dotted.split(".").reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
const specValue = (field, value) => {
  if (value === undefined || value === null) {
    if (field.type === "json") return field.default === undefined ? null : field.default;
    return field.default === undefined ? null : field.default;
  }
  switch (field.type) {
    case "ref": return String(value?._id || value);
    case "money": case "number": case "int": return Number(value) || 0;
    case "bool": return !!value;
    case "enum": return field.values.includes(value) ? value : (field.default ?? null);
    case "json": return value;
    case "date": return value instanceof Date ? value : new Date(value);
    default: return typeof value === "string" ? value : String(value);
  }
};
const rowFromSpec = (fields, doc) => Object.fromEntries(Object.entries(fields).map(([name, f]) => [columnName(name, f), specValue(f, getPath(doc, name))]));
// Stable 24-hex id for embedded sub-documents that have no _id of their own.
const derivedId = (parentId, key, position) => crypto.createHash("md5").update(`${parentId}:${key}:${position}`).digest("hex").slice(0, 24);

for (const spec of specs) {
  const step = {
    collection: spec.collection,
    model: spec.model,
    map: (doc) => ({
      id: str(doc._id),
      ...rowFromSpec(spec.fields, doc),
      ...(spec.timestamps === false ? {} : { createdAt: doc.createdAt || new Date(), ...(spec.timestamps === "createdAt" ? {} : { updatedAt: doc.updatedAt || new Date() }) }),
    }),
  };
  STEPS[spec.table] = step;
  // Embedded arrays -> child tables (rebuilt per parent so re-runs stay exact).
  for (const [key, child] of Object.entries(spec.children || {})) {
    STEPS[child.table] = {
      collection: spec.collection,
      model: child.model,
      replaceChildrenOf: child.parentKey,
      expand: (doc) => (Array.isArray(doc[key]) ? doc[key] : []).map((sub, position) => ({
        id: sub && sub._id ? str(sub._id) : derivedId(str(doc._id), key, position),
        [child.parentKey]: str(doc._id),
        position,
        ...rowFromSpec(child.fields, sub && typeof sub === "object" ? sub : {}),
      })),
    };
  }
}

// Staff was also registered as `vendor_team_members`; copy that collection too.
STEPS.staff_legacy = { ...STEPS.staff, collection: "vendor_team_members" };

async function copyStep(name, step) {
  const Model = models[step.model];
  const cursor = mongoose.connection.db.collection(step.collection).find({});
  const fields = Object.keys(Model.getAttributes()).filter((f) => f !== "id");
  let batch = [];
  let copied = 0;
  let skipped = 0;
  const flush = async () => {
    if (!batch.length) return;
    if (step.replaceChildrenOf) {
      const parents = [...new Set(batch.map((r) => r[step.replaceChildrenOf]))];
      await Model.destroy({ where: { [step.replaceChildrenOf]: parents } });
    }
    try {
      await Model.bulkCreate(batch, { updateOnDuplicate: fields, validate: false });
      // bulkCreate never updates createdAt on existing rows; keep MongoDB's exact value.
      const stamped = batch.filter((r) => r.createdAt);
      if (stamped.length && Model.rawAttributes.createdAt) {
        const cases = stamped.map((r) => `WHEN ${sequelize.escape(r.id)} THEN ${sequelize.escape(new Date(r.createdAt).toISOString().replace("T", " ").replace("Z", ""))}`).join(" ");
        await sequelize.query(`UPDATE \`${Model.tableName}\` SET createdAt = CASE id ${cases} END WHERE id IN (${stamped.map((r) => sequelize.escape(r.id)).join(",")})`);
      }
      copied += batch.length;
    } catch (err) {
      // Fall back to row by row so one bad document doesn't stop the copy.
      for (const row of batch) {
        try { await Model.bulkCreate([row], { updateOnDuplicate: fields, validate: false }); copied += 1; }
        catch (e) { skipped += 1; console.warn(`  ! ${name} ${row.id}: ${e.parent?.sqlMessage || e.message}`); }
      }
    }
    batch = [];
  };
  const docs = step.prepare ? step.prepare(await cursor.toArray()) : cursor;
  for await (const doc of docs) {
    const rows = step.expand ? step.expand(doc) : [step.map(doc)];
    batch.push(...rows.filter((r) => r && r.id));
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  console.log(`✓ ${name}: ${copied} copied${skipped ? `, ${skipped} skipped` : ""}`);
}

(async () => {
  const wanted = process.argv.slice(2);
  const specTables = specs.flatMap((sp) => [sp.table, ...Object.values(sp.children || {}).map((c) => c.table)]);
  const order = ["users", "addresses", "vendors", "stores", "staff", "staff_legacy", "categories", "products", "stock_movements", ...specTables]; // parents before children
  const names = wanted.length ? order.filter((n) => wanted.includes(n)) : order;
  if (!MONGO_URI) throw new Error("MONGO_URI is not set.");

  await mongoose.connect(MONGO_URI);
  await sequelize.authenticate();
  await sequelize.query("SET FOREIGN_KEY_CHECKS = 0"); // MongoDB never enforced references
  console.log(`MongoDB ${mongoose.connection.db.databaseName} → MySQL ${sequelize.config.database}`);
  for (const name of names) await copyStep(name, STEPS[name]);
  await sequelize.query("SET FOREIGN_KEY_CHECKS = 1");
  await mongoose.disconnect();
  await sequelize.close();
})().catch(async (err) => {
  console.error("Copy failed:", err.parent?.sqlMessage || err.message);
  await mongoose.disconnect().catch(() => {});
  await sequelize.close().catch(() => {});
  process.exit(1);
});
