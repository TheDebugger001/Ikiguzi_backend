const mongoose = require("mongoose");
const Store = require("../models/Store");

// Maximum number of stores one vendor account may own.
const MAX_STORES_PER_VENDOR = Number(process.env.MAX_STORES_PER_VENDOR) || 5;

const createSlug = (text) =>
  text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-");

// Primary store of a vendor. Stores created before isPrimary existed have no
// flag, so the oldest one is promoted the first time it is looked up.
const getPrimaryStore = async (vendorId) => {
  if (!vendorId) return null;
  const primary = await Store.findOne({ vendor: vendorId, isPrimary: true });
  if (primary) return primary;
  const oldest = await Store.findOne({ vendor: vendorId }).sort({ createdAt: 1 });
  if (oldest) {
    await Store.updateOne({ _id: oldest._id }, { $set: { isPrimary: true } });
    oldest.isPrimary = true;
  }
  return oldest;
};

// All stores of a vendor, primary first.
const listVendorStores = async (vendorId) => {
  await getPrimaryStore(vendorId);
  return Store.find({ vendor: vendorId }).sort({ isPrimary: -1, createdAt: 1 });
};

// A store the vendor owns. Without storeId the primary store is returned.
// Resolves to null when storeId is given but invalid or not owned.
const resolveOwnedStore = async (vendorId, storeId) => {
  if (storeId === undefined || storeId === null || storeId === "") return getPrimaryStore(vendorId);
  if (!mongoose.isValidObjectId(storeId)) return null;
  return Store.findOne({ _id: storeId, vendor: vendorId });
};

const uniqueSlug = async (text) => {
  const base = createSlug(text) || "store";
  return (await Store.exists({ slug: base })) ? `${base}-${Date.now().toString(36)}` : base;
};

module.exports = {
  MAX_STORES_PER_VENDOR,
  createSlug,
  getPrimaryStore,
  listVendorStores,
  resolveOwnedStore,
  uniqueSlug,
};
