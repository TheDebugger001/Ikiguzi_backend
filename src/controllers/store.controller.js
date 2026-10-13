const mongoose = require("mongoose");
const Store = require("../models/Store");
const Product = require("../models/Product");
const Staff = require("../models/Staff");
const Promotion = require("../models/Promotion");
const ShippingZone = require("../models/ShippingZone");
const {
  MAX_STORES_PER_VENDOR,
  createSlug,
  getPrimaryStore,
  listVendorStores,
  uniqueSlug,
} = require("../utils/vendorStore.util");

// Vendor staff act on their employer's stores.
const resolveOwnerId = async (req) => {
  if (await Store.exists({ vendor: req.user.id })) return req.user.id;
  const staff = await Staff.findOne({
    $or: [{ user: req.user.id }, { user_id: req.user.id }],
    status: "ACTIVE",
  });
  return staff ? staff.vendorOwner : req.user.id;
};

const findOwnedStore = async (req, id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  const ownerId = await resolveOwnerId(req);
  return Store.findOne({ _id: id, vendor: ownerId });
};

// Product counts per store. Products without a store belong to the primary one.
const productCountsFor = async (vendorId, stores) => {
  const rows = await Product.aggregate([
    { $match: { vendor: new mongoose.Types.ObjectId(String(vendorId)) } },
    { $group: { _id: "$store", count: { $sum: 1 } } },
  ]);
  const byStore = Object.fromEntries(rows.map((r) => [String(r._id), r.count]));
  const unassigned = byStore.null || 0;
  return Object.fromEntries(
    stores.map((s) => [String(s._id), (byStore[String(s._id)] || 0) + (s.isPrimary ? unassigned : 0)])
  );
};

const normalizeAddress = ({ address, location, city, street, country }) => {
  let normalized = {};
  if (typeof address === "object" && address !== null) {
    normalized = { ...address };
  } else if (typeof address === "string" && address.trim().length > 0) {
    normalized = { street: address.trim(), city: address.trim(), country: "Rwanda" };
  }

  const locVal = location || city || normalized.city;
  if (locVal) {
    if (typeof locVal === "string") {
      normalized.city = normalized.city || locVal;
      normalized.street = normalized.street || locVal;
    } else if (typeof locVal === "object") {
      normalized = { ...normalized, ...locVal };
    }
  }
  if (city) normalized.city = city;
  if (street) normalized.street = street;
  if (country) normalized.country = country;
  if (!normalized.city) normalized.city = "Kigali";
  if (!normalized.country) normalized.country = "Rwanda";
  return { address: normalized, location: locVal || normalized.city };
};

// Keeps the vendor's public profile in step with their primary store.
const syncVendorProfile = async (userId, fields) => {
  try {
    const Vendor = require("../models/Vendor");
    const v = await Vendor.findOne({ user: userId });
    if (!v) return;
    if (fields.storeName) v.businessName = fields.storeName;
    if (fields.description) v.description = fields.description;
    if (fields.contactPhone) v.phone = fields.contactPhone;
    if (fields.contactEmail) v.email = fields.contactEmail;
    if (fields.logo) v.logoUrl = fields.logo;
    if (fields.banner) v.bannerUrl = fields.banner;
    if (fields.location) v.location = fields.location;
    await v.save();
  } catch (vErr) {
    console.error("Auto-sync vendor profile error:", vErr.message);
  }
};

const applyStoreUpdates = async (store, body) => {
  const allowedFields = [
    "storeName", "slug", "logo", "banner", "description", "businessCategory",
    "contactEmail", "contactPhone", "address", "policies", "socialLinks",
    "businessAddress", "businessPhone", "taxId", "operatingHours",
    "shippingRules", "defaultShippingRuleId", "twoFactorEnabled", "marketplaceLive",
  ];
  const updates = Object.fromEntries(
    allowedFields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]])
  );
  if (updates.slug) updates.slug = createSlug(updates.slug);
  if (updates.storeName !== undefined && !updates.slug && updates.storeName !== store.storeName) {
    updates.slug = await uniqueSlug(updates.storeName);
  }
  if (body.storeSlug !== undefined) updates.slug = createSlug(body.storeSlug);
  if (body.logoUrl !== undefined) updates.logo = body.logoUrl;
  if (body.phone !== undefined) updates.contactPhone = body.phone;
  if (body.supportEmail !== undefined) updates.contactEmail = body.supportEmail;

  const currentAddress = store.address?.toObject?.() || store.address || {};
  if (body.businessAddress !== undefined) {
    updates.businessAddress = body.businessAddress;
    updates.address = { ...currentAddress, street: body.businessAddress };
  }
  if (body.location !== undefined) {
    updates.location = body.location;
    if (typeof body.location === "string") {
      updates.address = { ...(updates.address || currentAddress), city: body.location };
    } else if (typeof body.location === "object" && body.location !== null) {
      updates.address = { ...(updates.address || currentAddress), ...body.location };
    }
  }
  if (body.city !== undefined) {
    updates.address = { ...(updates.address || currentAddress), city: body.city };
    if (!updates.location) updates.location = body.city;
  }

  const updated = await Store.findByIdAndUpdate(store._id, updates, { new: true, runValidators: true });
  if (updated.isPrimary) await syncVendorProfile(updated.vendor, updates);
  return updated;
};

const settingsView = (store) => ({
  ...store.toObject(),
  storeSlug: store.slug,
  phone: store.contactPhone,
  supportEmail: store.contactEmail,
});

const duplicateNameMessage = (error) =>
  error.code === 11000 && error.keyPattern?.storeName
    ? "A store with this name already exists on MVEC. Choose another name."
    : null;

// @desc    Create a store (Vendor). The first store becomes the primary store.
// @route   POST /api/stores
// @access  Private (Vendor)
exports.createStore = async (req, res) => {
  try {
    const { storeName, description, businessCategory, contactEmail, contactPhone, policies, logo, banner } = req.body;

    if (!storeName || !contactEmail || !contactPhone) {
      return res.status(400).json({ message: "Store name, email, and phone are required." });
    }

    const existingCount = await Store.countDocuments({ vendor: req.user.id });
    if (existingCount >= MAX_STORES_PER_VENDOR) {
      return res.status(400).json({ message: `You can own up to ${MAX_STORES_PER_VENDOR} stores.` });
    }
    const isPrimary = existingCount === 0;
    const { address, location } = normalizeAddress(req.body);

    const store = await Store.create({
      vendor: req.user.id,
      isPrimary,
      storeName,
      slug: await uniqueSlug(storeName),
      description: description || "",
      businessCategory: businessCategory || "General",
      contactEmail,
      contactPhone,
      logo: logo || "",
      banner: banner || "",
      location,
      address,
      businessAddress: req.body.businessAddress || address.street || address.city,
      policies: policies || {},
      status: "ACTIVE", // Or PENDING if requiring Super Admin approval
    });

    // The first store also creates the vendor's public profile.
    if (isPrimary) {
      try {
        const Vendor = require("../models/Vendor");
        if (!(await Vendor.exists({ user: req.user.id }))) {
          await Vendor.create({
            user: req.user.id,
            businessName: storeName,
            phone: contactPhone,
            email: contactEmail,
            logoUrl: logo || null,
            bannerUrl: banner || null,
            description: description || "",
            location,
            status: "ACTIVE",
          });
        }
      } catch (vErr) {
        console.error("Auto-sync vendor on createStore error:", vErr.message);
      }
    }

    return res.status(201).json({ message: "Store created successfully", store });
  } catch (error) {
    const dup = duplicateNameMessage(error);
    if (dup) return res.status(409).json({ message: dup });
    if (error.code === 11000 && error.keyPattern?.vendor) {
      return res.status(409).json({
        message: "Multiple stores are not enabled yet: run `npm run migrate:stores` on the server.",
      });
    }
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Logged-in vendor's stores. `store` is the primary store (legacy shape).
// @route   GET /api/stores/mine
// @access  Private (Vendor)
exports.getMyStore = async (req, res) => {
  try {
    const ownerId = await resolveOwnerId(req);
    const stores = await listVendorStores(ownerId);
    if (!stores.length) {
      return res.status(404).json({ message: "No store found for this vendor.", stores: [] });
    }
    const counts = await productCountsFor(ownerId, stores);
    const primary = stores.find((s) => s.isPrimary) || stores[0];
    return res.status(200).json({
      store: primary,
      stores: stores.map((s) => ({ ...s.toObject(), productCount: counts[String(s._id)] || 0 })),
      maxStores: MAX_STORES_PER_VENDOR,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Update the primary store (legacy)
// @route   PUT /api/stores/mine
// @access  Private (Vendor)
exports.updateMyStore = async (req, res) => {
  try {
    const store = await getPrimaryStore(await resolveOwnerId(req));
    if (!store) return res.status(404).json({ message: "Store profile not found." });
    const updated = await applyStoreUpdates(store, req.body);
    return res.status(200).json({ message: "Store updated successfully", store: updated, settings: settingsView(updated) });
  } catch (error) {
    const dup = duplicateNameMessage(error);
    if (dup) return res.status(409).json({ message: dup });
    return res.status(500).json({ message: error.message });
  }
};

// @desc    One of the vendor's stores
// @route   GET /api/stores/mine/:id
// @access  Private (Vendor)
exports.getMyStoreById = async (req, res) => {
  try {
    const store = await findOwnedStore(req, req.params.id);
    if (!store) return res.status(404).json({ message: "Store not found." });
    return res.status(200).json({ store });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Update one of the vendor's stores
// @route   PUT /api/stores/mine/:id
// @access  Private (Vendor)
exports.updateMyStoreById = async (req, res) => {
  try {
    const store = await findOwnedStore(req, req.params.id);
    if (!store) return res.status(404).json({ message: "Store not found." });
    const updated = await applyStoreUpdates(store, req.body);
    return res.status(200).json({ message: "Store updated successfully", store: updated, settings: settingsView(updated) });
  } catch (error) {
    const dup = duplicateNameMessage(error);
    if (dup) return res.status(409).json({ message: dup });
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Make a store the vendor's primary store
// @route   PATCH /api/stores/mine/:id/primary
// @access  Private (Vendor)
exports.setPrimaryStore = async (req, res) => {
  try {
    const store = await findOwnedStore(req, req.params.id);
    if (!store) return res.status(404).json({ message: "Store not found." });
    if (!store.isPrimary) {
      const previous = await getPrimaryStore(store.vendor);
      // Unassigned products follow the primary store, so pin them to the old one.
      if (previous && String(previous._id) !== String(store._id)) {
        await Product.updateMany({ vendor: store.vendor, store: null }, { $set: { store: previous._id } });
      }
      await Store.updateMany({ vendor: store.vendor, _id: { $ne: store._id } }, { $set: { isPrimary: false } });
      store.isPrimary = true;
      await store.save();
      await syncVendorProfile(store.vendor, store.toObject());
    }
    return res.status(200).json({ message: `${store.storeName} is now your primary store.`, store });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Delete a non-primary store. Its products, promotions, shipping zones
//          and staff move to the primary store.
// @route   DELETE /api/stores/mine/:id
// @access  Private (Vendor)
exports.deleteMyStore = async (req, res) => {
  try {
    const store = await findOwnedStore(req, req.params.id);
    if (!store) return res.status(404).json({ message: "Store not found." });
    if (store.isPrimary) {
      return res.status(400).json({ message: "Make another store primary before deleting this one." });
    }
    const primary = await getPrimaryStore(store.vendor);
    await Promise.all([
      Product.updateMany({ store: store._id }, { $set: { store: primary?._id || null } }),
      Promotion.updateMany({ store: store._id }, { $set: { store: primary?._id || null } }),
      ShippingZone.updateMany({ store: store._id }, { $set: { store: primary?._id || null } }),
      Staff.updateMany({ store: store._id }, { $set: { store: primary?._id, vendor_id: primary?._id } }),
    ]);
    await Store.deleteOne({ _id: store._id });
    return res.status(200).json({ message: `${store.storeName} was deleted. Its products moved to ${primary?.storeName || "your primary store"}.` });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get public store profile & products by slug (Marketplace)
// @route   GET /api/stores/public/:slug
// @access  Public
exports.getPublicStoreBySlug = async (req, res) => {
  try {
    const store = await Store.findOne({ slug: req.params.slug, status: "ACTIVE" }).populate(
      "vendor",
      "Fullname email"
    );

    if (!store) {
      return res.status(404).json({ message: "Store not found or currently inactive." });
    }
    if (!store.isPrimary) {
      const primary = await getPrimaryStore(store.vendor._id);
      store.isPrimary = String(primary?._id) === String(store._id);
    }

    // Products listed under this store; unassigned ones belong to the primary store.
    const storeFilter = store.isPrimary ? { $in: [store._id, null] } : store._id;
    const products = await Product.find({ vendor: store.vendor._id, status: "ACTIVE", store: storeFilter });

    return res.status(200).json({ store, productsCount: products.length, products });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
