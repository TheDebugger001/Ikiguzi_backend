const Store = require("../models/Store");
const Product = require("../models/Product");

// Helper to convert store name to URL slug
const createSlug = (text) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-");
};

// @desc    Create a new store (Vendor)
// @route   POST /api/stores
// @access  Private (Vendor)
exports.createStore = async (req, res) => {
  try {
    const existingStore = await Store.findOne({ vendor: req.user.id });
    if (existingStore) {
      return res.status(400).json({ message: "You already have a store profile registered." });
    }

    const {
      storeName,
      description,
      businessCategory,
      contactEmail,
      contactPhone,
      address,
      policies,
      location,
      city,
      street,
      country,
      logo,
      banner,
    } = req.body;

    if (!storeName || !contactEmail || !contactPhone) {
      return res.status(400).json({ message: "Store name, email, and phone are required." });
    }

    let normalizedAddress = {};
    if (typeof address === "object" && address !== null) {
      normalizedAddress = { ...address };
    } else if (typeof address === "string" && address.trim().length > 0) {
      normalizedAddress = { street: address.trim(), city: address.trim(), country: "Rwanda" };
    }

    const locVal = location || city || normalizedAddress.city;
    if (locVal) {
      if (typeof locVal === "string") {
        normalizedAddress.city = normalizedAddress.city || locVal;
        normalizedAddress.street = normalizedAddress.street || locVal;
      } else if (typeof locVal === "object") {
        normalizedAddress = { ...normalizedAddress, ...locVal };
      }
    }
    if (city) normalizedAddress.city = city;
    if (street) normalizedAddress.street = street;
    if (country) normalizedAddress.country = country;
    if (!normalizedAddress.city) normalizedAddress.city = "Kigali";
    if (!normalizedAddress.country) normalizedAddress.country = "Rwanda";

    const slug = createSlug(storeName);
    let storeSlug = slug;
    const slugExists = await Store.findOne({ slug: storeSlug });
    if (slugExists) {
      storeSlug = `${slug}-${Date.now().toString(36)}`;
    }

    const store = await Store.create({
      vendor: req.user.id,
      storeName,
      slug: storeSlug,
      description: description || "",
      businessCategory: businessCategory || "General",
      contactEmail,
      contactPhone,
      logo: logo || "",
      banner: banner || "",
      location: locVal || normalizedAddress.city,
      address: normalizedAddress,
      businessAddress: normalizedAddress.street || normalizedAddress.city,
      policies: policies || {},
      status: "ACTIVE", // Or PENDING if requiring Super Admin approval
    });

    // Auto-sync Vendor record
    try {
      const Vendor = require("../models/Vendor");
      let v = await Vendor.findOne({ user: req.user.id });
      if (!v) {
        await Vendor.create({
          user: req.user.id,
          businessName: storeName,
          phone: contactPhone,
          email: contactEmail,
          logoUrl: logo || null,
          bannerUrl: banner || null,
          description: description || "",
          location: locVal || normalizedAddress.city,
          status: "ACTIVE",
        });
      }
    } catch (vErr) {
      console.error("Auto-sync vendor on createStore error:", vErr.message);
    }

    return res.status(201).json({ message: "Store created successfully", store });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get logged-in vendor's store details
// @route   GET /api/stores/mine
// @access  Private (Vendor)
exports.getMyStore = async (req, res) => {
  try {
    let store = await Store.findOne({ vendor: req.user.id });
    if (!store) {
      const Staff = require("../models/Staff");
      const staff = await Staff.findOne({
        $or: [{ user: req.user.id }, { user_id: req.user.id }],
        status: "ACTIVE",
      });
      if (staff) {
        store = await Store.findById(staff.store);
      }
    }
    if (!store) {
      return res.status(404).json({ message: "No store found for this vendor." });
    }
    return res.status(200).json({ store });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Update store details (Vendor)
// @route   PUT /api/stores/mine
// @access  Private (Vendor)
exports.updateMyStore = async (req, res) => {
  try {
    let store = await Store.findOne({ vendor: req.user.id });
    if (!store) {
      const Staff = require("../models/Staff");
      const staff = await Staff.findOne({
        $or: [{ user: req.user.id }, { user_id: req.user.id }],
        status: "ACTIVE",
      });
      if (staff) {
        store = await Store.findById(staff.store);
      }
    }
    if (!store) {
      return res.status(404).json({ message: "Store profile not found." });
    }

    const allowedFields = [
      "storeName", "slug", "logo", "description", "businessCategory",
      "contactEmail", "contactPhone", "address", "policies", "socialLinks",
      "businessAddress", "businessPhone", "taxId", "operatingHours",
      "shippingRules", "defaultShippingRuleId", "twoFactorEnabled", "marketplaceLive",
    ];
    const updates = Object.fromEntries(
      allowedFields
        .filter((field) => req.body[field] !== undefined)
        .map((field) => [field, req.body[field]])
    );
    if (updates.slug) updates.slug = createSlug(updates.slug);
    if (updates.storeName !== undefined && !updates.slug) {
      updates.slug = createSlug(updates.storeName);
    }
    if (req.body.storeSlug !== undefined) {
      updates.slug = createSlug(req.body.storeSlug);
    }
    if (req.body.logoUrl !== undefined) updates.logo = req.body.logoUrl;
    if (req.body.phone !== undefined) updates.contactPhone = req.body.phone;
    if (req.body.supportEmail !== undefined) updates.contactEmail = req.body.supportEmail;
    if (req.body.businessAddress !== undefined) {
      updates.businessAddress = req.body.businessAddress;
      updates.address = {
        ...(store.address?.toObject?.() || store.address || {}),
        street: req.body.businessAddress,
      };
    }
    if (req.body.location !== undefined) {
      updates.location = req.body.location;
      if (typeof req.body.location === "string") {
        updates.address = {
          ...(store.address?.toObject?.() || store.address || {}),
          city: req.body.location,
        };
      } else if (typeof req.body.location === "object" && req.body.location !== null) {
        updates.address = {
          ...(store.address?.toObject?.() || store.address || {}),
          ...req.body.location,
        };
      }
    }
    if (req.body.city !== undefined) {
      updates.address = {
        ...(updates.address || store.address?.toObject?.() || store.address || {}),
        city: req.body.city,
      };
      if (!updates.location) updates.location = req.body.city;
    }

    const updatedStore = await Store.findByIdAndUpdate(store._id, updates, {
      new: true,
      runValidators: true,
    });

    // Auto-sync Vendor record
    try {
      const Vendor = require("../models/Vendor");
      const v = await Vendor.findOne({ user: req.user.id });
      if (v) {
        if (updates.storeName) v.businessName = updates.storeName;
        if (updates.description) v.description = updates.description;
        if (updates.contactPhone) v.phone = updates.contactPhone;
        if (updates.contactEmail) v.email = updates.contactEmail;
        if (updates.logo) v.logoUrl = updates.logo;
        if (updates.banner) v.bannerUrl = updates.banner;
        if (updates.location) v.location = updates.location;
        await v.save();
      }
    } catch (vErr) {
      console.error("Auto-sync vendor on updateMyStore error:", vErr.message);
    }

    return res.status(200).json({
      message: "Store updated successfully",
      store: updatedStore,
      settings: {
        ...updatedStore.toObject(),
        storeSlug: updatedStore.slug,
        phone: updatedStore.contactPhone,
        supportEmail: updatedStore.contactEmail,
      },
    });
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

    // Fetch active products listed by this store's vendor
    const products = await Product.find({ vendor: store.vendor._id, status: "ACTIVE" });

    return res.status(200).json({ store, productsCount: products.length, products });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
