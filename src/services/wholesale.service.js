const mongoose = require("mongoose");
const WholesaleOrder = require("../models/WholesaleOrder");
const VendorWallet = require("../models/VendorWallet");
const Supplier = require("../models/Supplier");
const WholesaleProduct = require("../models/WholesaleProduct");

class WholesaleService {
  /**
   * Validate MOQ and create B2B Wholesale Order
   */
  async createWholesaleOrder({ vendorId, supplierId, items }) {
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
    const supplierUserId = supplier.user;

    if (!mongoose.isValidObjectId(vendorId)) {
      throw new Error("Invalid vendor ID provided.");
    }

    let totalAmount = 0;
    const validatedItems = [];

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("At least one wholesale product is required.");
    }

    for (const item of items) {
      if (!item.productId || !mongoose.isValidObjectId(item.productId)) {
        throw new Error(
          `Invalid product ID for item '${item.productName}'. Only real catalog products can be ordered.`
        );
      }
      const quantity = Number(item.quantity);
      const product = await WholesaleProduct.findOne({
        _id: item.productId,
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
      const unitPrice = product.wholesalePrice * (1 - product.bulkDiscount / 100);
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
    const deliveryOtp = Math.floor(100000 + Math.random() * 900000).toString();

    const order = await WholesaleOrder.create({
      orderNumber,
      vendor: vendorId,
      supplier: supplierUserId,
      items: validatedItems,
      totalAmount,
      status: "PENDING_PAYMENT",
      deliveryOtp,
    });

    return order;
  }

  async markWholesaleOrderShipped(orderId, supplierUserId) {
    const order = await WholesaleOrder.findOne({
      _id: orderId,
      supplier: supplierUserId,
    });
    if (!order) throw new Error("Wholesale order not found.");
    if (order.status !== "ESCROW_HELD") {
      throw new Error("Only orders with escrow held can be marked as shipped.");
    }
    order.status = "SHIPPED";
    order.shippedAt = new Date();
    await order.save();
    return order;
  }

  /**
   * Hold Vendor Funds in Escrow upon successful B2B Payment
   */
  async holdWholesaleEscrow(orderId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await WholesaleOrder.findById(orderId).session(session);
      if (!order) throw new Error("Wholesale order not found.");
      if (order.status !== "PENDING_PAYMENT") {
        throw new Error(`Invalid order status transition from ${order.status}`);
      }

      order.status = "ESCROW_HELD";
      await order.save({ session });

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
   * Confirm Physical Receipt and Release Escrow Funds to Supplier
   */
  async confirmReceiptAndRelease(orderId, providedOtp = null) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await WholesaleOrder.findById(orderId).select("+deliveryOtp").session(session);
      if (!order) throw new Error("Wholesale order not found.");

      if (order.status !== "ESCROW_HELD" && order.status !== "SHIPPED" && order.status !== "DELIVERED") {
        throw new Error(`Cannot release escrow for order in status: ${order.status}`);
      }

      // If OTP is provided, verify it
      if (providedOtp && order.deliveryOtp !== providedOtp) {
        throw new Error("Invalid delivery confirmation OTP.");
      }

      // Update Supplier Wallet (Move to Available Balance)
      let supplierWallet = await VendorWallet.findOne({ vendor: order.supplier }).session(session);
      if (!supplierWallet) {
        supplierWallet = new VendorWallet({
          vendor: order.supplier,
          availableBalance: 0,
          pendingBalance: 0,
          totalEarned: 0,
        });
      }

      supplierWallet.availableBalance += order.totalAmount;
      supplierWallet.totalEarned += order.totalAmount;
      await supplierWallet.save({ session });

      // Update Order Status
      order.status = "CONFIRMED_RELEASED";
      order.confirmedAt = new Date();
      await order.save({ session });

      await session.commitTransaction();
      session.endSession();

      return { order, newSupplierBalance: supplierWallet.availableBalance };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }
}

module.exports = new WholesaleService();