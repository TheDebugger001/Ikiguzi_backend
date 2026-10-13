// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("StockMovement");
  return;
}

const mongoose = require("mongoose");

// Audit trail of every manual inventory operation a seller performs.
const stockMovementSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    productName: { type: String, default: "" }, // kept if the product is later deleted
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", default: null, index: true },
    type: {
      type: String,
      enum: ["RESTOCK", "REMOVE", "COUNT", "TRANSFER"],
      required: true,
    },
    // Signed change in units (0 for transfers between stores).
    quantity: { type: Number, default: 0 },
    before: { type: Number, default: null },
    after: { type: Number, default: null },
    fromStore: { type: mongoose.Schema.Types.ObjectId, ref: "Store", default: null },
    toStore: { type: mongoose.Schema.Types.ObjectId, ref: "Store", default: null },
    reason: { type: String, default: "" },
    note: { type: String, default: "", maxlength: 300 },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

stockMovementSchema.index({ vendor: 1, createdAt: -1 });
stockMovementSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("StockMovement", stockMovementSchema);
