const mongoose = require("mongoose");

const wholesaleProductSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true, index: true },
    name: { type: String, required: true, trim: true },
    shortDescription: { type: String, default: "", trim: true },
    category: { type: String, default: "General", trim: true },
    unit: { type: String, default: "piece", trim: true },
    wholesalePrice: { type: Number, required: true, min: 1 },
    retailPrice: { type: Number, default: 0, min: 0 },
    moq: { type: Number, required: true, min: 1, default: 1 },
    stockQuantity: { type: Number, required: true, min: 0, default: 0 },
    bulkDiscount: { type: Number, default: 0, min: 0, max: 100 },
    // The quantity at which `bulkDiscount` starts to apply. Orders at or below
    // `bulkMinQty` pay the full wholesale price.
    bulkMinQty: { type: Number, default: 1, min: 1 },
    // Minimum stock before the supplier is warned of a low-stock item.
    lowStockThreshold: { type: Number, default: 10, min: 0 },
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
  } else if (this.stockQuantity > 0 && this.status === "OUT_OF_STOCK") {
    this.status = "ACTIVE";
  }
});

module.exports = mongoose.model("WholesaleProduct", wholesaleProductSchema);