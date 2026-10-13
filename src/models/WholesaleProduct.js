// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("WholesaleProduct");
  return;
}

const mongoose = require("mongoose");

const wholesaleProductSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true, index: true },
    name: { type: String, required: true, trim: true },
    shortDescription: { type: String, default: "", trim: true },
    category: { type: String, default: "General", trim: true },
    unit: { type: String, default: "piece", trim: true },
    wholesalePrice: { type: Number, required: true, min: 0 },
    retailPrice: { type: Number, default: 0, min: 0 },
    moq: { type: Number, required: true, min: 1, default: 1 },
    stockQuantity: { type: Number, required: true, min: 0, default: 0 },
    bulkDiscount: { type: Number, default: 0, min: 0, max: 100 },
    media: {
      mainImage: { type: String, default: "" },
      gallery: { type: [String], default: [] },
    },
    status: {
      type: String,
      enum: ["ACTIVE", "OUT_OF_STOCK", "ARCHIVED"],
      default: "ACTIVE",
      index: true,
    },
  },
  { timestamps: true }
);

wholesaleProductSchema.pre("validate", function () {
  if (this.stockQuantity <= 0 && this.status !== "ARCHIVED") {
    this.status = "OUT_OF_STOCK";
  }
});

module.exports = mongoose.model("WholesaleProduct", wholesaleProductSchema);