// Affiliate flow on the MySQL driver. Run against a THROWAWAY database only:
//   DB_DRIVER=mysql DB_HOST=127.0.0.1 DB_PORT=3307 DB_DATABASE=mvec_ikiguzi_test node --test tests/integration/affiliate.mysql.test.js
// (migrate first: npx sequelize-cli db:migrate with the same DB_* variables).
const assert = require("node:assert/strict");
const { before, after, describe, test } = require("node:test");

process.env.NODE_ENV = "development";
process.env.JWT_SECRET = "affiliate_mysql_test_secret";

const driver = require("../../src/database/driver");
const skip = !driver.isMysql || !/_test$/.test(String(process.env.DB_DATABASE || ""));

describe("affiliate flow on MySQL", { skip: skip && "needs DB_DRIVER=mysql and a DB_DATABASE ending in _test" }, () => {
  let sequelize, User, Category, Product, Order, Settlement, ConversionAudit, AffiliateWallet, AffiliateAttribution, AffiliateLink,
    AffiliateClick, AffiliatePayout, LedgerAccount, paymentService, financialService, attribution, affiliateService, checkoutService;
  let vendor, buyer, aff, product;
  let seq = 0;
  const run = Date.now().toString().slice(-6);

  const mkUser = (role, extra = {}) => {
    seq += 1;
    return User.create({
      Fullname: `${role} ${seq}`, email: `${role}${seq}.${run}@t.rw`, password: "password123",
      phone: `0788${String(Number(run) % 100000).padStart(5, "0")}${seq}`.slice(0, 10), gender: "male", role,
      companyName: `Co ${seq}`, ...extra,
    });
  };
  const rows = async (sql, replacements = {}) => (await sequelize.query(sql, { replacements, type: "SELECT" }));
  const pay = (order) =>
    paymentService.processPaymentWebhook({
      provider: "PAYPACK", externalTransactionId: `ext-${order._id}`, orderId: order._id, amount: order.totalAmount, payload: {},
    });
  const placeOrder = async () => {
    const link = await affiliateService.generateAffiliateLink(aff._id, product._id);
    const click = await affiliateService.trackClick(link.affiliateCode, { visitorIp: "1.2.3.4" });
    return checkoutService.createOrder({
      userId: buyer._id,
      lines: [{ productId: String(product._id), quantity: 1 }],
      delivery: {
        shippingAddress: { street: "KN 1 Rd", district: "Nyarugenge", province: "Kigali City" },
        recipient: { name: "Buyer", phone: "0788123456" },
      },
      paymentMethod: "MOMO",
      visitorId: click.visitorId,
    });
  };
  const deliver = async (order) => {
    const session = await require("mongoose").startSession();
    try {
      await session.withTransaction(async () => {
        const o = await Order.findById(order._id).session(session);
        for (const s of await Settlement.find({ order: o._id, status: "HELD" }).session(session)) {
          await financialService.releaseEscrowToVendor({ settlementId: s._id, session });
        }
        o.orderStatus = "DELIVERED";
        o.isDelivered = true;
        o.deliveredAt = new Date();
        await o.save({ session });
        await financialService.approveAffiliateCommissionsForOrder({ orderId: o._id, session });
      });
    } finally {
      await session.endSession();
    }
  };
  const wallet = () => AffiliateWallet.findOne({ affiliateUser: aff._id });

  before(async () => {
    ({ sequelize } = require("../../src/database"));
    User = require("../../src/models/User");
    Category = require("../../src/models/Category");
    Product = require("../../src/models/Product");
    Order = require("../../src/models/Order");
    Settlement = require("../../src/models/Settlement");
    ConversionAudit = require("../../src/models/ConversionAudit");
    AffiliateWallet = require("../../src/models/AffiliateWallet");
    AffiliateAttribution = require("../../src/models/AffiliateAttribution");
    AffiliateLink = require("../../src/models/AffiliateLink");
    AffiliateClick = require("../../src/models/AffiliateClick");
    AffiliatePayout = require("../../src/models/AffiliatePayout");
    LedgerAccount = require("../../src/models/LedgerAccount");
    paymentService = require("../../src/services/payment.service");
    financialService = require("../../src/services/financial.service");
    attribution = require("../../src/services/affiliateAttribution.service");
    affiliateService = require("../../src/services/affiliate.service");
    checkoutService = require("../../src/services/checkout.service");

    vendor = await mkUser("vendor");
    buyer = await mkUser("buyer");
    aff = await mkUser("affiliate");
    const cat = await Category.create({ name: `Cat ${run}`, slug: `cat-${run}` });
    product = await Product.create({
      vendor: vendor._id, category: cat._id, description: "d", stockQuantity: 50, media: { mainImage: "x.jpg" },
      name: `Mouse ${run}`, slug: `mouse-${run}`, sku: `M-${run}`, price: 100000, status: "ACTIVE",
    });
  });
  after(async () => { if (sequelize) await sequelize.close(); });

  test("link, click and last-click attribution are persisted in MySQL", async () => {
    const link = await affiliateService.generateAffiliateLink(aff._id, product._id);
    const click = await affiliateService.trackClick(link.affiliateCode, { visitorIp: "9.9.9.9" });
    const [l] = await rows("SELECT status, clickCount FROM affiliate_links WHERE affiliateCode = :c", { c: link.affiliateCode });
    assert.equal(l.status, "ACTIVE");
    assert.equal(Number(l.clickCount), 1);
    const [a] = await rows("SELECT affiliateCode FROM affiliate_attributions WHERE visitorId = :v", { v: click.visitorId });
    assert.equal(a.affiliateCode, link.affiliateCode);
    const [c] = await rows("SELECT COUNT(*) n FROM affiliate_clicks WHERE visitorId = :v", { v: click.visitorId });
    assert.equal(Number(c.n), 1);
  });

  test("payment -> pending commission; delivery -> available exactly once", async () => {
    const order = await placeOrder();
    assert.equal(String(order.items[0].affiliateUser), String(aff._id));
    await pay(order);
    await pay(order); // replay
    const audits = await rows("SELECT status, commissionEarned, orderItemId FROM conversion_audits WHERE orderId = :o", { o: String(order._id) });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].status, "PENDING");
    assert.equal(Number(audits[0].commissionEarned), 500); // 0.5% from src/config/revenueSplit.js
    assert.ok(audits[0].orderItemId);
    const before = await wallet();
    assert.equal(before.pendingBalance, 500);
    assert.equal(before.availableBalance, 0);

    await deliver(order);
    await deliver(order).catch(() => {}); // second delivery event must not credit again
    const after = await wallet();
    assert.equal(after.pendingBalance, 0);
    assert.equal(after.availableBalance, 500);
    const [done] = await rows("SELECT status, approvedAt FROM conversion_audits WHERE orderId = :o", { o: String(order._id) });
    assert.equal(done.status, "APPROVED");
    assert.ok(done.approvedAt);

    // Refund after approval: reversed once, from available, ledger follows.
    await attribution.reverseOrderCommission({ orderId: order._id, key: "refund:1" });
    await attribution.reverseOrderCommission({ orderId: order._id, key: "refund:1" });
    const [rev] = await rows("SELECT status, reversedAmount, reversals FROM conversion_audits WHERE orderId = :o", { o: String(order._id) });
    assert.equal(rev.status, "REVERSED");
    assert.equal(Number(rev.reversedAmount), 500);
    const reversals = typeof rev.reversals === "string" ? JSON.parse(rev.reversals) : rev.reversals;
    assert.equal(reversals.length, 1);
    assert.equal((await wallet()).availableBalance, 0);
  });

  test("cancelling a paid order reverses its pending commission in the refund transaction", async () => {
    const o1 = await placeOrder();
    const o2 = await placeOrder();
    await pay(o1);
    await pay(o2);
    assert.equal((await wallet()).pendingBalance, 1000);
    const session = await require("mongoose").startSession();
    try {
      await session.withTransaction(() =>
        financialService.refundHeldEscrowForOrder({ orderId: o1._id, session, reversalKey: `order-cancel:${o1._id}`, reversalReason: "test" })
      );
    } finally {
      await session.endSession();
    }
    assert.equal((await wallet()).pendingBalance, 500, "only o1's commission leaves pending");
    const [s] = await rows("SELECT status FROM settlements WHERE orderId = :o", { o: String(o1._id) });
    assert.equal(s.status, "REFUNDED");
  });

  test("concurrent payouts cannot overdraw; wallet totals include in-flight payouts", async () => {
    await AffiliateWallet.updateOne({ affiliateUser: aff._id }, { $set: { availableBalance: 20000, pendingBalance: 0 } });
    const ask = () =>
      affiliateService.requestPayout({
        userId: aff._id, amount: 15000, paymentMethod: "BANK_TRANSFER",
        accountDetails: { accountName: "A", bankName: "BK", accountNumber: "123" },
      });
    const results = await Promise.allSettled([ask(), ask()]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await wallet()).availableBalance, 5000);
    const summary = await affiliateService.getWalletSummary(aff._id);
    assert.equal(summary.pendingPayout, 15000);
    assert.equal(summary.totalEarned, 20000);
  });

  test("dashboard aggregates run on MySQL and agree with the commission rows", async () => {
    const overview = await affiliateService.getOverview(aff._id);
    assert.ok(overview.links.created >= 1);
    assert.ok(overview.clicks >= 1);
    const [t] = await rows(
      "SELECT COALESCE(SUM(commissionEarned),0) gross, COALESCE(SUM(reversedAmount),0) rev FROM conversion_audits WHERE affiliateUserId = :u",
      { u: String(aff._id) }
    );
    assert.equal(overview.commission.gross, Number(t.gross));
    assert.equal(overview.commission.reversed, Number(t.rev));
    assert.equal(overview.commission.net, Number(t.gross) - Number(t.rev));
  });
});
