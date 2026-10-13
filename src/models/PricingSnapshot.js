// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("PricingSnapshot");
  return;
}

const mongoose = require("mongoose");

const pricingSnapshotSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    
    unitPrice: { type: Number, required: true }, // Base price at checkout
    quantity: { type: Number, required: true },
    grossTotal: { type: Number, required: true }, // unitPrice * quantity
    
    // Applied Dynamic Commission
    commissionRuleApplied: { type: mongoose.Schema.Types.ObjectId, ref: "CommissionRule", default: null },
    commissionRateType: { type: String, enum: ["PERCENTAGE", "FIXED"], required: true },
    commissionRateValue: { type: Number, required: true },
    commissionAmount: { type: Number, required: true }, // Total platform cut for this item
    
    vendorNetEarnings: { type: Number, required: true },
    developerShare: { type: Number, default: 0 },
    adminShare: { type: Number, default: 0 },
    affiliateShare: { type: Number, default: 0 },
    gatewayFee: { type: Number, default: 0 },
    hasAffiliate: { type: Boolean, default: false },
    currency: { type: String, default: "RWF", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PricingSnapshot", pricingSnapshotSchema);