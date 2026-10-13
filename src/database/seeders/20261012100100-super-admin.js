"use strict";
const bcrypt = require("bcryptjs");

// MySQL counterpart of seedAdmin.js: keeps exactly one super_admin.
// Updates the existing super_admin (e.g. copied from MongoDB) with
// ADMIN_EMAIL / ADMIN_PASSWORD, or creates one when there is none.
const ADMIN_ID = "6a0000000000000000000001";

module.exports = {
  async up(queryInterface) {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before seeding the admin.");

    const now = new Date();
    const fields = {
      Fullname: "Admin",
      email: email.trim().toLowerCase(),
      password: await bcrypt.hash(password, 10),
      role: "super_admin",
      status: "ACTIVE",
      email_verified: true,
      updatedAt: now,
    };
    const [existing] = await queryInterface.sequelize.query(
      "SELECT id FROM users WHERE role = 'super_admin' ORDER BY createdAt ASC LIMIT 1",
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    ).then((rows) => [rows[0]]);

    if (existing) {
      await queryInterface.bulkUpdate("users", fields, { id: existing.id });
      return;
    }
    await queryInterface.bulkInsert("users", [{
      id: ADMIN_ID,
      ...fields,
      gender: "male",
      phone: "0788888880",
      isSellerEnabled: false,
      isVendorStaff: false,
      createdAt: now,
    }]);
  },

  // Only removes an admin this seeder created; a copied admin is kept.
  async down(queryInterface) {
    await queryInterface.bulkDelete("users", { id: ADMIN_ID });
  },
};
