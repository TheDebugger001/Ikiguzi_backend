const mongoose = require("mongoose");
const crypto = require("crypto");
const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const shippingService = require("../services/shipping.service");
const socketService = require("../services/socket.service");

const PAYMENT_MODES = ["LINK", "COD", "PAID_OFFLINE"];
const OFFLINE_METHODS = ["CASH", "MOMO", "BANK"];

const generateOrderNumber = () => `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

// Rwandan numbers in their common forms (07…, 2507…, +2507…) -> 2507XXXXXXXX
const normalizePhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (/^07\d{8}$/.test(digits)) return `25${digits}`;
  if (/^2507\d{8}$/.test(digits)) return digits;
  return digits || null;
};

// Existing MVEC buyer account matching the customer's phone or email.
const findCustomerAccount = async ({ phone, email }) => {
  const norm = normalizePhone(phone);
  const or = [];
  if (email) or.push({ email: String(email).trim().toLowerCase() });
  if (norm) {
    const local = norm.startsWith("250") ? `0${norm.slice(3)}` : norm;
    or.push({ phone: { $in: [norm, `+${norm}`, local] } });
  }
  if (!or.length) return null;
  return User.findOne({ $or: or, role: "buyer" }).select("_id Fullname email phone");
};

// @desc    Seller records an order taken outside the online checkout.
// @route   POST /api/orders/vendor/manual
// @body    { customer:{name,phone,email}, items:[{productId, qty, price?}],
//            shippingAddress:{province,district,sector,street}, shippingMethod: STANDARD|EXPRESS|PICKUP,
//            deliveryFee? (override), payment: LINK|COD|PAID_OFFLINE, offlineMethod?: CASH|MOMO|BANK, note? }
// @access  Private (vendor)
exports.createManualOrder = async (req, res) => {
  const reserved = [];
  try {
    const { customer = {}, items, shippingAddress = {}, shippingMethod = "STANDARD", deliveryFee, payment = "COD", offlineMethod, note = "" } = req.body;
    const vendorId = req.vendorId || req.targetVendorId || req.user.id;
    const owners = [...new Set([String(req.user.id), String(vendorId)])];

    // 1. Validate input
    const name = String(customer.name || "").trim();
    const phone = String(customer.phone || "").trim();
    if (!name || !phone) return res.status(400).json({ message: "Customer name and phone are required." });
    if (!PAYMENT_MODES.includes(payment)) return res.status(400).json({ message: "Choose how the customer pays." });
    if (payment === "PAID_OFFLINE" && !OFFLINE_METHODS.includes(offlineMethod)) {
      return res.status(400).json({ message: "Choose how the customer paid: cash, MoMo or bank." });
    }
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ message: "Add at least one product." });

    const method = ["STANDARD", "EXPRESS", "PICKUP"].includes(shippingMethod) ? shippingMethod : "STANDARD";
    const isPickup = method === "PICKUP";
    if (!isPickup && (!shippingAddress.district || !shippingAddress.street)) {
      return res.status(400).json({ message: "Enter the delivery district and street, or choose pickup." });
    }

    // 2. Products: must be the seller's own, available and in stock
    const qtyById = new Map();
    for (const item of items) {
      const qty = Number(item.qty || item.quantity);
      if (!mongoose.isValidObjectId(item.productId) || !Number.isInteger(qty) || qty < 1) {
        return res.status(400).json({ message: "Every line needs a product and a whole quantity of at least 1." });
      }
      qtyById.set(String(item.productId), (qtyById.get(String(item.productId)) || 0) + qty);
    }
    const products = await Product.find({ _id: { $in: [...qtyById.keys()] }, vendor: { $in: owners } });
    if (products.length !== qtyById.size) return res.status(400).json({ message: "Only your own products can be added." });
    const byId = Object.fromEntries(products.map((p) => [String(p._id), p]));

    const orderItems = [];
    const lines = [];
    for (const item of items) {
      const product = byId[String(item.productId)];
      if (product.status === "INACTIVE") return res.status(400).json({ message: `${product.name} is inactive.` });
      const listPrice = product.discountPrice || product.price;
      const price = item.price === undefined || item.price === null || item.price === "" ? listPrice : Math.round(Number(item.price));
      if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: `Enter a valid price for ${product.name}.` });
      const qty = Number(item.qty || item.quantity);
      orderItems.push({ product: product._id, vendor: product.vendor, category: product.category, name: product.name, price, quantity: qty, image: product.media?.mainImage || "" });
      lines.push({ product, quantity: qty, price });
    }
    const subtotal = orderItems.reduce((s, i) => s + i.price * i.quantity, 0);

    // 3. Delivery: seller's zones, a manual fee, or pickup
    let shippingBreakdown;
    let address;
    const overrideFee = deliveryFee === undefined || deliveryFee === null || deliveryFee === "" ? null : Math.round(Number(deliveryFee));
    if (overrideFee !== null && (!Number.isFinite(overrideFee) || overrideFee < 0)) {
      return res.status(400).json({ message: "Enter a valid delivery fee." });
    }
    if (isPickup) {
      shippingBreakdown = [{ vendor: vendorId, method: "PICKUP", fee: overrideFee || 0, zoneName: "Pickup", eta: "Customer pickup" }];
      address = { street: shippingAddress.street || "Store pickup", city: shippingAddress.district || "Pickup", state: shippingAddress.province || "Pickup", country: "Rwanda" };
    } else {
      const quote = await shippingService.quoteShipping({ lines, address: shippingAddress, method });
      if (!quote.deliverable && overrideFee === null) {
        return res.status(400).json({ message: `${quote.groups.find((g) => !g.deliverable)?.message} Enter a delivery fee manually or choose pickup.` });
      }
      shippingBreakdown = quote.groups.map((g) => ({
        vendor: g.vendor, store: g.store, storeName: g.storeName, zone: g.zone, zoneName: overrideFee !== null ? "Set by seller" : g.zoneName,
        method: g.method || method, fee: g.fee, eta: g.eta,
      }));
      // A manual fee replaces the zone fees (charged once, on the first parcel).
      if (overrideFee !== null) shippingBreakdown = shippingBreakdown.map((p, i) => ({ ...p, fee: i === 0 ? overrideFee : 0 }));
      address = {
        street: shippingAddress.street,
        city: quote.address.district || shippingAddress.district,
        state: quote.address.province || shippingAddress.province,
        province: quote.address.province || shippingAddress.province,
        district: quote.address.district || shippingAddress.district,
        sector: shippingAddress.sector || "",
        country: "Rwanda",
      };
    }
    const shippingFee = shippingBreakdown.reduce((s, p) => s + (p.fee || 0), 0);

    // 4. Customer account (needed for a payment link)
    const account = await findCustomerAccount({ phone, email: customer.email });
    if (payment === "LINK" && !account) {
      return res.status(400).json({ message: "No MVEC account matches this phone or email, so a payment link can't be sent. Use cash on delivery or record a payment you already received." });
    }

    // 5. Reserve stock atomically
    for (const [productId, qty] of qtyById) {
      const updated = await Product.findOneAndUpdate(
        { _id: productId, stockQuantity: { $gte: qty } },
        { $inc: { stockQuantity: -qty } },
        { new: true }
      );
      if (!updated) {
        const p = byId[productId];
        throw Object.assign(new Error(`Only ${p.stockQuantity} units of ${p.name} are in stock.`), { status: 409 });
      }
      reserved.push([productId, qty]);
      if (updated.stockQuantity <= 0) await Product.updateOne({ _id: productId }, { $set: { status: "OUT_OF_STOCK", stockQuantity: 0 } });
    }

    // 6. Create the order
    const paidOffline = payment === "PAID_OFFLINE";
    const order = await Order.create({
      user: account?._id,
      source: "MANUAL",
      customer: { name, phone, email: customer.email ? String(customer.email).trim().toLowerCase() : undefined },
      createdBy: req.user._id,
      orderNumber: generateOrderNumber(),
      items: orderItems,
      shippingAddress: address,
      subtotal,
      shippingFee,
      shippingMethod: method,
      shippingBreakdown,
      totalAmount: subtotal + shippingFee,
      paymentMethod: paidOffline ? (offlineMethod === "BANK" ? "BANK" : offlineMethod === "MOMO" ? "MOMO" : "CASH") : payment === "COD" ? "CASH_ON_DELIVERY" : "MOMO",
      paymentStatus: paidOffline ? "PAID" : "PENDING",
      orderStatus: payment === "LINK" ? "PENDING" : "CONFIRMED",
      paidOffline,
      offlinePaymentMethod: paidOffline ? offlineMethod : null,
      sellerNote: String(note).slice(0, 500),
      deliveryOtp: crypto.randomInt(100000, 1000000).toString(),
    });

    socketService.emitOrderCreated(order);

    return res.status(201).json({
      message: `Order ${order.orderNumber} created${account ? ` and linked to ${account.Fullname || "the customer's account"}` : ""}.`,
      order,
      linkedAccount: !!account,
      paymentLink: payment === "LINK" ? `/payment/${order._id}` : null,
    });
  } catch (error) {
    // Give back any stock reserved before the failure.
    for (const [productId, qty] of reserved) {
      await Product.updateOne({ _id: productId }, { $inc: { stockQuantity: qty } }).catch(() => {});
      await Product.updateOne({ _id: productId, status: "OUT_OF_STOCK", stockQuantity: { $gt: 0 } }, { $set: { status: "ACTIVE" } }).catch(() => {});
    }
    return res.status(error.status || 500).json({ message: error.message });
  }
};

exports.normalizePhone = normalizePhone;
