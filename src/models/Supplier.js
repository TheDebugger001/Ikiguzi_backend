const mongoose = require("mongoose");
const crypto = require("crypto");

const slugify = (str) =>
  str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const supplierSchema = new mongoose.Schema(
  {
    publicId: { type: String, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },

    businessName: { type: String, required: true },
    slug: { type: String, unique: true },
    logoUrl: { type: String, default: null },
    description: { type: String, default: "" },
    category: { type: String, default: "" },

    phone: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },

    verificationStatus: {
      type: String,
      enum: ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"],
      default: "UNVERIFIED",
    },
    // Stored by admins when rejecting a verification submission.
    verificationNote: { type: String, default: "" },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    verifiedAt: { type: Date, default: null },
    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED", "BLOCKED", "UNDER_REVIEW"],
      default: "ACTIVE",
    },

    location: { type: mongoose.Schema.Types.Mixed, default: null }, // nullable until you build locations
  },
  { timestamps: true }
);

supplierSchema.pre("save", async function () {
  try {
    const Supplier = mongoose.model("Supplier");

    if (!this.publicId) {
      this.publicId = `MVEC-SUP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    }

    if (!this.slug) {
      const base = slugify(this.businessName || "supplier");
      let candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
      let attempts = 0;
      while (attempts < 5) {
        const exists = await Supplier.findOne({ slug: candidate, _id: { $ne: this._id } });
        if (!exists) break;
        candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
        attempts++;
      }
      this.slug = candidate;
    }
  } catch (error) {
    console.error("Error generating slug for Supplier:", error);
  }
});

module.exports = mongoose.model("Supplier", supplierSchema);
