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
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

affiliateClickSchema.index({ affiliateUser: 1, createdAt: -1 });

module.exports = mongoose.model("AffiliateClick", affiliateClickSchema);
