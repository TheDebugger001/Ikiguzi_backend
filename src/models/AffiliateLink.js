// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("AffiliateLink");
  return;
}

const mongoose = require("mongoose");

const affiliateLinkSchema = new mongoose.Schema(
  {
    affiliateCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    affiliateUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    targetProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AffiliateCampaign",
      default: null,
      index: true,
    },
    // Affiliate-facing label ("TikTok bio", "General promotion", ...).
    label: {
      type: String,
      default: "",
    },
    lastClickedAt: {
      type: Date,
      default: null,
    },
    clickCount: {
      type: Number,
      default: 0,
    },
    conversionCount: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Termination is a soft state: the document, its clicks, attributions and
    // commission history all stay; only new referrals through it stop.
    status: {
      type: String,
      enum: ["ACTIVE", "TERMINATED"],
      default: "ACTIVE",
      index: true,
    },
    terminatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AffiliateLink", affiliateLinkSchema);