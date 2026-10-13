// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("Advertisement");
  return;
}

const mongoose = require("mongoose");
const crypto = require("crypto");

// Vendor ad placement campaign submitted for MVEC marketplace promotion.
const advertisementSchema = new mongoose.Schema(
  {
    publicId: {
      type: String,
      unique: true,
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    product: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    placement: {
      type: String,
      enum: ["HOMEPAGE_HERO", "CATEGORY_BANNER", "SEARCH_RESULTS", "FEATURED", "PROMOTION"],
      default: "SEARCH_RESULTS",
    },
    budget: {
      type: Number,
      required: [true, "Campaign budget is required"],
      min: 0,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "PAUSED", "REJECTED", "COMPLETED"],
      default: "PENDING",
    },
    impressions: {
      type: Number,
      default: 0,
      min: 0,
    },
    clicks: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

advertisementSchema.pre("save", function () {
  if (!this.publicId) {
    this.publicId = `MVEC-AD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  }
});

module.exports = mongoose.model("Advertisement", advertisementSchema);