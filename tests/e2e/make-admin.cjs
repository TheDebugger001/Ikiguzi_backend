// Creates the e2e super admin through the app's own User model (Mongoose or MySQL compat).
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { isMysql } = require("../../src/database/driver");
const User = require("../../src/models/User");

(async () => {
  if (!isMysql) await mongoose.connect(process.env.MONGO_URI);
  await User.create({
    Fullname: "E2E Admin", email: process.env.E2E_ADMIN_EMAIL, password: await bcrypt.hash(process.env.E2E_ADMIN_PASSWORD, 10),
    gender: "other", phone: "0788300099", role: "super_admin",
  });
  if (!isMysql) await mongoose.disconnect();
  else await require("../../src/database").sequelize.close();
})().catch((e) => { console.error("make-admin failed:", e.message); process.exit(1); });
