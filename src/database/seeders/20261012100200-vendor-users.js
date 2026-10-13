"use strict";
const bcrypt = require("bcryptjs");
const assertSeedingAllowed = require("../seedGuard");

// Demo sellers: vendor user + vendor profile + primary store, and one staff
// account on the first store. Password: SEED_VENDOR_PASSWORD (default below).
// Fixed ids keep the seeder idempotent and let `db:seed:undo` remove exactly these rows.
const VENDORS = [
  { n: 1, name: "Aline Uwase", email: "vendor.kigalitech@mvec.test", phone: "0788000101", company: "Kigali Tech Store", category: "Electronics", city: "Kigali", street: "KN 4 Ave, Nyarugenge", description: "Phones, laptops and accessories with local warranty." },
  { n: 2, name: "Jean Paul Habimana", email: "vendor.urbancloset@mvec.test", phone: "0788000102", company: "Urban Closet", category: "Fashion", city: "Musanze", street: "Main road, Muhoza", description: "Everyday fashion, shoes and bags." },
  { n: 3, name: "Claudine Mukamana", email: "vendor.homestyle@mvec.test", phone: "0788000103", company: "HomeStyle Kigali", category: "Home & Kitchen", city: "Kigali", street: "KG 11 Ave, Remera", description: "Kitchenware, decor and home essentials." },
];
const id = (prefix, n) => `6a00000000000000${prefix}${String(n).padStart(6, "0")}`; // 24 hex chars
const STAFF_USER_ID = id("05", 1);
const STAFF_ID = id("06", 1);

module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed();
    const password = await bcrypt.hash(process.env.SEED_VENDOR_PASSWORD || "Vendor@12345", 10);
    const now = new Date();
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    const users = VENDORS.map((v) => ({
      id: id("01", v.n), Fullname: v.name, email: v.email, password, gender: "other", phone: v.phone,
      role: "vendor", companyName: v.company, status: "ACTIVE", email_verified: true,
      isSellerEnabled: false, isVendorStaff: false, createdAt: now, updatedAt: now,
    }));
    users.push({
      id: STAFF_USER_ID, Fullname: "Eric Manzi", email: "staff.kigalitech@mvec.test", password, gender: "male", phone: "0788000111",
      role: "vendor", companyName: VENDORS[0].company, status: "ACTIVE", email_verified: true,
      isSellerEnabled: false, isVendorStaff: true, createdAt: now, updatedAt: now,
    });
    await queryInterface.bulkInsert("users", users, { updateOnDuplicate: ["Fullname", "password", "companyName", "status", "updatedAt"] });

    await queryInterface.bulkInsert("vendors", VENDORS.map((v) => ({
      id: id("02", v.n), publicId: `MVEC-VND-SEED${v.n}`, userId: id("01", v.n), businessName: v.company,
      slug: `${slug(v.company)}-seed${v.n}`, description: v.description, phone: v.phone, email: v.email,
      commissionRate: 0, verificationStatus: "VERIFIED", ratingAvg: 4.5, status: "ACTIVE",
      location: JSON.stringify(v.city), createdAt: now, updatedAt: now,
    })), { updateOnDuplicate: ["businessName", "description", "verificationStatus", "status", "updatedAt"] });

    await queryInterface.bulkInsert("stores", VENDORS.map((v) => ({
      id: id("03", v.n), vendorId: id("01", v.n), isPrimary: true, storeName: v.company, slug: slug(v.company),
      description: v.description, businessCategory: v.category, contactEmail: v.email, contactPhone: v.phone,
      location: JSON.stringify(v.city), addressStreet: v.street, addressCity: v.city, addressCountry: "Rwanda",
      businessAddress: v.street, shippingRules: JSON.stringify([]), operatingHours: JSON.stringify({}),
      status: "ACTIVE", createdAt: now, updatedAt: now,
    })), { updateOnDuplicate: ["description", "businessCategory", "status", "updatedAt"] });

    await queryInterface.bulkInsert("staff", [{
      id: STAFF_ID, storeId: id("03", 1), vendorOwnerId: id("01", 1), userId: STAFF_USER_ID, role: "STORE_MANAGER",
      canViewDashboard: true, canManageProducts: true, canManageOrders: true, canManagePayouts: false,
      canManageStaff: false, canViewAnalytics: true, canManageSettings: false, status: "ACTIVE",
      createdAt: now, updatedAt: now,
    }], { updateOnDuplicate: ["role", "status", "updatedAt"] });
  },

  async down(queryInterface) {
    const { Op } = require("sequelize");
    await queryInterface.bulkDelete("staff", { id: STAFF_ID });
    await queryInterface.bulkDelete("stores", { id: { [Op.in]: VENDORS.map((v) => id("03", v.n)) } });
    await queryInterface.bulkDelete("vendors", { id: { [Op.in]: VENDORS.map((v) => id("02", v.n)) } });
    await queryInterface.bulkDelete("users", { id: { [Op.in]: [...VENDORS.map((v) => id("01", v.n)), STAFF_USER_ID] } });
  },
};
