// Vendor module persistence on MySQL. Throwaway DB only (name must end in _test):
//   DB_DRIVER=mysql DB_PORT=3307 DB_DATABASE=mvec_ikiguzi_test node --test tests/integration/vendor.mysql.test.js
const assert = require("node:assert/strict");
const { after, describe, test } = require("node:test");
process.env.NODE_ENV = "development";
const { isMysql } = require("../../src/database/driver");
const skip = !isMysql || !/_test$/.test(String(process.env.DB_DATABASE || ""));

describe("vendor module on MySQL", { skip: skip && "needs DB_DRIVER=mysql and a *_test database" }, () => {
  const run = Date.now().toString();
  const { sequelize } = skip ? {} : require("../../src/database");
  after(async () => { if (sequelize) await sequelize.close(); });

  test("vendor, store, staff invitation, product and stock persist and read back", async () => {
    const User = require("../../src/models/User");
    const Vendor = require("../../src/models/Vendor");
    const Store = require("../../src/models/Store");
    const Staff = require("../../src/models/Staff");
    const Category = require("../../src/models/Category");
    const Product = require("../../src/models/Product");

    const owner = await User.create({
      Fullname: "Owner V", email: `v.${run}@t.rw`, password: "password123", gender: "female",
      phone: `0788${run.slice(-6)}`, role: "vendor", companyName: `Shop ${run}`,
    });
    // Role-dependent defaults match the Mongoose schema.
    assert.equal(owner.isOnboarded, false);
    assert.equal(owner.verificationStatus, "UNVERIFIED");

    const vendor = await Vendor.create({
      user: owner._id, businessName: `Shop ${run}`, description: "d", phone: "0788000111",
      email: `shop.${run}@t.rw`, category: "Electronics", location: { city: "Kigali" },
    });
    assert.match(vendor.publicId, /^MVEC-VND-/);
    assert.equal((await Vendor.findOne({ user: owner._id })).category, "Electronics");
    await Vendor.updateOne({ _id: vendor._id }, { $set: { verificationStatus: "VERIFIED" } });
    await User.updateOne({ _id: owner._id }, { $set: { isOnboarded: true, verificationStatus: "VERIFIED", category: "Electronics" } });
    const reread = await User.findById(owner._id);
    assert.equal(reread.isOnboarded, true);
    assert.equal(reread.category, "Electronics");

    const store = await Store.create({
      vendor: owner._id, isPrimary: true, storeName: `Store ${run}`, slug: `store-${run}`,
      contactEmail: `s.${run}@t.rw`, contactPhone: "0788000111", status: "ACTIVE",
      socialLinks: { website: "https://x.rw" },
    });
    assert.equal((await Store.findById(store._id)).socialLinks.website, "https://x.rw");

    const staffUser = await User.create({
      Fullname: "Staff", email: `st.${run}@t.rw`, password: "password123", role: "vendor",
      isVendorStaff: true, companyName: "x",
    });
    const staff = await Staff.create({
      store: store._id, vendorOwner: owner._id, user: staffUser._id, role: "ORDER_MANAGER",
      email: `st.${run}@t.rw`, invitationTokenHash: "abc", status: "INVITED",
    });
    const hidden = await Staff.findById(staff._id);
    assert.equal(hidden.invitationTokenHash, undefined, "token hash is not selected by default");
    const withToken = await Staff.findById(staff._id).select("+invitationTokenHash");
    assert.equal(withToken.invitationTokenHash, "abc");

    const cat = await Category.create({ name: `C ${run}`, slug: `c-${run}` });
    const product = await Product.create({
      vendor: owner._id, store: store._id, category: cat._id, name: `P ${run}`, slug: `p-${run}`, sku: `S-${run}`,
      description: "d", price: 5000, stockQuantity: 10, status: "ACTIVE", media: { mainImage: "a.jpg" },
    });
    // Guarded stock decrement (no oversell): second one must fail.
    const dec = (n) => Product.findOneAndUpdate({ _id: product._id, stockQuantity: { $gte: n } }, { $inc: { stockQuantity: -n } }, { new: true });
    assert.equal((await dec(8)).stockQuantity, 2);
    assert.equal(await dec(8), null);
    const mine = await Product.find({ vendor: owner._id, store: store._id }).sort({ createdAt: -1 });
    assert.equal(mine.length, 1);
    assert.equal(mine[0].stockQuantity, 2);
    assert.ok(mine[0].publicId);
  });
});
