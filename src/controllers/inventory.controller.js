const mongoose = require("mongoose");
const Product = require("../models/Product");
const StockMovement = require("../models/StockMovement");
const { getPrimaryStore, resolveOwnedStore } = require("../utils/vendorStore.util");

const REASONS = {
  RESTOCK: ["Restock", "Received from supplier", "Customer return", "Other"],
  REMOVE: ["Damaged", "Lost or stolen", "Expired", "Sold offline", "Other"],
  COUNT: ["Stock count correction", "Other"],
};
const MODE_TO_TYPE = { add: "RESTOCK", remove: "REMOVE", set: "COUNT" };

const ownerIds = (req) => {
  const vendorId = req.vendorId || req.targetVendorId || req.user.id;
  return [...new Set([String(req.user.id), String(vendorId)])];
};

// The store a product is listed under (null store = vendor's primary store).
const effectiveStoreId = async (product) => {
  if (product.store) return product.store;
  const primary = await getPrimaryStore(product.vendor);
  return primary?._id || null;
};

// Keeps OUT_OF_STOCK in step with quantity (atomic updates skip save hooks).
const syncStockStatus = async (product) => {
  if (product.stockQuantity <= 0 && product.status !== "OUT_OF_STOCK") {
    return Product.findByIdAndUpdate(product._id, { $set: { status: "OUT_OF_STOCK", stockQuantity: 0 } }, { new: true });
  }
  if (product.stockQuantity > 0 && product.status === "OUT_OF_STOCK") {
    return Product.findByIdAndUpdate(product._id, { $set: { status: "ACTIVE" } }, { new: true });
  }
  return product;
};

// @desc    Add, remove or set a product's stock, recording the movement.
// @route   PATCH /api/products/:id/stock   { mode: add|remove|set, quantity, reason, note }
// @access  Private (vendor / staff with canManageProducts)
exports.adjustStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { mode, reason = "", note = "" } = req.body;
    const quantity = Number(req.body.quantity);
    const type = MODE_TO_TYPE[mode];

    if (!type) return res.status(400).json({ message: "Choose add, remove or set." });
    if (!Number.isInteger(quantity) || quantity < 0 || (mode !== "set" && quantity === 0)) {
      return res.status(400).json({ message: mode === "set" ? "Enter a whole number of 0 or more." : "Enter a whole number greater than 0." });
    }
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Product not found." });

    const owned = { _id: id, vendor: { $in: ownerIds(req) } };
    const current = await Product.findOne(owned).select("stockQuantity name vendor store status");
    if (!current) return res.status(404).json({ message: "Product not found." });

    // Atomic updates so concurrent orders or edits can't be overwritten.
    let updated;
    if (mode === "add") {
      updated = await Product.findOneAndUpdate(owned, { $inc: { stockQuantity: quantity } }, { new: true });
    } else if (mode === "remove") {
      updated = await Product.findOneAndUpdate(
        { ...owned, stockQuantity: { $gte: quantity } },
        { $inc: { stockQuantity: -quantity } },
        { new: true }
      );
      if (!updated) {
        const latest = await Product.findOne(owned).select("stockQuantity");
        return res.status(409).json({ message: `Only ${latest?.stockQuantity ?? 0} units are in stock.` });
      }
    } else {
      updated = await Product.findOneAndUpdate(owned, { $set: { stockQuantity: quantity } }, { new: true });
    }
    updated = await syncStockStatus(updated);

    const after = updated.stockQuantity;
    const before = mode === "add" ? after - quantity : mode === "remove" ? after + quantity : current.stockQuantity;
    const movement = await StockMovement.create({
      vendor: updated.vendor,
      product: updated._id,
      productName: updated.name,
      store: await effectiveStoreId(updated),
      type,
      quantity: after - before,
      before,
      after,
      reason: String(reason).slice(0, 60) || REASONS[type][0],
      note: String(note).slice(0, 300),
      performedBy: req.user._id,
    });

    return res.status(200).json({ message: "Stock updated.", product: updated, movement });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Move products to another of the vendor's stores.
// @route   POST /api/products/vendor/move-store   { productIds: [], storeId, note }
// @access  Private (vendor / staff with canManageProducts)
exports.moveProductsToStore = async (req, res) => {
  try {
    const { productIds, storeId, note = "" } = req.body;
    if (!Array.isArray(productIds) || !productIds.length || !productIds.every((p) => mongoose.isValidObjectId(p))) {
      return res.status(400).json({ message: "Select at least one product." });
    }
    const owners = ownerIds(req);
    const target = storeId ? await resolveOwnedStore(owners[owners.length - 1], storeId) : null;
    if (!target) return res.status(400).json({ message: "Select one of your own stores." });

    const products = await Product.find({ _id: { $in: productIds }, vendor: { $in: owners } });
    if (products.length !== productIds.length) {
      return res.status(404).json({ message: "Some products were not found." });
    }

    const moves = [];
    for (const product of products) {
      const from = await effectiveStoreId(product);
      if (String(from) === String(target._id)) continue;
      moves.push({ product, from });
    }
    if (moves.length) {
      await Product.updateMany({ _id: { $in: moves.map((m) => m.product._id) } }, { $set: { store: target._id } });
      await StockMovement.insertMany(moves.map(({ product, from }) => ({
        vendor: product.vendor,
        product: product._id,
        productName: product.name,
        store: target._id,
        type: "TRANSFER",
        quantity: 0,
        before: product.stockQuantity,
        after: product.stockQuantity,
        fromStore: from,
        toStore: target._id,
        reason: "Moved to another store",
        note: String(note).slice(0, 300),
        performedBy: req.user._id,
      })));
    }

    const skipped = products.length - moves.length;
    return res.status(200).json({
      message: `${moves.length} product${moves.length === 1 ? "" : "s"} moved to ${target.storeName}${skipped ? ` (${skipped} already there)` : ""}.`,
      moved: moves.length,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Recent inventory operations for the vendor.
// @route   GET /api/products/vendor/stock-movements?store=&product=&limit=
// @access  Private (vendor)
exports.listStockMovements = async (req, res) => {
  try {
    const query = { vendor: { $in: ownerIds(req) } };
    if (mongoose.isValidObjectId(req.query.product)) query.product = req.query.product;
    if (mongoose.isValidObjectId(req.query.store)) {
      query.$or = [{ store: req.query.store }, { fromStore: req.query.store }];
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const movements = await StockMovement.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("performedBy", "Fullname")
      .populate("fromStore", "storeName")
      .populate("toStore", "storeName")
      .populate("store", "storeName");
    return res.status(200).json({ movements, reasons: REASONS });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.STOCK_REASONS = REASONS;
