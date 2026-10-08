const mongoose = require("mongoose");

// A promotional campaign affiliates can join. Joined campaigns decide which
// commission rate applies to the links generated for them.
const affiliateCampaignSchema = new mongoose.Schema(
  {
    campaignCode: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    banner: { type: String, default: "" },
    commissionRate: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["ACTIVE", "PAUSED", "EXPIRED"],
      default: "ACTIVE",
      index: true,
    },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    members: [
      {
        affiliateUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        joinedAt: { type: Date, default: Date.now },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

affiliateCampaignSchema.methods.isMember = function (userId) {
  const id = String(userId);
  return (this.members || []).some((m) => String(m.affiliateUser) === id);
};

module.exports = mongoose.model("AffiliateCampaign", affiliateCampaignSchema);
