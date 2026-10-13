const mongoose = require("mongoose");
const ShippingZone = require("../models/ShippingZone");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const { resolveOwnedStore } = require("../utils/vendorStore.util");
const { RWANDA_LOCATIONS, PROVINCES, DISTRICTS } = require("../config/rwandaLocations");
const shippingService = require("../services/shipping.service");

// Keeps only known Rwandan provinces / districts (case-insensitive).
const cleanList = (values, allowed) => {
  if (!Array.isArray(values)) return [];
  const byLower = Object.fromEntries(allowed.map((a) => [a.toLowerCase(), a]));
  return [...new Set(values.map((v) => byLower[String(v).trim().toLowerCase()]).filter(Boolean))];
};
const money = (v) => (v === null || v === undefined || v === "" ? null : Math.max(0, Math.round(Number(v) || 0)));

function mapZone(z) {
  return {
    id: z.publicId || z._id,
    name: z.name,
    zone: z.name,
    fee: z.fee,
    expressFee: z.expressFee ?? null,
    pickupFee: z.pickupFee || 0,
    freeOverAmount: z.freeOverAmount,
    coverage: z.districts?.length
      ? z.districts.join(", ")
      : z.provinces?.length ? z.provinces.join(", ") : "All of Rwanda",
    eta: z.eta,
    delivery: z.eta,
    methods: z.methods,
    method: z.methods.join(" / "),
    countries: z.countries,
    provinces: z.provinces,
    districts: z.districts,
    status: z.status,
    store: z.store,
    vendor: z.vendor,
    createdAt: z.createdAt,
  };
}

// The list endpoint exposes publicId as `id`, so accept either identifier.
const findZone = (id) =>
  mongoose.isValidObjectId(id) ? ShippingZone.findById(id) : ShippingZone.findOne({ publicId: id });

const allowedStatus = ["ACTIVE", "PAUSED"];

// @desc    Create a shipping zone (vendor for own store, or admin global)
// @route   POST /api/shipping/zones
// @access  Private (vendor or super_admin)
exports.createZone = async (req, res) => {
  try {
    const { name, fee, freeOverAmount, eta, methods, countries, provinces, districts, expressFee, pickupFee } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Zone name is required" });
    }

    const isVendor = req.user.role === "vendor";
    let store = null;
    if (isVendor) {
      store = await resolveOwnedStore(req.user._id, req.body.storeId);
      if (!store) {
        return res.status(400).json({
          message: req.body.storeId ? "Select one of your own stores." : "Create a store before adding shipping zones",
        });
      }
    }

    const zone = await ShippingZone.create({
      name: name.trim(),
      vendor: isVendor ? req.user._id : null,
      store: isVendor ? store._id : null,
      fee: money(fee) || 0,
      expressFee: money(expressFee),
      pickupFee: money(pickupFee) || 0,
      freeOverAmount: money(freeOverAmount) || 0,
      eta: eta || "1–3 days",
      methods: Array.isArray(methods) && methods.length ? methods : ["STANDARD"],
      countries: Array.isArray(countries) && countries.length ? countries : ["Rwanda"],
      provinces: cleanList(provinces, PROVINCES),
      districts: cleanList(districts, DISTRICTS),
    });

    return res.status(201).json({
      message: "Shipping zone created",
      zone: mapZone(zone.toObject()),
    });
  } catch (error) {
    console.error("Error creating shipping zone:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    List shipping zones (vendor sees own; admin sees all; public sees active)
// @route   GET /api/shipping/zones
// @access  Public (active only) / Private for scoped lists
exports.listZones = async (req, res) => {
  try {
    const query = {};
    if (req.user) {
      if (req.user.role === "vendor") query.vendor = req.user._id;
      if (req.user.role === "buyer") {
        query.$or = [{ vendor: null }, { store: null }];
        query.status = "ACTIVE";
      }
    } else {
      query.status = "ACTIVE";
    }

    const zones = await ShippingZone.find(query).sort({ createdAt: -1 });
    return res.status(200).json({
      data: zones.map((z) => mapZone(z.toObject())),
      meta: { total: zones.length },
    });
  } catch (error) {
    console.error("Error listing shipping zones:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Update a shipping zone
// @route   PATCH /api/shipping/zones/:id
// @access  Private (vendor owner or super_admin)
exports.updateZone = async (req, res) => {
  try {
    const { id } = req.params;
    const zone = await findZone(id);
    if (!zone) {
      return res.status(404).json({ message: "Shipping zone not found" });
    }

    const isOwner = req.user.role === "vendor" && String(zone.vendor) === String(req.user._id);
    const isAdmin = req.user.role === "super_admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Not authorized to update this zone" });
    }

    const { name, fee, freeOverAmount, eta, methods, countries, provinces, districts, status, expressFee, pickupFee } =
      req.body;

    if (name !== undefined && name.trim()) zone.name = name.trim();
    if (fee !== undefined) zone.fee = money(fee) || 0;
    if (expressFee !== undefined) zone.expressFee = money(expressFee);
    if (pickupFee !== undefined) zone.pickupFee = money(pickupFee) || 0;
    if (freeOverAmount !== undefined) zone.freeOverAmount = money(freeOverAmount) || 0;
    if (eta !== undefined) zone.eta = eta;
    if (methods !== undefined) zone.methods = Array.isArray(methods) ? methods : [methods];
    if (countries !== undefined) zone.countries = countries;
    if (provinces !== undefined) zone.provinces = cleanList(provinces, PROVINCES);
    if (districts !== undefined) zone.districts = cleanList(districts, DISTRICTS);
    if (status !== undefined) {
      if (!allowedStatus.includes(status)) {
        return res.status(400).json({ message: "Invalid zone status" });
      }
      zone.status = status;
    }

    await zone.save();
    return res.status(200).json({
      message: "Shipping zone updated",
      zone: mapZone(zone.toObject()),
    });
  } catch (error) {
    console.error("Error updating shipping zone:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Delete a shipping zone
// @route   DELETE /api/shipping/zones/:id
// @access  Private (vendor owner or super_admin)
exports.deleteZone = async (req, res) => {
  try {
    const { id } = req.params;
    const zone = await findZone(id);
    if (!zone) {
      return res.status(404).json({ message: "Shipping zone not found" });
    }

    const isOwner = req.user.role === "vendor" && String(zone.vendor) === String(req.user._id);
    const isAdmin = req.user.role === "super_admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Not authorized to delete this zone" });
    }

    await ShippingZone.deleteOne({ _id: zone._id });
    return res.status(200).json({ message: "Shipping zone deleted" });
  } catch (error) {
    console.error("Error deleting shipping zone:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


// @desc    Rwanda provinces and districts used for zone coverage and checkout.
// @route   GET /api/shipping/locations
// @access  Public
exports.getLocations = (req, res) => res.status(200).json({ locations: RWANDA_LOCATIONS });

// @desc    Delivery quote for the buyer's cart (or given items) to an address.
// @route   POST /api/shipping/quote  { address: { province, district }, method, items?: [{ productId, qty }] }
// @access  Private (buyer)
exports.quote = async (req, res) => {
  try {
    const { address = {}, method = "STANDARD", items } = req.body;
    let lines = [];
    if (Array.isArray(items) && items.length) {
      const ids = items.map((i) => i.productId).filter((id) => mongoose.isValidObjectId(id));
      const products = await Product.find({ _id: { $in: ids } });
      const byId = Object.fromEntries(products.map((p) => [String(p._id), p]));
      lines = items
        .filter((i) => byId[i.productId])
        .map((i) => ({ product: byId[i.productId], quantity: Number(i.qty || i.quantity) || 1, price: byId[i.productId].discountPrice || byId[i.productId].price }));
    } else {
      const cart = await Cart.findOne({ user: req.user.id }).populate("items.product");
      lines = (cart?.items || [])
        .filter((i) => i.product)
        .map((i) => ({ product: i.product, quantity: i.quantity, price: i.product.discountPrice || i.product.price }));
    }
    if (!lines.length) return res.status(400).json({ message: "There is nothing to deliver." });

    const quote = await shippingService.quoteShipping({ lines, address, method });
    const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
    return res.status(200).json({ ...quote, subtotal, total: subtotal + quote.shippingFee });
  } catch (error) {
    console.error("Error quoting shipping:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Seller preview: fee a buyer at an address would pay for one of my stores.
// @route   POST /api/shipping/preview  { province, district, subtotal, method, storeId? }
// @access  Private (vendor)
exports.preview = async (req, res) => {
  try {
    const { province, district, subtotal, method, storeId } = req.body;
    const store = await resolveOwnedStore(req.user._id, storeId);
    if (!store) return res.status(400).json({ message: "Create a store first." });
    const result = await shippingService.previewForStore({
      vendorId: req.user._id, storeId: store._id, address: { province, district }, subtotal, method,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error("Error previewing shipping:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
