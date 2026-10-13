// End-to-end affiliate flow against a real MongoDB replica set (transactions are
// required by the payment/escrow code). Run with: node --test tests/integration/affiliate.flow.test.js
const assert = require("node:assert/strict");
const { before, after, beforeEach, describe, test } = require("node:test");
const { execSync } = require("node:child_process");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "affiliate_flow_test_secret";

const mongoose = require("mongoose");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../../src/models/User");
const Category = require("../../src/models/Category");
const Product = require("../../src/models/Product");
const Order = require("../../src/models/Order");
const Settlement = require("../../src/models/Settlement");
const AffiliateLink = require("../../src/models/AffiliateLink");
const AffiliateClick = require("../../src/models/AffiliateClick");
const AffiliateAttribution = require("../../src/models/AffiliateAttribution");
const AffiliateWallet = require("../../src/models/AffiliateWallet");
const ConversionAudit = require("../../src/models/ConversionAudit");
const paymentService = require("../../src/services/payment.service");
const financialService = require("../../src/services/financial.service");
const attribution = require("../../src/services/affiliateAttribution.service");
const affiliateService = require("../../src/services/affiliate.service");

let replSet;
let app;
const DAY = 24 * 60 * 60 * 1000;
const token = (u) => jwt.sign({ userId: u._id, role: u.role }, process.env.JWT_SECRET);
let seq = 0;
const mkUser = (role) => {
  seq += 1;
  return User.create({
    Fullname: `${role} ${seq}`,
    email: `${role}${seq}@t.rw`,
    password: "password123",
    phone: `07880${String(seq).padStart(5, "0")}`,
    gender: "male",
    role,
    companyName: `Co ${seq}`,
  });
};

describe("affiliate flow", () => {
  let vendor, buyer, affA, affB, admin, cat, mouse, keyboard, draft;

  before(async () => {
    const bin = execSync("command -v mongod", { encoding: "utf8" }).trim();
    replSet = await MongoMemoryReplSet.create({ binary: { systemBinary: bin }, replSet: { count: 1, name: "rs0" } });
    await mongoose.connect(replSet.getUri("test"), { directConnection: true });
    await Promise.all([User, Settlement, ConversionAudit, Order, AffiliateLink, AffiliateAttribution].map((m) => m.init()));

    app = express();
    app.use(express.json());
    app.use("/api/affiliates", require("../../src/routes/affiliate.routes"));
    app.use("/api/orders", require("../../src/routes/order.routes"));
  });

  after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  beforeEach(async () => {
    await Promise.all(
      [User, Category, Product, Order, Settlement, AffiliateLink, AffiliateClick, AffiliateAttribution, AffiliateWallet, ConversionAudit]
        .map((m) => m.deleteMany({}))
    );
    vendor = await mkUser("vendor");
    buyer = await mkUser("buyer");
    affA = await mkUser("affiliate");
    affB = await mkUser("affiliate");
    admin = await mkUser("super_admin");
    cat = await Category.create({ name: "Electronics", slug: "electronics" });
    const base = { vendor: vendor._id, category: cat._id, description: "d", stockQuantity: 50, media: { mainImage: "x.jpg" } };
    mouse = await Product.create({ ...base, name: "Mouse", slug: "mouse", sku: "M1", price: 100000, status: "ACTIVE" });
    keyboard = await Product.create({ ...base, name: "Keyboard", slug: "keyboard", sku: "K1", price: 50000, status: "ACTIVE" });
    draft = await Product.create({ ...base, name: "Draft", slug: "draft", sku: "D1", price: 1000, status: "DRAFT" });
  });

  const createLink = (user, productId) =>
    request(app).post("/api/affiliates/links").set("Authorization", `Bearer ${token(user)}`).send({ productId });
  const click = (code, query = "") => request(app).get(`/api/affiliates/track/${code}${query}`);
  const checkout = (items, visitorId) =>
    request(app)
      .post("/api/orders/direct-checkout")
      .set("Authorization", `Bearer ${token(buyer)}`)
      .send({
        items,
        visitorId,
        paymentMethod: "MOMO",
        // Kigali standard delivery is free, so order totals equal item totals.
        shippingAddress: { street: "KN 1 Rd", district: "Nyarugenge", province: "Kigali City" },
        recipient: { name: "Test Buyer", phone: "0788123456" },
      });
  const pay = (order, ref = `ext-${order._id}`) =>
    paymentService.processPaymentWebhook({
      provider: "TEST",
      externalTransactionId: ref,
      orderId: order._id,
      amount: order.totalAmount,
      payload: {},
    });

  async function promotedOrder() {
    const { body } = await createLink(affA, mouse._id);
    const c = await click(body.link.affiliateCode);
    const res = await checkout(
      [{ productId: mouse._id, qty: 1 }, { productId: keyboard._id, qty: 1 }],
      c.body.data.visitorId
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { order: await Order.findById(res.body.order._id), link: body.link };
  }

  test("link creation validates product, role and ownership", async () => {
    assert.equal((await createLink(affA, mouse._id)).status, 201);
    assert.equal((await createLink(affA, draft._id)).status, 400);
    assert.equal((await createLink(affA, new mongoose.Types.ObjectId())).status, 404);
    assert.equal((await createLink(affA, "not-an-id")).status, 400);
    assert.equal((await createLink(buyer, mouse._id)).status, 403);
    const again = await createLink(affA, mouse._id);
    assert.equal(await AffiliateLink.countDocuments({ affiliateUser: affA._id }), 1, "bare link is idempotent");
    assert.equal(again.status, 201);
  });

  test("click is recorded server-side and resolves the exact product", async () => {
    const { body } = await createLink(affA, mouse._id);
    const first = await click(body.link.affiliateCode);
    assert.equal(first.status, 200);
    assert.equal(String(first.body.data.targetProduct.id), String(mouse._id));
    assert.match(first.body.data.visitorId, /^[a-f0-9]{32}$/);
    const vid = first.body.data.visitorId;
    await click(body.link.affiliateCode, `?visitorId=${vid}`); // debounced refresh
    assert.equal(await AffiliateClick.countDocuments({ link: body.link._id }), 1);
    assert.equal((await click("AFF-NOPE")).status, 404);
  });

  test("last click wins and starts a fresh window", async () => {
    const la = (await createLink(affA, mouse._id)).body.link;
    const lb = (await createLink(affB, mouse._id)).body.link;
    const vid = (await click(la.affiliateCode)).body.data.visitorId;
    await AffiliateAttribution.updateOne({ visitorId: vid }, { clickedAt: new Date(Date.now() - 5 * DAY) });
    await click(lb.affiliateCode, `?visitorId=${vid}`);
    const row = await AffiliateAttribution.findOne({ visitorId: vid, product: mouse._id });
    assert.equal(String(row.affiliateUser), String(affB._id));
    assert.ok(Date.now() - row.clickedAt.getTime() < 5000);
    assert.equal(await AffiliateAttribution.countDocuments({ visitorId: vid }), 1);
  });

  test("referral window: valid inside 30 days, expired at exactly 30 days", async () => {
    const now = new Date("2026-01-31T00:00:00Z");
    assert.equal(attribution.isWithinWindow(new Date(now - 30 * DAY + 1), now), true);
    assert.equal(attribution.isWithinWindow(new Date(now - 30 * DAY), now), false);
    assert.equal(attribution.isWithinWindow(new Date(now.getTime() + 1000), now), false);

    const la = (await createLink(affA, mouse._id)).body.link;
    const vid = (await click(la.affiliateCode)).body.data.visitorId;
    await AffiliateAttribution.updateOne({ visitorId: vid }, { clickedAt: new Date(Date.now() - 31 * DAY) });
    const res = await checkout([{ productId: mouse._id, qty: 1 }], vid);
    assert.equal(res.body.order.items[0].affiliateUser ?? null, null);
  });

  test("attribution is per item and the buyer's own link does not pay them", async () => {
    const { order } = await promotedOrder();
    const byProduct = Object.fromEntries(order.items.map((i) => [String(i.product), i]));
    assert.equal(String(byProduct[mouse._id].affiliateUser), String(affA._id));
    assert.equal(byProduct[keyboard._id].affiliateUser, null);

    const own = (await createLink(buyer, mouse._id)); // buyer role cannot even create one
    assert.equal(own.status, 403);
  });

  test("payment creates one commission per promoted item at the configured rate; replays are idempotent", async () => {
    const { order } = await promotedOrder();
    assert.equal(await ConversionAudit.countDocuments(), 0, "unpaid order earns nothing");

    await pay(order);
    await pay(order); // repeated webhook with the same id
    assert.equal((await pay(order, "another-id")).status, "ALREADY_PAID");

    const audits = await ConversionAudit.find({});
    assert.equal(audits.length, 1);
    assert.equal(String(audits[0].affiliateUser), String(affA._id));
    assert.equal(audits[0].commissionEarned, 500); // 0.5% of 100000 (revenueSplit AFFILIATE_PERCENT)
    assert.equal(audits[0].conversionValue, 100000);
    assert.equal(await Settlement.countDocuments({ affiliateShare: { $gt: 0 } }), 1);
    const wallet = await AffiliateWallet.findOne({ affiliateUser: affA._id });
    assert.equal(wallet.pendingBalance, 500);
  });

  test("full cancellation reverses the commission once", async () => {
    const { order } = await promotedOrder();
    await pay(order);
    const cancel = () =>
      attribution.reverseOrderCommission({ orderId: order._id, key: `order-cancel:${order._id}` });
    await cancel();
    await cancel();
    const audit = await ConversionAudit.findOne({});
    assert.equal(audit.status, "REVERSED");
    assert.equal(audit.reversedAmount, 500);
    assert.equal(audit.reversals.length, 1);
    assert.equal((await AffiliateWallet.findOne({ affiliateUser: affA._id })).pendingBalance, 0);
  });

  test("buyer cancellation endpoint reverses the commission; unpaid cancel creates nothing", async () => {
    const { order } = await promotedOrder();
    await pay(order);
    const res = await request(app).post(`/api/orders/${order._id}/cancel`).set("Authorization", `Bearer ${token(buyer)}`).send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const audit = await ConversionAudit.findOne({});
    assert.equal(audit.status, "REVERSED");
    assert.equal((await AffiliateWallet.findOne({ affiliateUser: affA._id })).pendingBalance, 0);

    const { order: unpaid } = await promotedOrder();
    assert.equal(await ConversionAudit.countDocuments({ order: unpaid._id }), 0);
  });

  test("partial refund reverses only the proportional commission", async () => {
    const { order } = await promotedOrder(); // total 150000
    await pay(order);
    await attribution.reverseOrderCommission({ orderId: order._id, refundAmount: 75000, key: "dispute:1" });
    await attribution.reverseOrderCommission({ orderId: order._id, refundAmount: 75000, key: "dispute:1" });
    const audit = await ConversionAudit.findOne({});
    assert.equal(audit.reversedAmount, 250);
    assert.equal(audit.status, "PENDING");
    assert.equal((await AffiliateWallet.findOne({ affiliateUser: affA._id })).pendingBalance, 250);
  });

  const deliver = (order, user, otp) =>
    request(app)
      .patch(`/api/orders/${order._id}/deliver`)
      .set("Authorization", `Bearer ${token(user)}`)
      .send({ deliveryOtp: otp === undefined ? order.deliveryOtp : otp });
  const setStatus = (order, user, status) =>
    request(app).patch(`/api/orders/${order._id}/status`).set("Authorization", `Bearer ${token(user)}`).send({ status });
  const audit = () => ConversionAudit.findOne({});
  const wallet = () => AffiliateWallet.findOne({ affiliateUser: affA._id });

  test("commission stays pending through paid, processing and shipped; delivery approves it once", async () => {
    const { order } = await promotedOrder();
    assert.equal(await ConversionAudit.countDocuments(), 0, "no commission before payment");
    await pay(order);
    assert.equal((await audit()).status, "PENDING");
    assert.equal((await wallet()).availableBalance, 0);

    assert.equal((await setStatus(order, vendor, "SHIPPED")).status, 200);
    assert.equal((await audit()).status, "PENDING");
    assert.equal((await wallet()).availableBalance, 0);

    // not an authorized delivery workflow / wrong proof
    assert.equal((await deliver(order, buyer)).status, 403);
    assert.equal((await deliver(order, affA)).status, 403);
    assert.equal((await deliver(order, admin, "000000")).status, 400);
    assert.equal((await audit()).status, "PENDING");

    const ok = await deliver(order, admin);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const a = await audit();
    assert.equal(a.status, "APPROVED");
    assert.ok(a.approvedAt);
    let w = await wallet();
    assert.equal(w.pendingBalance, 0);
    assert.equal(w.availableBalance, 500);

    // replayed delivery: rejected, nothing changes
    assert.equal((await deliver(order, admin)).status, 400);
    assert.equal(await ConversionAudit.countDocuments(), 1);
    w = await wallet();
    assert.equal(w.availableBalance, 500);

    // dashboard reflects backend state
    const res = await request(app).get("/api/affiliates/overview").set("Authorization", `Bearer ${token(affA)}`);
    assert.equal(res.body.commission.approved, 500);
    assert.equal(res.body.commission.pending, 0);
    assert.equal(res.body.wallet.availableBalance, 500);

    // affiliates cannot approve or change commissions
    assert.equal((await request(app).patch(`/api/affiliates/commissions/${a._id}`).set("Authorization", `Bearer ${token(affA)}`).send({ status: "APPROVED" })).status, 404);
  });

  test("manual escrow release before delivery does not approve; delivery afterwards does", async () => {
    const { order } = await promotedOrder();
    await pay(order);
    const settlement = await Settlement.findOne({ affiliateShare: { $gt: 0 } });
    const session = await mongoose.startSession();
    await session.withTransaction(() => financialService.releaseEscrowToVendor({ settlementId: settlement._id, session }));
    await session.endSession();
    assert.equal((await audit()).status, "PENDING");
    assert.equal((await wallet()).availableBalance, 0);

    await Order.updateOne({ _id: order._id }, { orderStatus: "DELIVERED", isDelivered: true });
    const s2 = await mongoose.startSession();
    const approved = await s2.withTransaction(() =>
      financialService.approveAffiliateCommissionsForOrder({ orderId: order._id, session: s2 })
    ).then(() => null);
    await s2.endSession();
    assert.equal(approved, null);
    assert.equal((await audit()).status, "APPROVED");
    assert.equal((await wallet()).availableBalance, 500);
  });

  test("cancelled / failed orders are never approved", async () => {
    const { order } = await promotedOrder();
    await pay(order);
    assert.equal((await setStatus(order, vendor, "CANCELLED")).status, 200);
    assert.equal((await audit()).status, "REVERSED");
    assert.equal((await wallet()).pendingBalance, 0);
    assert.equal((await deliver(order, admin)).status, 400);
    const s = await mongoose.startSession();
    await s.withTransaction(() => financialService.approveAffiliateCommissionsForOrder({ orderId: order._id, session: s }));
    await s.endSession();
    assert.equal((await wallet()).availableBalance, 0);

    // unpaid order: nothing to approve even if marked delivered
    const { order: unpaid } = await promotedOrder();
    await Order.updateOne({ _id: unpaid._id }, { orderStatus: "DELIVERED", isDelivered: true });
    assert.equal(await ConversionAudit.countDocuments({ order: unpaid._id }), 0);
  });

  test("partial refund before delivery approves only the remaining commission", async () => {
    const { order } = await promotedOrder();
    await pay(order);
    await attribution.reverseOrderCommission({ orderId: order._id, refundAmount: 75000, key: "dispute:2" });
    assert.equal((await deliver(order, admin)).status, 200);
    const a = await audit();
    assert.equal(a.status, "APPROVED");
    assert.equal(a.reversedAmount, 250);
    const w = await wallet();
    assert.equal(w.pendingBalance, 0);
    assert.equal(w.availableBalance, 250);
  });

  test("refund after approval takes the commission back from the available balance once", async () => {
    const { order } = await promotedOrder();
    await pay(order);
    await deliver(order, admin);
    assert.equal((await wallet()).availableBalance, 500);
    await attribution.reverseOrderCommission({ orderId: order._id, key: "refund:1" });
    await attribution.reverseOrderCommission({ orderId: order._id, key: "refund:1" });
    const a = await audit();
    assert.equal(a.status, "REVERSED");
    assert.equal(a.commissionEarned, 500, "original amount preserved");
    assert.equal(a.reversals.length, 1);
    assert.equal((await wallet()).availableBalance, 0);
    assert.equal((await deliver(order, admin)).status, 400);
  });

  test("terminated links stop new referrals but keep history; other affiliates cannot touch them", async () => {
    const { order, link } = await promotedOrder();
    await pay(order);

    const stranger = await request(app).delete(`/api/affiliates/links/${link._id}`).set("Authorization", `Bearer ${token(affB)}`);
    assert.equal(stranger.status, 404);

    const del = await request(app).delete(`/api/affiliates/links/${link._id}`).set("Authorization", `Bearer ${token(affA)}`);
    assert.equal(del.status, 200);
    assert.equal((await click(link.affiliateCode)).status, 404);
    assert.equal(await AffiliateClick.countDocuments({ link: link._id }), 1, "history kept");
    assert.equal(await ConversionAudit.countDocuments({ link: link._id }), 1);

    const revive = await request(app).patch(`/api/affiliates/links/${link._id}`).set("Authorization", `Bearer ${token(affA)}`).send({ isActive: true });
    assert.equal(revive.status, 400);

    const mine = await request(app).get("/api/affiliates/links").set("Authorization", `Bearer ${token(affA)}`);
    assert.equal(mine.body.data[0].status, "TERMINATED");
    assert.equal(mine.body.data[0].conversionCount, 1);
    const theirs = await request(app).get("/api/affiliates/links").set("Authorization", `Bearer ${token(affB)}`);
    assert.equal(theirs.body.data.length, 0);

    // a new link can be created after termination
    assert.equal((await createLink(affA, mouse._id)).status, 201);
  });

  test("overview reports real numbers and is private to the affiliate", async () => {
    const { order } = await promotedOrder();
    await pay(order);
    const res = await request(app).get("/api/affiliates/overview").set("Authorization", `Bearer ${token(affA)}`);
    assert.equal(res.status, 200);
    const o = res.body.overview || res.body.data || res.body;
    assert.equal(o.clicks, 1);
    assert.equal(o.uniqueVisitors, 1);
    assert.equal(o.attributedOrders, 1);
    assert.equal(o.commission.net, 500);
    assert.equal(o.commission.pending, 500);
    assert.equal(o.recent.length, 1);

    const other = await request(app).get("/api/affiliates/overview").set("Authorization", `Bearer ${token(affB)}`);
    const p = other.body.overview || other.body.data || other.body;
    assert.equal(p.clicks, 0);
    assert.equal(p.commission.net, 0);
    assert.equal((await request(app).get("/api/affiliates/overview").set("Authorization", `Bearer ${token(buyer)}`)).status, 403);
    assert.equal((await request(app).get("/api/affiliates/overview")).status, 401);
  });

  test("profile: name and phone are mandatory, phone is unique, per-link successful count is exposed", async () => {
    const patch = (body) =>
      request(app).patch("/api/affiliates/profile").set("Authorization", `Bearer ${token(affA)}`).send(body);

    assert.equal((await patch({ fullName: " " })).status, 400);
    assert.equal((await patch({ phone: "" })).status, 400);
    assert.equal((await patch({ phone: "12" })).status, 400);
    const { normalizePhone } = require("../../src/utils/sms.util");
    await User.updateOne({ _id: affB._id }, { phone: normalizePhone(affB.phone) });
    assert.equal((await patch({ phone: affB.phone })).status, 400, "duplicate phone");

    const ok = await patch({ fullName: "Amina Uwase", phone: "0788555111", bio: "hi" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const fresh = await User.findById(affA._id);
    assert.equal(fresh.Fullname, "Amina Uwase");
    assert.match(fresh.phone, /788555111$/);

    const { order } = await promotedOrder();
    await pay(order);
    let links = (await request(app).get("/api/affiliates/links").set("Authorization", `Bearer ${token(affA)}`)).body.data;
    assert.equal(links[0].clickCount, 1);
    assert.equal(links[0].conversionCount, 1);
    assert.equal(links[0].successfulCount, 0, "ordered but not delivered");
    assert.equal((await deliver(order, admin)).status, 200);
    links = (await request(app).get("/api/affiliates/links").set("Authorization", `Bearer ${token(affA)}`)).body.data;
    assert.equal(links[0].successfulCount, 1);
  });

  // ── Hardening: wallet/ledger consistency, last-click debounce, payouts ─────
  const cancelAs = (user, order) =>
    request(app).post(`/api/orders/${order._id}/cancel`).set("Authorization", `Bearer ${token(user)}`).send({});

  test("cancelling one paid order does not touch another order's pending commission", async () => {
    const { order: o1 } = await promotedOrder();
    const { order: o2 } = await promotedOrder();
    await pay(o1);
    await pay(o2);
    assert.equal((await wallet()).pendingBalance, 1000);
    assert.equal((await cancelAs(buyer, o1)).status, 200);
    const w = await wallet();
    assert.equal(w.pendingBalance, 500, "only o1's 500 leaves pending (once)");
    assert.equal(w.availableBalance, 0);
    assert.equal(await ConversionAudit.countDocuments({ order: o2._id, status: "PENDING" }), 1);
  });

  test("cancelling after a partial vendor delivery reverses from pending, never from available", async () => {
    const vendor2 = await mkUser("vendor");
    const shirt = await Product.create({
      vendor: vendor2._id, category: cat._id, description: "d", stockQuantity: 5, media: { mainImage: "x.jpg" },
      name: "Shirt", slug: "shirt", sku: "S1", price: 20000, status: "ACTIVE",
    });
    // Affiliate already has 500 available from a different, delivered order.
    const { order: done } = await promotedOrder();
    await pay(done);
    assert.equal((await deliver(done, admin)).status, 200);
    assert.equal((await wallet()).availableBalance, 500);

    const { body } = await createLink(affA, mouse._id);
    const c = await click(body.link.affiliateCode);
    const res = await checkout([{ productId: mouse._id, qty: 1 }, { productId: shirt._id, qty: 1 }], c.body.data.visitorId);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const order = await Order.findById(res.body.order._id);
    await pay(order);
    assert.equal((await deliver(order, vendor)).status, 200); // only vendor 1 delivered
    const mid = await ConversionAudit.findOne({ order: order._id });
    assert.equal(mid.status, "PENDING", "order not fully delivered yet");

    assert.equal((await cancelAs(admin, order)).status, 200);
    const a = await ConversionAudit.findOne({ order: order._id });
    assert.equal(a.status, "REVERSED");
    assert.equal(a.unrecoveredAmount, 0);
    const w = await wallet();
    assert.equal(w.pendingBalance, 0);
    assert.equal(w.availableBalance, 500, "the other order's available commission is untouched");
  });

  test("approval and later refund keep the AFFILIATE_COMMISSION ledger account in step", async () => {
    const LedgerAccount = require("../../src/models/LedgerAccount");
    await LedgerAccount.deleteMany({});
    const { order } = await promotedOrder();
    await pay(order);
    await deliver(order, admin);
    const bal = async () => (await LedgerAccount.findOne({ accountType: "AFFILIATE_COMMISSION" }))?.balance || 0;
    assert.equal(await bal(), 500);
    await attribution.reverseOrderCommission({ orderId: order._id, refundAmount: 75000, key: "refund:half" });
    assert.equal(await bal(), 250);
    assert.equal((await wallet()).availableBalance, 250);
    await attribution.reverseOrderCommission({ orderId: order._id, key: "refund:rest" });
    assert.equal(await bal(), 0);
    assert.equal((await wallet()).availableBalance, 0);
    assert.equal((await audit()).status, "REVERSED");
  });

  test("last click wins even when the visitor returns to a link within the debounce window", async () => {
    const la = (await createLink(affA, mouse._id)).body.link;
    const lb = (await createLink(affB, mouse._id)).body.link;
    const vid = (await click(la.affiliateCode)).body.data.visitorId;
    await click(lb.affiliateCode, `?visitorId=${vid}`);
    await click(la.affiliateCode, `?visitorId=${vid}`); // A again, inside A's debounce window
    const row = await AffiliateAttribution.findOne({ visitorId: vid, product: mouse._id });
    assert.equal(String(row.affiliateUser), String(affA._id));
  });

  test("payout: concurrent withdrawals cannot overdraw; in-flight payouts stay in total earned", async () => {
    await AffiliateWallet.create({ affiliateUser: affA._id, availableBalance: 20000 });
    const ask = () =>
      affiliateService.requestPayout({
        userId: affA._id,
        amount: 15000,
        paymentMethod: "BANK_TRANSFER",
        accountDetails: { accountName: "A", bankName: "BK", accountNumber: "123" },
      });
    const results = await Promise.allSettled([ask(), ask()]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const w = await wallet();
    assert.equal(w.availableBalance, 5000);
    const summary = await affiliateService.getWalletSummary(affA._id);
    assert.equal(summary.totalEarned, 20000, "15000 in a pending payout is still earned");
    assert.equal(summary.pendingPayout, 15000);
  });
});
