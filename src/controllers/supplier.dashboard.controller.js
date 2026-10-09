const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const crypto = require("crypto");
const Supplier = require("../models/Supplier");
const SupplierSupplyRequest = require("../models/SupplierSupplyRequest");
const SupplierTeamMember = require("../models/SupplierTeamMember");
const SupplierReview = require("../models/SupplierReview");
const WholesaleOrder = require("../models/WholesaleOrder");
const VendorWallet = require("../models/VendorWallet");
const { Payout } = require("../models/Payout");
const { formatRwandanPhone } = require("../utils/momo.util");

const payoutMinimum = 50000;
const pendingPayoutStatuses = ["PENDING", "PROCESSING"];
const countedOrderStatuses = ["ESCROW_HELD", "SHIPPED", "DELIVERED", "CONFIRMED_RELEASED", "DISPUTED"];
const reviewableOrderStatuses = ["CONFIRMED_RELEASED", "DELIVERED"];

async function findSupplier(userId) {
  let supplier = await Supplier.findOne({ user: userId });
  if (!supplier) {
    const membership = await SupplierTeamMember.findOne({ user: userId, status: "ACTIVE" });
    if (membership) supplier = await Supplier.findById(membership.supplier);
  }
  if (!supplier) {
    const error = new Error("Supplier profile not found. Complete supplier onboarding first.");
    error.statusCode = 404;
    throw error;
  }
  return supplier;
}

function sendError(res, error) {
  const status = error.statusCode || (["ValidationError", "CastError"].includes(error.name) ? 400 : 500);
  if (status >= 500) console.error("Supplier dashboard API error:", error);
  return res.status(status).json({ message: error.message || "Supplier dashboard request failed." });
}

function limitFrom(query, fallback = 50, max = 100) {
  const value = Number.parseInt(query.limit, 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(value, max)) : fallback;
}

function moneySeries(orders, start, end, range) {
  const bucketCount = range === "1y" ? 12 : range === "3m" ? 13 : 30;
  const bucketDays = range === "1y" ? null : range === "3m" ? 7 : 1;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const at = new Date(end);
    if (range === "1y") at.setMonth(at.getMonth() - (bucketCount - 1 - index), 1);
    else at.setDate(at.getDate() - (bucketCount - 1 - index) * bucketDays);
    at.setHours(0, 0, 0, 0);
    return { at, net: 0, units: 0 };
  });

  for (const order of orders) {
    const at = new Date(order.createdAt);
    let index;
    if (range === "1y") {
      index = (at.getFullYear() - buckets[0].at.getFullYear()) * 12 +
        at.getMonth() - buckets[0].at.getMonth();
    } else {
      index = Math.floor((at - buckets[0].at) / (bucketDays * 86400000));
    }
    if (index < 0 || index >= buckets.length || at < start || at > end) continue;
    const bucket = buckets[index];
    bucket.net += Number(order.totalAmount) || 0;
    bucket.units += (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  }
  return buckets;
}

function analyticsFor(orders, range, start, end) {
  const total = (rows) => rows.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0);
  const currentOrders = orders.filter((order) => order.createdAt >= start && order.createdAt <= end);
  const duration = end.getTime() - start.getTime() + 1;
  const previousStart = new Date(start.getTime() - duration);
  const previousEnd = new Date(start.getTime() - 1);
  const previousOrders = orders.filter((order) =>
    order.createdAt >= previousStart && order.createdAt <= previousEnd,
  );
  const gross = total(currentOrders);
  const previousGross = total(previousOrders);
  const units = currentOrders.reduce(
    (sum, order) => sum + (order.items || []).reduce((lineSum, item) => lineSum + (Number(item.quantity) || 0), 0),
    0,
  );
  const categories = new Map();
  const products = new Map();
  for (const order of currentOrders) {
    for (const item of order.items || []) {
      const quantity = Number(item.quantity) || 0;
      const revenue = (Number(item.unitPrice) || 0) * quantity;
      const product = item.product && typeof item.product === "object" ? item.product : null;
      const category = product?.category?.name || product?.category?.title || "Uncategorised";
      const name = item.productName || product?.name || "Product";
      const categoryRow = categories.get(category) || { category, revenue: 0, units: 0 };
      categoryRow.revenue += revenue;
      categoryRow.units += quantity;
      categories.set(category, categoryRow);
      const productRow = products.get(name) || { name, category, units: 0, revenue: 0 };
      productRow.units += quantity;
      productRow.revenue += revenue;
      products.set(name, productRow);
    }
  }
  const percentChange = (current, previous) => previous === 0 ? 0 : (current - previous) / previous;

  return {
    range,
    grossSales: gross,
    commission: 0,
    netEarnings: gross,
    orderCount: currentOrders.length,
    unitsSold: units,
    averageOrderValue: currentOrders.length ? gross / currentOrders.length : 0,
    salesDelta: percentChange(gross, previousGross),
    earningsDelta: percentChange(gross, previousGross),
    orderDelta: percentChange(currentOrders.length, previousOrders.length),
    series: moneySeries(currentOrders, start, end, range),
    categories: [...categories.values()]
      .map((row) => ({ ...row, share: gross ? row.revenue / gross : 0 }))
      .sort((a, b) => b.revenue - a.revenue),
    topProducts: [...products.values()].sort((a, b) => b.units - a.units).slice(0, 10),
  };
}

function analyticsWindow(rawRange) {
  const range = ["30d", "3m", "1y"].includes(rawRange) ? rawRange : "30d";
  const end = new Date();
  const start = new Date(end);
  if (range === "1y") start.setFullYear(start.getFullYear() - 1);
  else if (range === "3m") start.setDate(start.getDate() - 90);
  else start.setDate(start.getDate() - 30);
  start.setHours(0, 0, 0, 0);
  return { range, start, end };
}

function deliveryStage(order) {
  if (order.status === "CONFIRMED_RELEASED" || order.status === "DELIVERED") return "DELIVERED";
  if (order.status === "SHIPPED") return "DISPATCHED";
  if (order.status === "DISPUTED" && order.shippedAt) return "DISPATCHED";
  return "CONFIRMED";
}

function shipmentJson(order) {
  const stage = deliveryStage(order);
  const milestones = [{ stage: "CONFIRMED", at: order.createdAt }];
  if (order.shippedAt) milestones.push({ stage: "DISPATCHED", at: order.shippedAt });
  if (order.deliveredAt || order.confirmedAt) {
    milestones.push({ stage: "DELIVERED", at: order.deliveredAt || order.confirmedAt });
  }
  const units = (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  return {
    id: order._id,
    orderNumber: order.orderNumber,
    buyer: order.vendor?.companyName || order.vendor?.Fullname || "Vendor",
    product: (order.items || []).map((item) => item.productName).filter(Boolean).join(", "),
    units,
    gross: order.totalAmount,
    net: order.totalAmount,
    destination: order.vendor?.companyName || order.vendor?.Fullname || "Destination not provided",
    stage,
    milestones,
    eta: null,
    deliveredAt: order.deliveredAt || order.confirmedAt || null,
    settledAt: order.status === "CONFIRMED_RELEASED" ? order.confirmedAt || order.updatedAt : null,
    holdReason: order.status === "DISPUTED" ? "This order is under dispute review." : null,
  };
}

function payoutJson(payout) {
  return {
    _id: payout._id,
    amount: payout.amount,
    method: payout.payoutMethod === "MOMO" ? "MTN_MOMO" : payout.payoutMethod === "AIRTEL" ? "AIRTEL_MONEY" : "BANK_TRANSFER",
    requestedAt: payout.createdAt,
    status: payout.status,
    destination: payout.payoutDetails?.accountNumber,
    note: payout.note || "",
    arrivedAt: payout.processedAt || null,
  };
}

function ledgerOrderEntries(orders) {
  const rows = [];
  for (const order of orders) {
    if (order.status === "PENDING_PAYMENT" || order.status === "CANCELLED") continue;
    const units = (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    rows.push({
      _id: `${order._id}-sale`,
      at: order.createdAt,
      kind: "SALE",
      amount: order.totalAmount,
      description: `Wholesale order ${order.orderNumber}`,
      orderNumber: order.orderNumber,
      units,
    });
    if (countedOrderStatuses.includes(order.status)) {
      rows.push({
        _id: `${order._id}-hold`,
        at: order.createdAt,
        kind: "ESCROW_HOLD",
        amount: order.totalAmount,
        description: `Funds held for ${order.orderNumber}`,
        orderNumber: order.orderNumber,
        units,
      });
    }
    if (order.status === "CONFIRMED_RELEASED") {
      rows.push({
        _id: `${order._id}-release`,
        at: order.confirmedAt || order.updatedAt,
        kind: "ESCROW_RELEASE",
        amount: order.totalAmount,
        description: `Escrow released for ${order.orderNumber}`,
        orderNumber: order.orderNumber,
        units,
      });
    }
  }
  return rows;
}

exports.getFinanceSummary = async (req, res) => {
  try {
    const userId = req.user._id;
    const [orders, wallet, payouts, pendingPayouts] = await Promise.all([
      WholesaleOrder.find({ supplier: userId }).sort({ createdAt: -1 }).lean(),
      VendorWallet.findOne({ vendor: userId }).lean(),
      Payout.find({ vendor: userId, status: "PAID" }).sort({ processedAt: -1 }).limit(1).lean(),
      Payout.find({ vendor: userId, status: { $in: pendingPayoutStatuses } }).select("amount").lean(),
    ]);
    const now = new Date();
    const monthAgo = new Date(now);
    monthAgo.setDate(monthAgo.getDate() - 30);
    const availableOrders = orders.filter((order) => order.status !== "PENDING_PAYMENT" && order.status !== "CANCELLED");
    const grossSales = availableOrders.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0);
    const escrowHeld = orders
      .filter((order) => countedOrderStatuses.includes(order.status) && order.status !== "CONFIRMED_RELEASED")
      .reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0);
    const releasedRecent = orders.filter((order) =>
      order.status === "CONFIRMED_RELEASED" && new Date(order.confirmedAt || order.updatedAt) >= monthAgo,
    );
    const currentPeriod = analyticsFor(availableOrders, "30d", monthAgo, now);
    const previousStart = new Date(monthAgo);
    previousStart.setDate(previousStart.getDate() - 30);
    const previousPeriod = analyticsFor(availableOrders, "30d", previousStart, new Date(monthAgo.getTime() - 1));
    const lastPayout = payouts[0];
    return res.json({
      summary: {
        grossSales,
        commission: 0,
        netEarnings: grossSales,
        escrowHeld,
        availablePayout: wallet?.availableBalance || 0,
        pendingPayouts: pendingPayouts.reduce((sum, payout) => sum + (Number(payout.amount) || 0), 0),
        commissionRate: 0,
        salesDelta: previousPeriod.grossSales === 0 ? 0 : (currentPeriod.grossSales - previousPeriod.grossSales) / previousPeriod.grossSales,
        earningsDelta: previousPeriod.netEarnings === 0 ? 0 : (currentPeriod.netEarnings - previousPeriod.netEarnings) / previousPeriod.netEarnings,
        series: currentPeriod.series,
        lastPayoutAt: lastPayout?.processedAt || null,
        releasedThisPeriod: releasedRecent.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0),
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getFinanceLedger = async (req, res) => {
  try {
    const limit = limitFrom(req.query, 50, 200);
    const kind = req.query.kind ? String(req.query.kind).toUpperCase() : null;
    const [orders, payouts] = await Promise.all([
      WholesaleOrder.find({ supplier: req.user._id }).sort({ createdAt: -1 }).lean(),
      Payout.find({ vendor: req.user._id }).sort({ createdAt: -1 }).lean(),
    ]);
    const rows = ledgerOrderEntries(orders);
    for (const payout of payouts) {
      rows.push({
        _id: payout._id,
        at: payout.processedAt || payout.createdAt,
        kind: "PAYOUT",
        amount: payout.amount,
        description: `Payout to ${payout.payoutDetails?.bankName || payout.payoutMethod}`,
        method: payout.payoutMethod,
        payoutMethod: payout.payoutMethod,
        payoutStatus: payout.status,
      });
    }
    const entries = rows
      .filter((entry) => !kind || entry.kind === kind)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, limit);
    return res.json({ entries });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getPayouts = async (req, res) => {
  try {
    const payouts = await Payout.find({ vendor: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limitFrom(req.query, 30))
      .lean();
    return res.json({ payouts: payouts.map(payoutJson) });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.requestPayout = async (req, res) => {
  const amount = Number(req.body.amount);
  const destination = String(req.body.destination || "").trim();
  const method = String(req.body.method || "").toUpperCase();
  const payoutMethod = method === "AIRTEL_MONEY" ? "AIRTEL" : method === "BANK_TRANSFER" ? "BANK" : method === "MTN_MOMO" ? "MOMO" : null;
  if (!Number.isInteger(amount) || amount < payoutMinimum) {
    return res.status(400).json({ message: `Minimum payout is ${payoutMinimum} RWF.` });
  }
  if (!destination) return res.status(400).json({ message: "A payout destination is required." });
  if (!payoutMethod) return res.status(400).json({ message: "Choose a supported payout method." });
  let payoutDestination = destination;
  if (payoutMethod === "MOMO" || payoutMethod === "AIRTEL") {
    const phone = formatRwandanPhone(destination);
    if (!phone || (payoutMethod === "MOMO" && phone.provider !== "MTN") ||
        (payoutMethod === "AIRTEL" && phone.provider !== "AIRTEL")) {
      return res.status(400).json({ message: "The mobile number does not match the selected payout method." });
    }
    payoutDestination = phone.formattedNumber;
  }

  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      const wallet = await VendorWallet.findOneAndUpdate(
        { vendor: req.user._id, availableBalance: { $gte: amount } },
        { $inc: { availableBalance: -amount } },
        { new: true, session },
      );
      if (!wallet) {
        const current = await VendorWallet.findOne({ vendor: req.user._id }).session(session);
        const available = current?.availableBalance || 0;
        const error = new Error(`Insufficient available balance. Available: ${available} RWF.`);
        error.statusCode = 400;
        throw error;
      }
      const [payout] = await Payout.create([{
        vendor: req.user._id,
        payoutNumber: `SUP-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
        amount,
        payoutMethod,
        payoutDetails: {
          accountName: req.user.Fullname,
          accountNumber: payoutDestination,
          bankName: payoutMethod === "MOMO" ? "MTN MoMo" : payoutMethod === "AIRTEL" ? "Airtel Money" : "Bank transfer",
        },
        status: "PENDING",
        note: String(req.body.note || "").trim(),
      }], { session });
      created = payout;
    });
    return res.status(201).json({ payout: payoutJson(created) });
  } catch (error) {
    return sendError(res, error);
  } finally {
    await session.endSession();
  }
};

exports.getAnalytics = async (req, res) => {
  try {
    const { range, start, end } = analyticsWindow(String(req.query.range || "30d"));
    const orders = await WholesaleOrder.find({
      supplier: req.user._id,
      status: { $nin: ["PENDING_PAYMENT", "CANCELLED"] },
      createdAt: { $gte: new Date(start.getTime() - (end.getTime() - start.getTime())), $lte: end },
    })
      .populate({ path: "items.product", select: "name category", populate: { path: "category", select: "name title" } })
      .lean();
    return res.json({ analytics: analyticsFor(orders, range, start, end) });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getDeliveries = async (req, res) => {
  try {
    const orders = await WholesaleOrder.find({
      supplier: req.user._id,
      status: { $nin: ["PENDING_PAYMENT", "CANCELLED"] },
    })
      .populate("vendor", "Fullname companyName")
      .sort({ createdAt: -1 })
      .limit(limitFrom(req.query, 40))
      .lean();
    return res.json({ deliveries: orders.map(shipmentJson) });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getSettlements = async (req, res) => {
  try {
    const orders = await WholesaleOrder.find({
      supplier: req.user._id,
      status: { $nin: ["PENDING_PAYMENT", "CANCELLED"] },
    }).sort({ createdAt: -1 }).limit(limitFrom(req.query, 60)).lean();
    const settlements = [];
    for (const order of orders) {
      settlements.push({
        _id: `${order._id}-hold`,
        at: order.createdAt,
        kind: "ESCROW_HOLD",
        amount: order.totalAmount,
        description: `Held for ${order.orderNumber}`,
        orderNumber: order.orderNumber,
      });
      if (order.status === "CONFIRMED_RELEASED") {
        const settledAt = order.confirmedAt || order.updatedAt;
        settlements.push({
          _id: `${order._id}-release`,
          at: settledAt,
          kind: "ESCROW_RELEASE",
          amount: order.totalAmount,
          description: `Released for ${order.orderNumber}`,
          orderNumber: order.orderNumber,
          expectedAt: settledAt,
          settledAt,
        });
      } else if (order.status === "DISPUTED") {
        settlements.push({
          _id: `${order._id}-release`,
          at: order.updatedAt,
          kind: "ESCROW_RELEASE",
          amount: order.totalAmount,
          description: `Release paused for ${order.orderNumber} while the dispute is reviewed`,
          orderNumber: order.orderNumber,
        });
      }
    }
    return res.json({ settlements });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getDeliverySummary = async (req, res) => {
  try {
    const orders = await WholesaleOrder.find({
      supplier: req.user._id,
      status: { $nin: ["PENDING_PAYMENT", "CANCELLED"] },
    }).lean();
    const now = new Date();
    const monthAgo = new Date(now);
    monthAgo.setDate(monthAgo.getDate() - 30);
    const delivered = orders.filter((order) => order.status === "CONFIRMED_RELEASED" || order.status === "DELIVERED");
    const released = delivered.filter((order) => new Date(order.confirmedAt || order.updatedAt) >= monthAgo);
    const inEscrow = orders
      .filter((order) => countedOrderStatuses.includes(order.status) && order.status !== "CONFIRMED_RELEASED")
      .reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0);
    return res.json({
      summary: {
        activeShipments: orders.filter((order) => !delivered.includes(order)).length,
        deliveredThisMonth: delivered.filter((order) => new Date(order.deliveredAt || order.confirmedAt || order.updatedAt) >= monthAgo).length,
        inEscrow,
        scheduled: 0,
        releasedThisPeriod: released.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0),
        heldOrders: orders.filter((order) => order.status === "DISPUTED").length,
        onTimeRate: null,
        nextReleaseAt: null,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getSupplyProcess = (_req, res) => res.json({
  steps: [
    { stage: "request", youDo: "Choose the requested goods, quantities and required date.", mvecDoes: "Records the request for supplier operations review.", timeframe: "About 2 minutes" },
    { stage: "review", youDo: "Provide details requested by the category manager.", mvecDoes: "Reviews availability and request details.", timeframe: "Pending review" },
    { stage: "approval", youDo: "Review the quote before accepting it.", mvecDoes: "Provides pricing and terms when available.", timeframe: "Pending review" },
    { stage: "sourcing", youDo: "Coordinate sourcing details with MVEC.", mvecDoes: "Updates the request as it is processed.", timeframe: "Depends on availability" },
    { stage: "dispatch", youDo: "Confirm when the delivery can be received.", mvecDoes: "Updates dispatch information when available.", timeframe: "Depends on fulfilment" },
    { stage: "receiving", youDo: "Inspect and confirm receipt of the goods.", mvecDoes: "Records the completed supply request.", timeframe: "After delivery" },
  ],
});

exports.getSupplyRequests = async (req, res) => {
  try {
    const supplier = await findSupplier(req.user._id);
    const requests = await SupplierSupplyRequest.find({ supplier: supplier._id })
      .sort({ createdAt: -1 })
      .limit(limitFrom(req.query, 40))
      .lean();
    return res.json({ requests });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.createSupplyRequest = async (req, res) => {
  try {
    const supplier = await findSupplier(req.user._id);
    const { lines, neededBy } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ message: "Add at least one item to the request." });
    }
    const neededDate = new Date(neededBy);
    if (!neededBy || Number.isNaN(neededDate.getTime()) || neededDate < new Date(new Date().setHours(0, 0, 0, 0))) {
      return res.status(400).json({ message: "Choose a valid needed-by date from today onwards." });
    }
    for (const line of lines) {
      if (!String(line.product || "").trim() || !Number.isInteger(Number(line.units)) || Number(line.units) < 1 ||
          !Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0 || !String(line.unit || "").trim()) {
        return res.status(400).json({ message: "Each request line needs an item, positive quantity, unit, and non-negative unit price." });
      }
    }
    const createdAt = new Date();
    const request = await SupplierSupplyRequest.create({
      supplier: supplier._id,
      reference: `SR-${Date.now()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
      lines,
      neededBy: neededDate,
      note: String(req.body.note || "").trim(),
      events: [{ at: createdAt, title: "Request submitted", detail: "Submitted by the supplier for review." }],
    });
    return res.status(201).json({ request });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.cancelSupplyRequest = async (req, res) => {
  try {
    const supplier = await findSupplier(req.user._id);
    const request = await SupplierSupplyRequest.findOne({ _id: req.params.id, supplier: supplier._id });
    if (!request) return res.status(404).json({ message: "Supply request not found." });
    if (!["SUBMITTED", "UNDER_REVIEW", "SOURCING"].includes(request.status)) {
      return res.status(409).json({ message: `A ${request.status.toLowerCase()} request cannot be withdrawn.` });
    }
    const reason = String(req.body.reason || "").trim();
    request.status = "CANCELLED";
    request.decision = reason || "Withdrawn by the supplier.";
    request.events.push({ title: "Request withdrawn", detail: reason || "Withdrawn by the supplier." });
    await request.save();
    return res.json({ request });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.resubmitSupplyRequest = async (req, res) => {
  try {
    const supplier = await findSupplier(req.user._id);
    const previous = await SupplierSupplyRequest.findOne({ _id: req.params.id, supplier: supplier._id });
    if (!previous) return res.status(404).json({ message: "Supply request not found." });
    if (previous.status !== "CANCELLED") {
      return res.status(409).json({ message: "Only withdrawn requests can be resubmitted." });
    }
    const now = new Date();
    const request = await SupplierSupplyRequest.create({
      supplier: supplier._id,
      reference: `SR-${Date.now()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
      lines: previous.lines,
      neededBy: previous.neededBy,
      note: previous.note,
      events: [{ at: now, title: "Request resubmitted", detail: `Resubmitted from ${previous.reference}.` }],
    });
    return res.status(201).json({ request });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.adminGetSupplyRequests = async (req, res) => {
  try {
    const requests = await SupplierSupplyRequest.find()
      .populate({ path: "supplier", select: "businessName user", populate: { path: "user", select: "Fullname email" } })
      .sort({ createdAt: -1 })
      .limit(limitFrom(req.query, 50))
      .lean();
    return res.json({ requests });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.adminUpdateSupplyRequest = async (req, res) => {
  try {
    const request = await SupplierSupplyRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Supply request not found." });
    const transitions = {
      SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
      UNDER_REVIEW: ["APPROVED", "REJECTED"],
      APPROVED: ["SOURCING", "IN_TRANSIT"],
      SOURCING: ["IN_TRANSIT", "REJECTED"],
      IN_TRANSIT: ["RECEIVED"],
      RECEIVED: [],
      REJECTED: [],
      CANCELLED: [],
    };
    const status = String(req.body.status || "").toUpperCase();
    if (!transitions[request.status]?.includes(status)) {
      return res.status(409).json({ message: `Cannot change a ${request.status} request to ${status || "an unspecified status"}.` });
    }
    const decision = String(req.body.decision || "").trim();
    request.status = status;
    if (decision) request.decision = decision;
    request.events.push({
      title: `Request ${status.toLowerCase().replaceAll("_", " ")}`,
      detail: decision || "Updated by supplier operations.",
    });
    await request.save();
    return res.json({ request });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.adminGetPayouts = async (req, res) => {
  try {
    const supplierUserIds = await Supplier.distinct("user");
    const payouts = await Payout.find({
      vendor: { $in: supplierUserIds },
      status: { $in: pendingPayoutStatuses },
    })
      .sort({ createdAt: 1 })
      .limit(limitFrom(req.query, 50))
      .lean();
    return res.json({ payouts: payouts.map(payoutJson) });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.adminUpdatePayout = async (req, res) => {
  const status = String(req.body.status || "").toUpperCase();
  if (!["PROCESSING", "PAID", "REJECTED", "FAILED"].includes(status)) {
    return res.status(400).json({ message: "Choose PROCESSING, PAID, REJECTED, or FAILED." });
  }
  const session = await mongoose.startSession();
  try {
    let updated;
    await session.withTransaction(async () => {
      const payout = await Payout.findById(req.params.id).session(session);
      if (!payout || !payout.payoutNumber.startsWith("SUP-")) {
        const error = new Error("Supplier payout request not found.");
        error.statusCode = 404;
        throw error;
      }
      if (!pendingPayoutStatuses.includes(payout.status)) {
        const error = new Error(`A ${payout.status} payout cannot be updated.`);
        error.statusCode = 409;
        throw error;
      }
      if (status === "PROCESSING" && payout.status !== "PENDING") {
        const error = new Error("Only pending payouts can move to processing.");
        error.statusCode = 409;
        throw error;
      }
      if (status === "PAID") {
        await VendorWallet.updateOne(
          { vendor: payout.vendor },
          { $inc: { totalWithdrawn: payout.amount } },
          { session },
        );
        payout.processedAt = new Date();
      } else if (status === "REJECTED" || status === "FAILED") {
        await VendorWallet.updateOne(
          { vendor: payout.vendor },
          { $inc: { availableBalance: payout.amount } },
          { session },
        );
        payout.rejectionReason = String(req.body.reason || "").trim();
      }
      payout.status = status;
      await payout.save({ session });
      updated = payout;
    });
    return res.json({ payout: payoutJson(updated) });
  } catch (error) {
    return sendError(res, error);
  } finally {
    await session.endSession();
  }
};

exports.getTeam = async (req, res) => {
  try {
    const supplier = await findSupplier(req.user._id);
    const members = await SupplierTeamMember.find({ supplier: supplier._id }).sort({ createdAt: 1 }).lean();
    const owner = {
      _id: req.user._id,
      fullName: req.user.Fullname,
      phone: req.user.phone || supplier.phone,
      email: req.user.email || supplier.email,
      role: "OWNER",
      status: "ACTIVE",
      createdAt: req.user.createdAt,
    };
    return res.json({ members: [owner, ...members] });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getTeamSummary = async (req, res) => {
  try {
    const supplier = await findSupplier(req.user._id);
    const members = await SupplierTeamMember.find({ supplier: supplier._id }).lean();
    const all = [{ role: "OWNER", status: "ACTIVE" }, ...members];
    return res.json({
      summary: {
        total: all.length,
        active: all.filter((member) => member.status === "ACTIVE").length,
        invited: all.filter((member) => member.status === "INVITED").length,
        suspended: all.filter((member) => member.status === "SUSPENDED").length,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.addTeamMember = async (req, res) => {
  try {
    const supplier = await findSupplier(req.user._id);
    const fullName = String(req.body.fullName || "").trim();
    const phone = String(req.body.phone || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = req.body.password;
    const role = String(req.body.role || "VIEWER").toUpperCase();
    const allowedRoles = ["OPERATIONS", "WAREHOUSE", "FULFILMENT", "FINANCE", "VIEWER"];
    if (!fullName || !phone || !email || typeof password !== "string") return res.status(400).json({ message: "Full name, phone, email, and password are required." });
    if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters." });
    if (!allowedRoles.includes(role)) return res.status(400).json({ message: "Choose a supported staff role." });
    if (await User.findOne({ email })) return res.status(409).json({ message: "An account with this email already exists." });
    const user = await User.create({ Fullname: fullName, email, phone, password: await bcrypt.hash(password, 10), gender: "other", role: "supplier", isSupplierStaff: true, status: "ACTIVE" });
    const member = await SupplierTeamMember.create({
      supplier: supplier._id,
      user: user._id,
      fullName,
      phone,
      email,
      role,
      note: String(req.body.note || "").trim(),
    });
    return res.status(201).json({ member: { ...member.toObject(), user: user._id } });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.updateTeamMember = async (req, res) => {
  try {
    const supplier = await findSupplier(req.user._id);
    const member = await SupplierTeamMember.findOne({ _id: req.params.memberId, supplier: supplier._id });
    if (!member) return res.status(404).json({ message: "Team member not found." });
    const allowedRoles = ["OPERATIONS", "WAREHOUSE", "FULFILMENT", "FINANCE", "VIEWER"];
    const allowedStatuses = ["ACTIVE", "INVITED", "SUSPENDED"];
    let userFieldsToSync = {};
    if (req.body.role !== undefined) {
      const role = String(req.body.role).toUpperCase();
      if (!allowedRoles.includes(role)) return res.status(400).json({ message: "Choose a supported staff role." });
      member.role = role;
    }
    if (req.body.status !== undefined) {
      const status = String(req.body.status).toUpperCase();
      if (!allowedStatuses.includes(status)) return res.status(400).json({ message: "Choose a supported staff status." });
      member.status = status;
    }
    for (const field of ["fullName", "phone", "email", "note"]) {
      if (req.body[field] !== undefined) {
        member[field] = String(req.body[field]).trim();
        if (field === "fullName") userFieldsToSync.Fullname = member[field];
        if (field === "phone") userFieldsToSync.phone = member[field];
        if (field === "email") userFieldsToSync.email = member[field];
      }
    }
    await member.save();
    // Keep the linked User account in sync for profile changes. Only the
    // standard status values may be written to User.status — SUSPEND/BLOCK are
    // reserved for platform admins and must never be set by a supplier.
    if (member.user) await User.findByIdAndUpdate(member.user, userFieldsToSync);
    return res.json({ member });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.removeTeamMember = async (req, res) => {
  try {
    const supplier = await findSupplier(req.user._id);
    const member = await SupplierTeamMember.findOneAndDelete({ _id: req.params.memberId, supplier: supplier._id });
    if (!member) return res.status(404).json({ message: "Team member not found." });
    return res.json({ message: "Team member removed." });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getReviews = async (req, res) => {
  try {
    const supplier = await findSupplier(req.user._id);
    const reviews = await SupplierReview.find({ supplier: supplier._id })
      .populate("vendor", "Fullname companyName")
      .populate("wholesaleOrder", "orderNumber")
      .sort({ createdAt: -1 })
      .limit(limitFrom(req.query, 50))
      .lean();
    return res.json({
      reviews: reviews.map((review) => ({
        _id: review._id,
        author: review.vendor?.companyName || review.vendor?.Fullname || "Vendor",
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
        orderNumber: review.wholesaleOrder?.orderNumber,
        reply: review.reply || null,
      })),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.createSupplierReview = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.supplierId);
    if (!supplier) return res.status(404).json({ message: "Supplier not found." });
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be a whole number from 1 to 5." });
    }
    const order = await WholesaleOrder.findOne({
      supplier: supplier.user,
      vendor: req.user._id,
      status: { $in: reviewableOrderStatuses },
    }).sort({ confirmedAt: -1, updatedAt: -1 });
    if (!order) return res.status(403).json({ message: "A completed wholesale order is required to review this supplier." });
    const review = await SupplierReview.create({
      supplier: supplier._id,
      vendor: req.user._id,
      wholesaleOrder: order._id,
      rating,
      comment: String(req.body.comment || "").trim(),
    });
    const aggregate = await SupplierReview.aggregate([
      { $match: { supplier: supplier._id } },
      { $group: { _id: null, average: { $avg: "$rating" } } },
    ]);
    supplier.ratingAvg = aggregate[0]?.average || 0;
    await supplier.save();
    return res.status(201).json({
      review: {
        _id: review._id,
        author: req.user.companyName || req.user.Fullname,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
        orderNumber: order.orderNumber,
        reply: review.reply || null,
      },
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "You have already reviewed this completed supplier order." });
    return sendError(res, error);
  }
};
