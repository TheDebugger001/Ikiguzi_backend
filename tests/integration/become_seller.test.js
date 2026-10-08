const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const express = require("express");
const User = require("../../src/models/User");
const Vendor = require("../../src/models/Vendor");
const Store = require("../../src/models/Store");

jest.setTimeout(60000);

describe("POST /api/vendors/become-seller", () => {
  let mongo;
  let app;
  let admin;
  let buyer;
  let adminToken;
  let buyerToken;
  const secret = "become_seller_test_secret";

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    mongo = await MongoMemoryServer.create({ binary: { version: "7.0.0" } });
    await mongoose.connect(mongo.getUri());
    app = express();
    app.use(express.json());
    app.use("/api/vendors", require("../../src/routes/vendor.routes"));
    app.get("/vendor-only", require("../../src/middleware/auth.middleware").protect,
      require("../../src/middleware/auth.middleware").authorize("vendor"), (_req, res) => res.sendStatus(204));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Vendor.deleteMany({}), Store.deleteMany({})]);
    admin = await User.create({
      Fullname: "Store Admin", email: "admin@example.com", password: "password123",
      phone: "0788000001", gender: "male", role: "super_admin",
    });
    buyer = await User.create({
      Fullname: "Buyer Account", email: "buyer@example.com", password: "password123",
      phone: "0788000002", gender: "female", role: "buyer",
    });
    adminToken = jwt.sign({ userId: admin._id }, secret);
    buyerToken = jwt.sign({ userId: buyer._id }, secret);
  });

  test("creates the vendor and store, preserves admin role, and enables vendor routes", async () => {
    const response = await request(app)
      .post("/api/vendors/become-seller")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ businessName: "Admin Market", phone: "0788123456", email: "STORE@example.com", description: "Local goods" });

    expect(response.status).toBe(201);
    expect(response.body.isSellerEnabled).toBe(true);
    expect(response.body.vendor.businessName).toBe("Admin Market");
    expect(response.body.store.contactEmail).toBe("store@example.com");

    const savedAdmin = await User.findById(admin._id);
    expect(savedAdmin.role).toBe("super_admin");
    expect(savedAdmin.isSellerEnabled).toBe(true);
    expect(await Vendor.countDocuments({ user: admin._id })).toBe(1);
    expect(await Store.countDocuments({ vendor: admin._id })).toBe(1);

    const vendorRoute = await request(app).get("/vendor-only").set("Authorization", `Bearer ${adminToken}`);
    expect(vendorRoute.status).toBe(204);
  });

  test("rejects non-admins and invalid required fields", async () => {
    const forbidden = await request(app).post("/api/vendors/become-seller")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ businessName: "Buyer Store", phone: "0788123456", email: "buyer-store@example.com" });
    expect(forbidden.status).toBe(403);

    const invalid = await request(app).post("/api/vendors/become-seller")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ businessName: "Missing details" });
    expect(invalid.status).toBe(400);
  });
});
