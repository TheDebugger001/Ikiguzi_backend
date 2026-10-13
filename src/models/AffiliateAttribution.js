// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("AffiliateAttribution");
  return;
}

const mongoose = require("mongoose");

// Last-click attribution: at most one row per (visitor, product). A new click
// on any eligible affiliate link for that product overwrites the row and
// restarts the referral window. Checkout reads this table server-side, so the
// browser only ever holds an opaque visitorId, never an affiliate or price.
const affiliateAttributionSchema = new mongoose.Schema(
  {
    visitorId: { type: String, required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    link: { type: mongoose.Schema.Types.ObjectId, ref: "AffiliateLink", required: true },
    affiliateUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    affiliateCode: { type: String, required: true },
    clickedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

affiliateAttributionSchema.index({ visitorId: 1, product: 1 }, { unique: true });

module.exports = mongoose.model("AffiliateAttribution", affiliateAttributionSchema);
