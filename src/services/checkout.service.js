const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { normalizePhone } = require("../utils/sms.util");
const { effectivePrice } = require("../utils/pricing.util");
const affiliateAttribution = require("./affiliateAttribution.service");
const { PROVINCES, DELIVERY_METHODS, computeShippingFee } = require("../config/delivery");
const shippingService = require("./shipping.service");

const MAX_QTY_PER_LINE = 100;
const PAYMENT_METHODS = ["MOMO", "AIRTEL"];

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const clean = (value, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const generateOrderNumber = () => `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
const generateDeliveryOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

/**
 * Validate and normalise the delivery details sent by the checkout form.
 * Accepts the current shape ({ street, district, sector, province }) and the
 * legacy one ({ street, city, state }) so older clients keep working.
 */
function parseDelivery({ shippingAddress = {}, recipient = {}, deliveryMethod }) {
  const street = clean(shippingAddress.street || shippingAddress.address);
  const district = clean(shippingAddress.district || shippingAddress.city, 80);
  const sector = clean(shippingAddress.sector, 80);
  const province = clean(shippingAddress.province || shippingAddress.state, 80) || "Kigali City";

  if (street.length < 3) throw httpError(400, "Please enter your street or a nearby landmark.");
  if (!district) throw httpError(400, "Please enter your district.");
  if (!PROVINCES.includes(province)) throw httpError(400, "Please choose a valid province.");

  const method = DELIVERY_METHODS.includes(deliveryMethod) ? deliveryMethod : "standard";

  const name = clean(recipient.name, 120);
  if (name.length < 2) throw httpError(400, "Please enter the name of the person receiving the order.");
  const phone = normalizePhone(recipient.phone);
  if (!phone) throw httpError(400, "Please enter a valid Rwandan phone number for delivery (e.g. 0788123456).");
  const email = clean(recipient.email, 160).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Please enter a valid email address or leave it empty.");

  return {
    shippingAddress: {
      street,
      city: district,
      sector: sector || undefined,
      province,
      state: province,
      country: "Rwanda",
      postalCode: clean(shippingAddress.postalCode, 20) || undefined,
    },
    recipient: { name, phone, email: email || undefined },
    deliveryMethod: method,
    shippingFee: computeShippingFee({ province, method }),
  };
}

/**
 * Merge duplicate product lines and validate quantities.
 * @param {{productId: string, quantity: number}[]} rawLines
 */
function normaliseLines(rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw httpError(400, "Your cart is empty.");
  const merged = new Map();
  for (const line of rawLines) {
    const productId = String(line?.productId || "");
    if (!mongoose.isValidObjectId(productId)) throw httpError(400, "Every checkout item must reference a valid product.");
    const qty = Number(line.quantity ?? line.qty);
    if (!Number.isInteger(qty) || qty < 1) throw httpError(400, "Product quantity must be a positive whole number.");
    merged.set(productId, (merged.get(productId) || 0) + qty);
  }
  for (const qty of merged.values()) {
    if (qty > MAX_QTY_PER_LINE) throw httpError(400, `You can order at most ${MAX_QTY_PER_LINE} units of a product at once.`);
  }
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

async function restoreStock(lines) {
  for (const { product, quantity } of lines) {
    await Product.updateOne({ _id: product }, { $inc: { stockQuantity: quantity } });
    await Product.updateOne(
      { _id: product, status: "OUT_OF_STOCK", stockQuantity: { $gt: 0 } },
      { $set: { status: "ACTIVE" } }
    );
  }
}

/**
 * Decrement stock atomically. Each update only succeeds when enough stock is
 * left, so two buyers can never both take the last unit. If any line fails,
 * the lines already reserved are put back.
 */
async function reserveStock(lines) {
  const reserved = [];
  try {
    for (const line of lines) {
      const updated = await Product.findOneAndUpdate(
        { _id: line.product, status: "ACTIVE", stockQuantity: { $gte: line.quantity } },
        { $inc: { stockQuantity: -line.quantity } },
        { new: true }
      );
      if (!updated) {
        throw httpError(409, `${line.name} is no longer available in the quantity you selected. Please update your cart.`);
      }
      reserved.push(line);
      if (updated.stockQuantity <= 0) {
        await Product.updateOne(
          { _id: updated._id, stockQuantity: { $lte: 0 } },
          { $set: { status: "OUT_OF_STOCK", stockQuantity: 0 } }
        );
      }
    }
  } catch (error) {
    await restoreStock(reserved);
    throw error;
  }
}

/**
 * Create a PENDING order for a buyer from product lines. Prices, shipping and
 * totals are computed here, never trusted from the client.
 */
async function createOrder({ userId, lines: rawLines, delivery, paymentMethod, visitorId }) {
  const parsed = parseDelivery(delivery);
  const lines = normaliseLines(rawLines);

  const products = await Product.find({ _id: { $in: lines.map((l) => l.productId) } });
  const byId = new Map(products.map((p) => [p._id.toString(), p]));

  const orderItems = [];
  let subtotal = 0;
  for (const { productId, quantity } of lines) {
    const product = byId.get(productId);
    if (!product || product.status !== "ACTIVE") {
      throw httpError(400, `${product?.name || "A product in your order"} is no longer available.`);
    }
    if (product.vendor && product.vendor.toString() === String(userId)) {
      throw httpError(403, "You cannot buy your own product.");
    }
    if (product.stockQuantity < quantity) {
      throw httpError(400, `Only ${product.stockQuantity} of ${product.name} left in stock.`);
    }
    const price = effectivePrice(product);
    subtotal += price * quantity;
    orderItems.push({
      product: product._id,
      vendor: product.vendor || null,
      category: product.category || undefined,
      name: product.name,
      price,
      quantity,
      image: product.media?.mainImage || "",
    });
  }

  // Delivery fee per seller store from the seller's shipping zones (falling
  // back to the platform defaults, which equal config/delivery.js).
  const quote = await shippingService.quoteShipping({
    lines: orderItems
      .filter((i) => i.vendor)
      .map((i) => ({ product: byId.get(String(i.product)), quantity: i.quantity, price: i.price })),
    address: parsed.shippingAddress,
    method: parsed.deliveryMethod === "express" ? "EXPRESS" : "STANDARD",
  });
  if (!quote.deliverable) {
    throw httpError(400, quote.groups.filter((g) => !g.deliverable).map((g) => g.message).join(" "));
  }
  const shippingFee = quote.groups.length ? quote.shippingFee : parsed.shippingFee;

  // Last-click affiliate attribution, resolved from server-side click records
  // (never from client-supplied affiliate data).
  const attributions = await affiliateAttribution.resolveAttributions({
    visitorId,
    buyerId: userId,
    productIds: orderItems.map((i) => i.product),
  });
  orderItems.forEach((i) => affiliateAttribution.applyAttribution(i, attributions.get(String(i.product))));

  const stockLines = orderItems.map((i) => ({ product: i.product, quantity: i.quantity, name: i.name }));
  await reserveStock(stockLines);

  try {
    return await Order.create({
      user: userId,
      orderNumber: generateOrderNumber(),
      items: orderItems,
      shippingAddress: parsed.shippingAddress,
      recipient: parsed.recipient,
      deliveryMethod: parsed.deliveryMethod,
      subtotal,
      shippingFee,
      shippingMethod: quote.method,
      shippingBreakdown: quote.groups.map((g) => ({
        vendor: g.vendor, store: g.store, storeName: g.storeName, zone: g.zone, zoneName: g.zoneName,
        method: g.method, fee: g.fee, eta: g.eta,
      })),
      totalAmount: subtotal + shippingFee,
      paymentMethod: PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : "MOMO",
      paymentStatus: "PENDING",
      orderStatus: "PENDING",
      deliveryOtp: generateDeliveryOtp(),
    });
  } catch (error) {
    await restoreStock(stockLines);
    throw error;
  }
}

module.exports = {
  createOrder,
  restoreStock,
  generateDeliveryOtp,
  httpError,
};
