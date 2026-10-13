// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("AffiliateClick");
  return;
}

const mongoose = require("mongoose");

// One row per tracked referral click. AffiliateLink only keeps a lifetime
// counter, which cannot answer "?range=7d"; timestamps here make the stats
// series possible.
const affiliateClickSchema = new mongoose.Schema(
  {
    affiliateUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    link: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AffiliateLink",
      default: null,
      index: true,
    },
    affiliateCode: { type: String, default: "", index: true },
    buyerUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    visitorIp: { type: String, default: "" },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null, index: true },
    // Random id minted by the server for a browser; powers unique-visitor counts
    // and last-click attribution without storing anything personal.
    visitorId: { type: String, default: "", index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

affiliateClickSchema.index({ affiliateUser: 1, createdAt: -1 });

module.exports = mongoose.model("AffiliateClick", affiliateClickSchema);
