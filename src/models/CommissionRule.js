// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("CommissionRule");
  return;
}

const mongoose = require("mongoose");

const commissionRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    ruleType: {
      type: String,
      enum: ["GLOBAL", "CATEGORY", "VENDOR", "PRODUCT"],
      required: true,
    },
    // Target entity ID based on ruleType
    targetCategory: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    targetVendor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    targetProduct: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },

    rateType: {
      type: String,
      enum: ["PERCENTAGE", "FIXED"],
      default: "PERCENTAGE",
      required: true,
    },
    rateValue: { type: Number, required: true, min: 0 }, // e.g., 10 for 10% or 1000 for 1000 RWF
    priority: { type: Number, default: 0 }, // Higher number overrides lower priority
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CommissionRule", commissionRuleSchema);