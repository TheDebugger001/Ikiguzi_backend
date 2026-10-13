const crypto = require("crypto");
const { DataTypes, primaryKey, foreignKey, withIds } = require("./_shared");

const slugify = (str) => String(str).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const num = (v) => (v === null || v === undefined ? null : Number(v));
const ATTRIBUTES = ["color", "size", "material", "weight", "capacity", "model"];

module.exports = (sequelize) => {
  const Product = sequelize.define("Product", {
    id: primaryKey(),
    publicId: { type: DataTypes.STRING(32), allowNull: true, unique: true },
    vendorId: foreignKey(false),
    storeId: foreignKey(true), // null = vendor's primary store
    supplierId: foreignKey(true),
    categoryId: foreignKey(false),
    brand: { type: DataTypes.STRING(120), allowNull: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    slug: { type: DataTypes.STRING(300), allowNull: true, unique: true },
    sku: { type: DataTypes.STRING(64), allowNull: true, unique: true },
    description: { type: DataTypes.TEXT, allowNull: false },
    shortDescription: { type: DataTypes.STRING(300), allowNull: true },
    price: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    costPrice: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    discountPrice: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    discountType: { type: DataTypes.ENUM("PERCENT", "FIXED"), allowNull: true },
    discountValue: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    discount: { type: DataTypes.JSON, allowNull: true }, // { type: "fixed"|"percent", value } flexible config
    stockQuantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    lowStockThreshold: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
    status: { type: DataTypes.ENUM("DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE", "OUT_OF_STOCK"), allowNull: false, defaultValue: "DRAFT" },
    // `media` sub-document
    mainImage: { type: DataTypes.STRING(1000), allowNull: false },
    gallery: { type: DataTypes.JSON, allowNull: true },
    thumbnails: { type: DataTypes.JSON, allowNull: true },
    videos: { type: DataTypes.JSON, allowNull: true },
    // `attributes` sub-document
    color: { type: DataTypes.STRING(80), allowNull: true },
    size: { type: DataTypes.STRING(80), allowNull: true },
    material: { type: DataTypes.STRING(120), allowNull: true },
    weight: { type: DataTypes.STRING(80), allowNull: true },
    capacity: { type: DataTypes.STRING(80), allowNull: true },
    model: { type: DataTypes.STRING(120), allowNull: true },
  }, {
    tableName: "products",
    timestamps: true,
    hooks: {
      // Mirrors the Mongoose pre("validate"): discountPrice derived from type/value.
      beforeValidate(p) {
        if (p.discountType === "") p.discountType = null;
        const touched = ["price", "discountType", "discountValue", "discountPrice"].some((f) => p.changed(f));
        if (!p.isNewRecord && !touched) return;
        const price = Number(p.price);
        if (p.discountType) {
          const value = Number(p.discountValue);
          if (!Number.isFinite(value) || value <= 0) throw new Error("Enter a discount greater than 0.");
          if (p.discountType === "PERCENT" && value >= 100) throw new Error("A percentage discount must be less than 100%.");
          if (p.discountType === "FIXED" && value >= price) throw new Error("The discount amount must be less than the selling price.");
          const off = p.discountType === "PERCENT" ? (price * value) / 100 : value;
          p.discountValue = value;
          p.discountPrice = Math.max(1, Math.round(price - off));
          return;
        }
        p.discountValue = null;
        if (p.discountPrice !== null && p.discountPrice !== undefined && p.discountPrice !== "") {
          if (!(Number(p.discountPrice) > 0 && Number(p.discountPrice) < price)) throw new Error("The discounted price must be lower than the selling price.");
        } else {
          p.discountPrice = null;
        }
      },
      // Mirrors the Mongoose pre("save"): publicId, slug, sku, stock/status sync.
      async beforeSave(p) {
        if (!p.publicId) p.publicId = `MVEC-PRD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        if (p.changed("name") || !p.slug) {
          const base = slugify(p.name);
          let candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
          for (let i = 0; i < 5 && (await Product.count({ where: { slug: candidate } })); i++) {
            candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
          }
          p.slug = candidate;
        }
        if (!p.sku) p.sku = `SKU-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        if (p.changed("stockQuantity")) {
          if (p.stockQuantity <= 0) { p.stockQuantity = 0; p.status = "OUT_OF_STOCK"; }
          else if (p.status === "OUT_OF_STOCK") p.status = "ACTIVE";
        }
      },
    },
  });

  Product.associate = (m) => {
    Product.belongsTo(m.User, { as: "vendor", foreignKey: "vendorId" });
    Product.belongsTo(m.Store, { as: "store", foreignKey: "storeId" });
    Product.belongsTo(m.Category, { as: "category", foreignKey: "categoryId" });
  };

  // Mongo shape: vendor/store/category refs (or populated), nested media + attributes.
  Product.prototype.toApi = function () {
    const plain = withIds(this);
    const { vendorId, storeId, supplierId, categoryId, vendor, store, category, mainImage, gallery, thumbnails, videos, ...rest } = plain;
    const attributes = Object.fromEntries(ATTRIBUTES.filter((a) => rest[a] !== null && rest[a] !== undefined).map((a) => [a, rest[a]]));
    ATTRIBUTES.forEach((a) => delete rest[a]);
    return {
      ...rest,
      price: num(rest.price), costPrice: num(rest.costPrice), discountPrice: num(rest.discountPrice), discountValue: num(rest.discountValue),
      vendor: vendor ? this.vendor.toApi() : vendorId,
      store: store ? this.store.toApi() : storeId,
      supplier: supplierId,
      category: category ? this.category.toApi() : categoryId,
      media: { mainImage, gallery: gallery || [], thumbnails: thumbnails || [], videos: videos || [] },
      attributes,
    };
  };
  Product.ATTRIBUTES = ATTRIBUTES;
  return Product;
};
