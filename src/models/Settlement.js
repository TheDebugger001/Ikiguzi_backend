// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("Settlement");
  return;
}

const mongoose = require("mongoose");

const settlementSchema = new mongoose.Schema(
  {
    settlementReference: { type: String, required: true, unique: true, index: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    orderItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
    grossAmount: { type: Number, required: true },
    commissionAmount: { type: Number, required: true },
    netAmount: { type: Number, required: true },
    developerShare: { type: Number, default: 0 },
    adminShare: { type: Number, default: 0 },
    affiliateShare: { type: Number, default: 0 },
    gatewayFee: { type: Number, default: 0 },
    affiliateUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status: {
      type: String,
      enum: ["HELD", "RELEASED", "ADMIN_HOLD", "REFUNDED", "CANCELLED"],
      default: "HELD",
      required: true,
    },
    releasedAt: { type: Date, default: null },
    adminHoldReason: { type: String, default: null },
  },
  { timestamps: true }
);

settlementSchema.index(
  { order: 1, orderItemId: 1 },
  { unique: true, partialFilterExpression: { orderItemId: { $type: "objectId" } } }
);

module.exports = mongoose.model("Settlement", settlementSchema);