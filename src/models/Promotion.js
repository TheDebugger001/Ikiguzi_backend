// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("Promotion");
  return;
}

const mongoose = require("mongoose");
const crypto = require("crypto");

const promotionSchema = new mongoose.Schema(
  {
    publicId: { type: String, unique: true, index: true },

    // Scope: a promotion can target a vendor's store, a specific product,
    // a category, or the whole platform (admin-created).
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", default: null },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },

    name: { type: String, required: true },
    code: { type: String, required: true, trim: true, uppercase: true },

    // Discount model
    type: {
      type: String,
      enum: ["PERCENT", "FIXED", "FREE_SHIPPING"],
      default: "PERCENT",
    },
    value: { type: Number, default: 0 }, // percentage or fixed RWF amount

    status: {
      type: String,
      enum: ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "EXPIRED", "CANCELLED"],
      default: "DRAFT",
    },

    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },

    usageLimit: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
    minOrderAmount: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

promotionSchema.pre("save", async function () {
  if (!this.publicId) {
    this.publicId = `MVEC-PRM-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  }
});

module.exports = mongoose.model("Promotion", promotionSchema);
