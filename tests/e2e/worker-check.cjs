// Runs the SLA worker against the current driver (DB_DRIVER) and prints the outcome.
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { isMysql } = require("../../src/database/driver");
const Order = require("../../src/models/Order");
const User = require("../../src/models/User");
const { enforceFulfillmentSLA, cancelExpiredUnpaidOrders } = require("../../src/workers/slaWorker");

(async () => {
  if (!isMysql) await mongoose.connect(process.env.MONGO_URI);
  const buyer = await User.findOne({ role: "buyer" });
  const order = await Order.create({
    user: buyer._id, orderNumber: `ORD-SLA-${Date.now()}`, items: [{ name: "x", price: 100, quantity: 1 }],
    shippingAddress: { street: "s", city: "c", state: "st", country: "Rwanda" }, totalAmount: 100,
    paymentStatus: "PAID", orderStatus: "PROCESSING",
  });
  const old = new Date(Date.now() - 4 * 60 * 60 * 1000);
  if (isMysql) {
    const { sequelize } = require("../../src/database");
    await sequelize.query(`UPDATE orders SET updatedAt = ${sequelize.escape(old)} WHERE id = ${sequelize.escape(String(order._id))}`);
  }
  else await Order.collection.updateOne({ _id: order._id }, { $set: { updatedAt: old } });
  await cancelExpiredUnpaidOrders();
  await enforceFulfillmentSLA();
  const after = await Order.findById(order._id);
  console.log(JSON.stringify({ driver: isMysql ? "mysql" : "mongo", slaBreached: after.slaBreached, hasBreachedAt: !!after.slaBreachedAt, note: (after.adminNotes || "").includes("SLA Breached") }));
  await Order.deleteOne({ _id: order._id });
  if (!isMysql) await mongoose.disconnect(); else await require("../../src/database").sequelize.close();
})().catch((e) => { console.error("worker-check failed:", e.message); process.exit(1); });
