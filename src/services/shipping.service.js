// Delivery fee calculation from seller shipping zones.
//
// Items are shipped per store (a seller with two stores ships two parcels).
// For each store the most specific ACTIVE zone covering the buyer's address
// is used: a district match beats a province match, which beats a nationwide
// zone (no provinces or districts listed). Zone lookup order:
//   1. the store's zones  2. the seller's other zones  3. MVEC platform zones
//   (vendor: null)  4. built-in MVEC defaults below.
// A seller who has zones, none of which cover the address, does not deliver there.
const ShippingZone = require("../models/ShippingZone");
const Store = require("../models/Store");
const { getPrimaryStore } = require("../utils/vendorStore.util");
const { provinceOfDistrict } = require("../config/rwandaLocations");

// Used only when neither the seller nor MVEC has configured any zone.
const DEFAULT_ZONES = [
  { _id: null, name: "Kigali City (MVEC standard)", provinces: ["Kigali City"], districts: [], fee: 0, expressFee: 10000, freeOverAmount: 0, eta: "Same day – 1 day", methods: ["STANDARD", "EXPRESS"] },
  { _id: null, name: "Rest of Rwanda (MVEC standard)", provinces: [], districts: [], fee: 5000, expressFee: 10000, freeOverAmount: 0, eta: "1–3 days", methods: ["STANDARD", "EXPRESS"] },
];

const METHODS = ["STANDARD", "EXPRESS", "PICKUP"];
const lc = (v) => String(v || "").trim().toLowerCase();

const normalizeAddress = (address = {}) => {
  const district = address.district || address.city || "";
  const province = address.province || provinceOfDistrict(district) || address.state || "";
  return { province, district };
};

// 3 = district match, 2 = province match, 1 = nationwide, 0 = not covered.
const coverageScore = (zone, { province, district }) => {
  const districts = (zone.districts || []).map(lc);
  const provinces = (zone.provinces || []).map(lc);
  if (districts.length) return districts.includes(lc(district)) ? 3 : 0;
  if (provinces.length) return provinces.includes(lc(province)) ? 2 : 0;
  return 1;
};

const bestZone = (zones, address) => {
  let best = null;
  let bestScore = 0;
  for (const zone of zones) {
    const score = coverageScore(zone, address);
    if (score > bestScore || (score === bestScore && score > 0 && Number(zone.fee) < Number(best.fee))) {
      best = zone;
      bestScore = score;
    }
  }
  return best;
};

// Fee for a method in a zone; express falls back to standard when not offered.
const feeFor = (zone, requested, subtotal) => {
  const methods = zone.methods?.length ? zone.methods : ["STANDARD"];
  let method = METHODS.includes(requested) ? requested : "STANDARD";
  if (!methods.includes(method)) method = methods.includes("STANDARD") ? "STANDARD" : methods[0];
  let fee;
  if (method === "EXPRESS") fee = zone.expressFee ?? zone.fee;
  else if (method === "PICKUP") fee = zone.pickupFee || 0;
  else fee = zone.freeOverAmount > 0 && subtotal >= zone.freeOverAmount ? 0 : zone.fee;
  return { method, fee: Math.max(0, Math.round(Number(fee) || 0)), fellBack: method !== requested };
};

const zonesForStore = async (vendorId, storeId, cache) => {
  const key = `${vendorId}:${storeId}`;
  if (cache.has(key)) return cache.get(key);
  const vendorZones = await ShippingZone.find({ vendor: vendorId, status: "ACTIVE" }).lean();
  let result;
  if (vendorZones.length) {
    const own = vendorZones.filter((z) => String(z.store) === String(storeId));
    result = { zones: own.length ? own : vendorZones, source: "seller" };
  } else {
    const platform = await ShippingZone.find({ vendor: null, status: "ACTIVE" }).lean();
    result = platform.length ? { zones: platform, source: "platform" } : { zones: DEFAULT_ZONES, source: "default" };
  }
  cache.set(key, result);
  return result;
};

/**
 * Quote delivery for order lines.
 * lines: [{ product (doc with vendor/store), quantity, price }]
 * Returns { shippingFee, deliverable, method, groups: [...] }.
 */
exports.quoteShipping = async ({ lines, address, method = "STANDARD" }) => {
  const where = normalizeAddress(address);
  const requested = String(method || "STANDARD").toUpperCase();
  const primaryCache = new Map();
  const zoneCache = new Map();
  const groupsByKey = new Map();

  for (const line of lines) {
    const vendorId = String(line.product.vendor);
    let storeId = line.product.store ? String(line.product.store) : null;
    if (!storeId) {
      if (!primaryCache.has(vendorId)) primaryCache.set(vendorId, await getPrimaryStore(vendorId));
      storeId = primaryCache.get(vendorId)?._id ? String(primaryCache.get(vendorId)._id) : null;
    }
    const key = `${vendorId}:${storeId}`;
    const group = groupsByKey.get(key) || { vendor: vendorId, store: storeId, subtotal: 0, items: 0 };
    group.subtotal += Number(line.price) * Number(line.quantity);
    group.items += Number(line.quantity);
    groupsByKey.set(key, group);
  }

  const storeIds = [...groupsByKey.values()].map((g) => g.store).filter(Boolean);
  const stores = await Store.find({ _id: { $in: storeIds } }).select("storeName").lean();
  const storeNames = Object.fromEntries(stores.map((s) => [String(s._id), s.storeName]));

  const groups = [];
  for (const group of groupsByKey.values()) {
    const { zones, source } = await zonesForStore(group.vendor, group.store, zoneCache);
    const zone = bestZone(zones, where);
    const storeName = storeNames[group.store] || "Seller";
    if (!zone) {
      groups.push({
        ...group, storeName, deliverable: false, fee: 0, method: null, eta: null, zone: null, zoneName: null, source,
        message: `${storeName} doesn't deliver to ${where.district || where.province || "this address"} yet.`,
      });
      continue;
    }
    const { method: used, fee, fellBack } = feeFor(zone, requested, group.subtotal);
    groups.push({
      ...group, storeName, deliverable: true, fee, method: used, eta: zone.eta, zone: zone._id || null, zoneName: zone.name, source,
      freeOverAmount: used === "STANDARD" && zone.freeOverAmount > 0 ? zone.freeOverAmount : null,
      message: fellBack ? `${storeName} doesn't offer ${requested.toLowerCase()} delivery; ${used.toLowerCase()} is used.` : null,
    });
  }

  return {
    address: where,
    method: requested,
    deliverable: groups.every((g) => g.deliverable),
    shippingFee: groups.reduce((s, g) => s + g.fee, 0),
    groups,
  };
};

// Seller-side preview: what a buyer at this address would pay for one store.
exports.previewForStore = async ({ vendorId, storeId, address, subtotal = 0, method = "STANDARD" }) => {
  const where = normalizeAddress(address);
  const { zones, source } = await zonesForStore(vendorId, storeId, new Map());
  const zone = bestZone(zones, where);
  if (!zone) return { address: where, source, deliverable: false };
  const { method: used, fee } = feeFor(zone, String(method).toUpperCase(), Number(subtotal) || 0);
  return { address: where, source, deliverable: true, zone: zone._id, zoneName: zone.name, method: used, fee, eta: zone.eta };
};

exports.normalizeAddress = normalizeAddress;
exports.DEFAULT_ZONES = DEFAULT_ZONES;
