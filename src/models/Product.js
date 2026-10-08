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
    discountPrice: { type: Number, default: null }, // closest to compare_at_price_rwf

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

module.exports = mongoose.model("Product", productSchema);
