const mongoose = require("mongoose");
const crypto = require("crypto");

const slugify = (str) =>
  str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const vendorSchema = new mongoose.Schema(
  {
    publicId: { type: String, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },

    businessName: { type: String, required: true },
    slug: { type: String, unique: true },
    logoUrl: { type: String, default: null },
    bannerUrl: { type: String, default: null },
    description: { type: String, default: "" },
    category: { type: String, default: "" },

    phone: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },

    commissionRate: { type: Number, default: 0 }, // e.g., platform percentage commission

    verificationStatus: {
      type: String,
      enum: ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"],
      default: "UNVERIFIED",
    },
    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    status: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED", "BLOCKED", "UNDER_REVIEW"],
      default: "ACTIVE",
    },

    location: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// Async pre-save hook without passing `next` to prevent Express/Mongoose middleware errors
vendorSchema.pre("save", async function () {
  const Vendor = mongoose.model("Vendor");

  if (!this.publicId) {
    this.publicId = `MVEC-VND-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  }

  if (this.isModified("businessName") || !this.slug) {
    const base = slugify(this.businessName);
    let candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
    let attempts = 0;

    while (attempts < 5) {
      const exists = await Vendor.findOne({ slug: candidate, _id: { $ne: this._id } });
      if (!exists) break;
      candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
      attempts++;
    }

    this.slug = candidate;
  }
});

module.exports = mongoose.model("Vendor", vendorSchema);
