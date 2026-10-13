// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("Product");
  return;
}

const mongoose = require("mongoose");
const crypto = require("crypto");

const slugify = (str) =>
  str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const productSchema = new mongoose.Schema(
  {
    // ─── Public-facing identifier (doc: never expose raw DB _id as the only ID) ───
    publicId: { type: String, unique: true, index: true },

    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Store the product is listed under. null = the vendor's primary store
    // (products created before multi-store support have no store set).
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", default: null, index: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null }, // nullable - not every product is sourced from a supplier
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true, index: true },

    brand: { type: String, index: true }, // not required per doc - not every product has a brand
    name: { type: String, required: true },
    slug: { type: String, unique: true }, // auto-generated
    sku: { type: String, unique: true, sparse: true }, // auto-generated if not provided

    description: { type: String, required: true },
    shortDescription: String, // not in doc - optional, safe to omit

    price: { type: Number, required: true, index: true }, // price_rwf
    costPrice: { type: Number, default: null }, // cost_price_rwf - optional, vendor's own margin tracking
    discountPrice: { type: Number, default: null }, // final sale price; derived from the two fields below when set
    // How the seller expressed the discount: a percentage or a fixed RWF amount off `price`.
    discountType: { type: String, enum: ["PERCENT", "FIXED", null], default: null },
    discountValue: { type: Number, default: null },

    // Flexible discount config: either a fixed RWF amount or a percentage.
    discount: {
      type: { type: String, enum: ["fixed", "percent", null], default: null },
      value: { type: Number, default: null, min: 0 },
    },

    stockQuantity: { type: Number, required: true, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 5 }, // sensible default so it's never undefined

    status: {
      type: String,
      enum: ["DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE", "OUT_OF_STOCK"],
      default: "DRAFT",
    },

    // ─── Media (kept embedded, per your call — simplest for CRUD, no join needed) ───
    media: {
      mainImage: { type: String, required: true },
      gallery: { type: [String], default: [] },
      thumbnails: { type: [String], default: [] },
      videos: { type: [String], default: [] },
    },

    // ─── Dynamic attributes — not in doc as a fixed shape, kept optional/flexible ───
    attributes: {
      color: String,
      size: String,
      material: String,
      weight: String,
      capacity: String,
      model: String,
    },
  },
  { timestamps: true }
);

// ─── INDEXES ──────────────────────────────────────────────────────────────
productSchema.index({ name: "text", description: "text", sku: "text", brand: "text" });
productSchema.index({ "attributes.$**": 1 });
productSchema.index({ vendor: 1, status: 1 });
productSchema.index({ category: 1, status: 1 });

// ─── PRE-VALIDATE: derive discountPrice from discountType/discountValue ─────
// Cart, checkout and storefront all read discountPrice, so it stays the single
// source of truth for the sale price.
productSchema.pre("validate", function () {
  if (this.discountType === "") this.discountType = null;
  const touched = ["price", "discountType", "discountValue", "discountPrice"].some((f) => this.isModified(f));
  if (!this.isNew && !touched) return;

  const price = Number(this.price);
  if (this.discountType) {
    const value = Number(this.discountValue);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("Enter a discount greater than 0.");
    }
    if (this.discountType === "PERCENT" && value >= 100) {
      throw new Error("A percentage discount must be less than 100%.");
    }
    if (this.discountType === "FIXED" && value >= price) {
      throw new Error("The discount amount must be less than the selling price.");
    }
    const off = this.discountType === "PERCENT" ? (price * value) / 100 : value;
    this.discountValue = value;
    this.discountPrice = Math.max(1, Math.round(price - off));
    return;
  }

  this.discountValue = null;
  // Legacy clients send a final discountPrice directly.
  if (this.discountPrice !== null && this.discountPrice !== undefined && this.discountPrice !== "") {
    if (!(Number(this.discountPrice) > 0 && Number(this.discountPrice) < price)) {
      throw new Error("The discounted price must be lower than the selling price.");
    }
  } else {
    this.discountPrice = null;
  }
});

// ─── PRE-SAVE: auto publicId + slug + sku + stock/status sync ──────────────
productSchema.pre("save", async function () {
  const Product = mongoose.model("Product");

  // 1. Auto-generate publicId once, never changes after
  if (!this.publicId) {
    this.publicId = `MVEC-PRD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  }

  // 2. Auto-generate slug from name, retry on rare collision
  if (this.isModified("name") || !this.slug) {
    const base = slugify(this.name);
    let candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;

    let attempts = 0;
    while (attempts < 5) {
      const exists = await Product.findOne({ slug: candidate, _id: { $ne: this._id } });
      if (!exists) break;
      candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
      attempts++;
    }
    this.slug = candidate;
  }

  // 3. Auto-generate SKU if not provided
  if (!this.sku) {
    this.sku = `SKU-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  }

  // 4. Keep status in sync with stock quantity
  if (this.isModified("stockQuantity")) {
    if (this.stockQuantity <= 0) {
      this.stockQuantity = 0;
      this.status = "OUT_OF_STOCK";
    } else if (this.status === "OUT_OF_STOCK" && this.stockQuantity > 0) {
      this.status = "ACTIVE";
    }
  }
});

// Expose `id` alongside `_id`; the dashboards address products by `id`.
productSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("Product", productSchema);
