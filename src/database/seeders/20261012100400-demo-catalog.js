"use strict";
const assertSeedingAllowed = require("../seedGuard");

// Demo categories (with subcategories) and products for the seeded vendors
// (see 20261012100200-vendor-users.js). Fixed ids keep it idempotent and undoable.
const id = (prefix, n) => `6a00000000000000${prefix}${String(n).padStart(6, "0")}`;
const vendorUser = (n) => id("01", n);
const vendorStore = (n) => id("03", n);

const CATEGORIES = [
  { n: 1, name: "Electronics", slug: "electronics", sort: 1 },
  { n: 2, name: "Phones", slug: "electronics-phones", parent: 1 },
  { n: 3, name: "Accessories", slug: "electronics-accessories", parent: 1 },
  { n: 4, name: "Fashion", slug: "fashion", sort: 2 },
  { n: 5, name: "Shoes", slug: "fashion-shoes", parent: 4 },
  { n: 6, name: "Bags", slug: "fashion-bags", parent: 4 },
  { n: 7, name: "Home & Kitchen", slug: "home-kitchen", sort: 3 },
  { n: 8, name: "Cookware", slug: "home-kitchen-cookware", parent: 7 },
];

// vendor n, category n, price, stock, optional discount
const PRODUCTS = [
  { n: 1, v: 1, c: 2, name: "Samsung Galaxy A55 128GB", brand: "Samsung", price: 420000, stock: 12, color: "Navy", capacity: "128GB" },
  { n: 2, v: 1, c: 2, name: "Tecno Spark 20 Pro", brand: "Tecno", price: 210000, stock: 3, discount: ["PERCENT", 10], capacity: "256GB" },
  { n: 3, v: 1, c: 3, name: "Wireless Earbuds Pro", brand: "Oraimo", price: 35000, stock: 40, discount: ["FIXED", 5000], color: "White" },
  { n: 4, v: 1, c: 3, name: "65W USB-C Fast Charger", brand: "Anker", price: 28000, stock: 0 },
  { n: 5, v: 2, c: 5, name: "Classic Leather Sneakers", brand: "Urban", price: 45000, stock: 18, size: "42", material: "Leather", color: "White" },
  { n: 6, v: 2, c: 5, name: "Kitenge Canvas Shoes", brand: "Urban", price: 25000, stock: 4, discount: ["PERCENT", 15], size: "40" },
  { n: 7, v: 2, c: 6, name: "Everyday Leather Tote Bag", brand: "Urban", price: 38000, stock: 9, material: "Leather", color: "Brown" },
  { n: 8, v: 3, c: 8, name: "Non-stick Cookware Set (5 pcs)", brand: "HomeStyle", price: 65000, stock: 7, material: "Aluminium" },
  { n: 9, v: 3, c: 8, name: "Stainless Steel Pressure Cooker 6L", brand: "Prestige", price: 52000, stock: 2, capacity: "6L" },
  { n: 10, v: 3, c: 7, name: "Ceramic Dinner Set (16 pcs)", brand: "HomeStyle", price: 48000, stock: 15, discount: ["FIXED", 8000] },
];

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed();
    const now = new Date();

    // Parents first, then subcategories.
    const cats = [...CATEGORIES].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0)).map((c) => ({
      id: id("07", c.n), name: c.name, slug: c.slug, parentId: c.parent ? id("07", c.parent) : null,
      description: null, imageUrl: null, sortOrder: c.sort || 0, active: true, createdAt: now, updatedAt: now,
    }));
    await queryInterface.bulkInsert("categories", cats, { updateOnDuplicate: ["name", "parentId", "sortOrder", "active", "updatedAt"] });

    await queryInterface.bulkInsert("products", PRODUCTS.map((p) => {
      const [discountType, discountValue] = p.discount || [null, null];
      const discountPrice = discountType ? Math.round(p.price - (discountType === "PERCENT" ? (p.price * discountValue) / 100 : discountValue)) : null;
      const slug = slugify(p.name);
      return {
        id: id("08", p.n), publicId: `MVEC-PRD-SEED${String(p.n).padStart(2, "0")}`, vendorId: vendorUser(p.v), storeId: vendorStore(p.v),
        categoryId: id("07", p.c), brand: p.brand, name: p.name, slug: `${slug}-seed${p.n}`, sku: `SEED-${String(p.n).padStart(3, "0")}`,
        description: `${p.name}. Demo product seeded for local development.`, shortDescription: p.name,
        price: p.price, costPrice: Math.round(p.price * 0.7), discountType, discountValue, discountPrice,
        stockQuantity: p.stock, lowStockThreshold: 5, status: p.stock > 0 ? "ACTIVE" : "OUT_OF_STOCK",
        mainImage: `https://picsum.photos/seed/${slug}/600/600`, gallery: JSON.stringify([`https://picsum.photos/seed/${slug}/600/600`]),
        thumbnails: JSON.stringify([]), videos: JSON.stringify([]),
        color: p.color || null, size: p.size || null, material: p.material || null, weight: null, capacity: p.capacity || null, model: null,
        createdAt: now, updatedAt: now,
      };
    }), { updateOnDuplicate: ["name", "price", "discountType", "discountValue", "discountPrice", "stockQuantity", "status", "updatedAt"] });
  },

  async down(queryInterface) {
    const { Op } = require("sequelize");
    await queryInterface.bulkDelete("products", { id: { [Op.in]: PRODUCTS.map((p) => id("08", p.n)) } });
    // Subcategories before parents.
    await queryInterface.bulkDelete("categories", { id: { [Op.in]: CATEGORIES.filter((c) => c.parent).map((c) => id("07", c.n)) } });
    await queryInterface.bulkDelete("categories", { id: { [Op.in]: CATEGORIES.filter((c) => !c.parent).map((c) => id("07", c.n)) } });
  },
};
