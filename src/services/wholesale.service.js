const crypto = require("crypto");
const mongoose = require("mongoose");
const WholesaleOrder = require("../models/WholesaleOrder");
const VendorWallet = require("../models/VendorWallet");
const Supplier = require("../models/Supplier");
const WholesaleProduct = require("../models/WholesaleProduct");
const Notification = require("../models/Notification");
const { computeRevenueSplit } = require("../config/revenueSplit");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function otpKey() {
  if (process.env.OTP_ENCRYPTION_KEY) {
    return crypto.createHash("sha256").update(process.env.OTP_ENCRYPTION_KEY).digest();
  }
  return crypto.createHash("sha256")
    .update(`${process.env.JWT_SECRET || "mvec"}:wholesale-otp`)
    .digest();
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", otpKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

function decryptSecret(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed secret payload.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", otpKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

function constantTimeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), "hex");
  const bufB = Buffer.from(String(b), "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

// Platform fee on wholesale orders. Commission is booked on release; the
// supplier is credited with `net` and the platform keeps `commission`.
function wholesaleSplit(totalAmount) {
  const split = computeRevenueSplit({ grossTotal: totalAmount, hasAffiliate: false, gatewayFee: 0 });
  return {
    commissionAmount: Math.round(split.totalPlatformFee),
    netAmount: Math.round(split.vendorNet),
  };
}

async function reserveStock(items, session) {
  for (const item of items) {
    const updated = await WholesaleProduct.findOneAndUpdate(
      { _id: item.product, stockQuantity: { $gte: item.quantity } },
      { $inc: { stockQuantity: -item.quantity } },
      { new: true, session }
    );
    if (!updated) {
      throw new Error(`Insufficient stock for '${item.productName}'.`);
    }
    // Keep 0 stock correctly flagged as OUT_OF_STOCK (the model hook only runs
    // on save paths, so we enforce the invariant here too).
    if (updated.stockQuantity <= 0) {
      await WholesaleProduct.updateOne(
        { _id: updated._id, status: { $ne: "ARCHIVED" } },
        { $set: { status: "OUT_OF_STOCK" } },
        { session }
      );
    }
  }
}

async function restoreStock(items, session) {
  for (const item of items) {
    await WholesaleProduct.updateOne(
      { _id: item.product, status: { $ne: "ARCHIVED" } },
      { $inc: { stockQuantity: item.quantity } },
      { session }
    );
  }
}

async function notify(userId, type, title, message, reference = "") {
  if (!userId) return;
  try {
    await Notification.create({
      recipient: userId,
      type,
      title,
      message,
      reference,
      channel: "IN_APP",
    });
  } catch (error) {
    console.error("Wholesale notification error:", error.message);
  }
}

class WholesaleService {
  /**
   * Validate MOQ and create a B2B wholesale order.
   */
  async createWholesaleOrder({ vendorId, supplierId, items, deliveryDetails = {} }) {
    if (!mongoose.isValidObjectId(supplierId)) {
      throw new Error("Invalid supplier ID provided.");
    }

    const supplier = await Supplier.findOne({
      _id: supplierId,
      status: "ACTIVE",
      verificationStatus: "VERIFIED",
    });
    if (!supplier) {
      throw new Error("Supplier is not active and verified.");
    }
    const supplierUserId = String(supplier.user);

    if (!mongoose.isValidObjectId(vendorId)) {
      throw new Error("Invalid vendor ID provided.");
    }
    // A vendor cannot place an order against their own supplier profile.
    if (String(vendorId) === String(supplierUserId)) {
      throw new Error("You cannot place an order against your own supplier profile.");
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("At least one wholesale product is required.");
    }

    const contactName = String(deliveryDetails?.contactName || "").trim().slice(0, 120);
    const contactPhone = String(deliveryDetails?.contactPhone || "").trim().slice(0, 30);
    const deliveryAddress = String(deliveryDetails?.deliveryAddress || "").trim().slice(0, 300);
    const note = String(deliveryDetails?.note || "").trim().slice(0, 500);

    if (!contactName || !contactPhone || !deliveryAddress) {
      throw new Error("contactName, contactPhone and deliveryAddress are required.");
    }

    // Merge duplicate product lines before validating.
    const merged = new Map();
    for (const item of items) {
      const key = String(item.productId);
      if (!merged.has(key)) {
        merged.set(key, { productId: key, quantity: Number(item.quantity) });
      } else {
        merged.get(key).quantity += Number(item.quantity);
      }
    }

    let totalAmount = 0;
    const validatedItems = [];

    for (const [productId, item] of merged) {
      if (!mongoose.isValidObjectId(productId)) {
        throw new Error(`Invalid product ID supplied. Only real catalog products can be ordered.`);
      }
      const quantity = item.quantity;
      const product = await WholesaleProduct.findOne({
        _id: productId,
        supplier: supplier._id,
        status: "ACTIVE",
      });
      if (!product) {
        throw new Error("A requested item is not an active product from this supplier.");
      }
      if (!Number.isInteger(quantity) || quantity < product.moq) {
        throw new Error(
          `MOQ Breach: Item '${product.name}' requires a minimum quantity of ${product.moq}, but got ${quantity}.`
        );
      }
      if (quantity > product.stockQuantity) {
        throw new Error(
          `Insufficient stock for '${product.name}'. Available: ${product.stockQuantity}.`
        );
      }
      // Bulk discount only applies beyond the minimum order quantity (and only
      // when the supplier opted into a discount by setting bulkDiscount > 0).
      const applyDiscount =
        product.bulkDiscount > 0 && quantity > product.moq && quantity >= product.bulkMinQty;
      const unitPrice = applyDiscount
        ? Math.round(product.wholesalePrice * (1 - product.bulkDiscount / 100))
        : product.wholesalePrice;
      totalAmount += unitPrice * quantity;
      validatedItems.push({
        product: product._id,
        productName: product.name,
        unitPrice,
        quantity,
        moq: product.moq,
      });
    }

    const orderNumber = `WSO-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const otp = generateOtp();

    const order = await WholesaleOrder.create({
      orderNumber,
      vendor: vendorId,
      supplier: supplierUserId,
      items: validatedItems,
      totalAmount: Math.round(totalAmount),
      status: "PENDING_PAYMENT",
      deliveryAddress,
      contactName,
      contactPhone,
      note,
      otpHash: sha256Hex(otp),
      otpCipher: encryptSecret(otp),
      otpAttempts: 0,
      otpLocked: false,
    });

    await notify(
      supplierUserId,
      "SUPPLIER_ORDER",
      "New wholesale order",
      `${order.orderNumber} — ${order.totalAmount.toLocaleString()} RWF`,
      order.orderNumber
    );

    return order;
  }

  async listMyWholesaleOrders({ user, supplier = null }) {
    const isVendor = ["vendor", "super_admin"].includes(user.role);
    const query = isVendor ? { vendor: user._id } : { supplier: supplier?.user || user._id };
    return WholesaleOrder.find(query).sort({ createdAt: -1 }).lean();
  }

  async getWholesaleOrderById({ orderId, user }) {
    const order = await WholesaleOrder.findById(orderId).lean();
    if (!order) throw new Error("Wholesale order not found.");
    const allowed = String(order.vendor) === String(user._id) || String(order.supplier) === String(user._id);
    if (!allowed) throw new Error("Not authorized to view this order.");
    return order;
  }

  /**
   * Mark a wholesale order as shipped (supplier only, from ESCROW_HELD).
   */
  async markWholesaleOrderShipped(orderIdOrOptions, supplierUserIdOrArg) {
    let orderId, supplierUserId, shipment;
    if (typeof orderIdOrOptions === "object" && orderIdOrOptions !== null) {
      ({ orderId, supplierUserId, shipment = {} } = orderIdOrOptions);
    } else {
      orderId = orderIdOrOptions;
      supplierUserId = supplierUserIdOrArg;
      shipment = {};
    }
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const order = await WholesaleOrder.findOneAndUpdate(
        { _id: orderId, supplier: supplierUserId, status: "ESCROW_HELD" },
        {
          $set: {
            status: "SHIPPED",
            shippedAt: new Date(),
            trackingNumber: String(shipment?.trackingNumber || "").trim().slice(0, 80),
            carrier: String(shipment?.carrier || "").trim().slice(0, 80),
            shipNote: String(shipment?.note || "").trim().slice(0, 300),
            expectedDeliveryAt: shipment?.expectedDeliveryAt ? new Date(shipment.expectedDeliveryAt) : null,
          },
        },
        { new: true, session }
      );
      if (!order) {
        const existing = await WholesaleOrder.findById(orderId).session(session);
        if (!existing) throw new Error("Wholesale order not found.");
        throw new Error(`Only orders with escrow held can be marked as shipped (current: ${existing.status}).`);
      }

      await notify(
        String(order.vendor),
        "DELIVERY",
        "Order shipped",
        `${order.orderNumber} has been shipped. Confirm delivery with the OTP.`,
        order.orderNumber
      );

      await session.commitTransaction();
      session.endSession();
      return order;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /**
   * Reveal the delivery OTP to the owning vendor once the order is shipped.
   * The OTP is stored encrypted at rest and decrypted only here.
   */
  async getDeliveryOtp({ orderId, user }) {
    const order = await WholesaleOrder.findById(orderId).select("+otpCipher +otpLocked").lean();
    if (!order) throw new Error("Wholesale order not found.");
    if (String(order.vendor) !== String(user._id)) {
      throw new Error("Only the vendor who placed the order can view the OTP.");
    }
    if (order.status !== "SHIPPED" && order.status !== "DELIVERED") {
      throw new Error("OTP is revealed only after the order has been shipped.");
    }
    return decryptSecret(order.otpCipher);
  }

  /**
   * Confirm physical receipt and release escrow funds to the supplier.
   * Requires the delivery OTP. `deliveryStatus` may be "DELIVERED" when the
   * vendor marks delivery explicitly.
   */
  async confirmReceiptAndRelease({ orderId, vendorId, providedOtp, deliveryStatus = "DELIVERED" }) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const order = await WholesaleOrder.findById(orderId)
        .select("+otpHash +otpAttempts +otpLocked")
        .session(session);
      if (!order) throw new Error("Wholesale order not found.");
      if (String(order.vendor) !== String(vendorId)) {
        throw new Error("Only the vendor who placed the order can confirm receipt.");
      }

      if (order.status !== "SHIPPED" && order.status !== "DELIVERED") {
        throw new Error(`Cannot release escrow for order in status: ${order.status}. Only SHIPPED or DELIVERED orders can be confirmed.`);
      }

      if (order.otpLocked) {
        throw new Error("Delivery OTP is locked after too many failed attempts. Contact support.");
      }

      // OTP is mandatory for confirmation.
      if (!providedOtp || !constantTimeEqualHex(sha256Hex(providedOtp), order.otpHash)) {
        const attempts = (order.otpAttempts || 0) + 1;
        const locked = attempts >= 5;
        await WholesaleOrder.updateOne(
          { _id: order._id, status: { $ne: "CONFIRMED_RELEASED" } },
          { $set: { otpAttempts: attempts, otpLocked: locked } },
          { session }
        );
        throw new Error(locked
          ? "Invalid delivery confirmation OTP. Maximum attempts reached; OTP is now locked."
          : `Invalid delivery confirmation OTP. ${5 - attempts} attempt(s) remaining.`);
      }

      const deliveredAt = deliveryStatus === "DELIVERED" ? new Date() : order.shippedAt || new Date();
      const split = wholesaleSplit(order.totalAmount);
      const netAmount = split.netAmount;

      // Update Supplier Wallet (Move to Available Balance) — guarded update so
      // a stale status cannot double-release.
      const updated = await WholesaleOrder.findOneAndUpdate(
        { _id: order._id, status: { $in: ["SHIPPED", "DELIVERED"] } },
        {
          $set: {
            status: "CONFIRMED_RELEASED",
            deliveredAt,
            confirmedAt: new Date(),
            commissionAmount: split.commissionAmount,
            netAmount,
            otpAttempts: 0,
            otpLocked: false,
          },
        },
        { new: true, session }
      );
      if (!updated) {
        throw new Error("Order was already released. Duplicate confirmation blocked.");
      }

      await VendorWallet.findOneAndUpdate(
        { vendor: updated.supplier },
        { $inc: { availableBalance: netAmount, totalEarned: netAmount } },
        { upsert: true, session }
      );

      await session.commitTransaction();
      session.endSession();

      const wallet = await VendorWallet.findOne({ vendor: updated.supplier }).lean();
      return { order: updated, newSupplierBalance: wallet?.availableBalance || netAmount };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /**
   * Cancels a wholesale order. Vendors may cancel while PENDING_PAYMENT.
   * Suppliers may decline the same way (reason required).
   */
  async cancelWholesaleOrder({ orderId, userId, role, reason = "" }) {
    const allowedStatuses = ["PENDING_PAYMENT"];

    const query = { _id: orderId, status: { $in: allowedStatuses } };
    if (role === "supplier") {
      query.supplier = userId;
    } else {
      query.vendor = userId;
    }

    const order = await WholesaleOrder.findOneAndUpdate(
      query,
      {
        $set: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancellationReason: String(reason || "").trim().slice(0, 300),
        },
      },
      { new: true }
    );
    if (!order) {
      const existing = await WholesaleOrder.findById(orderId);
      if (!existing) throw new Error("Wholesale order not found.");
      throw new Error(`Only orders awaiting payment can be cancelled (current: ${existing.status}).`);
    }
    return order;
  }

  /**
   * Mark an order as disputed and ask for admin attention. Reason is required.
   */
  async reportWholesaleOrderProblem({ orderId, userId, supplier = null, reason = "" }) {
    const text = String(reason || "").trim().slice(0, 500);
    if (!text) throw new Error("A dispute reason is required.");

    const order = await WholesaleOrder.findOne({
      _id: orderId,
      status: { $in: ["SHIPPED", "DELIVERED", "ESCROW_HELD", "DISPUTED"] },
    });
    if (!order) throw new Error("Wholesale order not found or is not disputable.");
    const allowed =
      String(order.vendor) === String(userId) || String(order.supplier) === String(supplier?.user || userId);
    if (!allowed) throw new Error("Not authorized to dispute this order.");

    order.status = "DISPUTED";
    order.disputeReason = text;
    // Stop any auto-cancel timer while the dispute is being reviewed.
    order.autoCancelAt = null;
    await order.save();
    return order;
  }

  /**
   * Auto-cancel stale PENDING_PAYMENT orders (called by the scheduler).
   */
  async autoCancelStalePendingOrders(maxAgeMs = 24 * 60 * 60 * 1000) {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const res = await WholesaleOrder.updateMany(
      { status: "PENDING_PAYMENT", createdAt: { $lt: cutoff } },
      { $set: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "Auto-cancelled (payment window expired)." } }
    );
    return res.modifiedCount || 0;
  }

  /**
   * Hold vendor funds in escrow upon a successful B2B payment (called from the
   * payment webhook only, never from a public client route).
   */
  async holdWholesaleEscrow({ orderId, paymentRef = null, session }) {
    const order = await WholesaleOrder.findById(orderId).session(session);
    if (!order) throw new Error("Wholesale order not found.");
    if (order.status !== "PENDING_PAYMENT") {
      throw new Error(`Wholesale order is not awaiting payment (current: ${order.status}).`);
    }

    await reserveStock(order.items, session);

    const split = wholesaleSplit(order.totalAmount);
    const updated = await WholesaleOrder.findByIdAndUpdate(
      orderId,
      {
        $set: {
          status: "ESCROW_HELD",
          paymentStatus: "PAID",
          paymentRef: paymentRef || order.paymentRef,
          autoCancelAt: null,
          netAmount: split.netAmount,
          commissionAmount: split.commissionAmount,
        },
      },
      { new: true, session }
    );

    await notify(
      String(order.supplier),
      "SUPPLIER_ORDER",
      "Payment received",
      `${order.orderNumber} is paid (${order.totalAmount.toLocaleString()} RWF). Escrow held — start packing.`,
      order.orderNumber
    );

    return updated;
  }

  /**
   * Refund a wholesale order that was paid but never shipped (ESCROW_HELD or
   * PENDING_PAYMENT). Restores stock and marks payment refunded.
   */
  async refundWholesaleOrder({ orderId, adminUserId = null, reason = "" }) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const order = await WholesaleOrder.findById(orderId).session(session);
      if (!order) throw new Error("Wholesale order not found.");
      if (order.status !== "ESCROW_HELD" && order.status !== "CONFIRMED_RELEASED") {
        throw new Error(`Order cannot be refunded from status ${order.status}.`);
      }

      await WholesaleOrder.findByIdAndUpdate(
        orderId,
        {
          $set: {
            status: "CANCELLED",
            paymentStatus: "REFUNDED",
            cancelledAt: new Date(),
            cancellationReason: String(reason || "Refunded by admin.").slice(0, 300),
          },
        },
        { session }
      );

      await restoreStock(order.items, session);

      await session.commitTransaction();
      session.endSession();
      return { ok: true, orderNumber: order.orderNumber };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }
}

module.exports = new WholesaleService();