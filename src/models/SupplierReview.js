const mongoose = require("mongoose");

const supplierReviewSchema = new mongoose.Schema(
  {
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    wholesaleOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WholesaleOrder",
      required: true,
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: "", trim: true },
    reply: { type: String, default: "" },
  },
  { timestamps: true },
);

supplierReviewSchema.index({ supplier: 1, vendor: 1, wholesaleOrder: 1 }, { unique: true });
supplierReviewSchema.index({ supplier: 1, createdAt: -1 });

module.exports = mongoose.model("SupplierReview", supplierReviewSchema);
