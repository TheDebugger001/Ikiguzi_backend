"use strict";
const bcrypt = require("bcryptjs");
const assertSeedingAllowed = require("../seedGuard");

// One demo buyer with a default address, for testing checkout against the seeded vendors.
const BUYER_ID = "6a0000000000000004000001";
const ADDRESS_ID = "6a0000000000000004000101";

module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed();
    const now = new Date();
    await queryInterface.bulkInsert("users", [{
      id: BUYER_ID, Fullname: "Diane Uwimana", email: "buyer@mvec.test",
      password: await bcrypt.hash(process.env.SEED_BUYER_PASSWORD || "Buyer@12345", 10),
      gender: "female", phone: "0788000201", role: "buyer", status: "ACTIVE", email_verified: true,
      isSellerEnabled: false, isVendorStaff: false, createdAt: now, updatedAt: now,
    }], { updateOnDuplicate: ["Fullname", "password", "updatedAt"] });
    await queryInterface.bulkInsert("user_addresses", [{
      id: ADDRESS_ID, userId: BUYER_ID, type: "HOME", country: "Rwanda", provinceState: "Kigali City",
      cityDistrict: "Kicukiro", street: "KK 15 Rd, Niboye", phone: "0788000201",
      isDefaultShipping: true, isDefaultBilling: true, createdAt: now, updatedAt: now,
    }], { updateOnDuplicate: ["street", "updatedAt"] });
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete("user_addresses", { id: ADDRESS_ID });
    await queryInterface.bulkDelete("users", { id: BUYER_ID });
  },
};
