const mongoose = require("mongoose");

const lineSchema = new mongoose.Schema(
  {
    product: { type: String, required: true, trim: true },
    category: { type: String, default: "General", trim: true },
    units: { type: Number, required: true, min: 1 },
    unit: { type: String, required: true, trim: true },
    unitPrice: { type: Number, required: true, min: 0 },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const eventSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    title: { type: String, required: true },
    detail: { type: String, default: "" },
  },
  { _id: false },
);

const supplierSupplyRequestSchema = new mongoose.Schema(
  {
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      index: true,
    },
    reference: { type: String, required: true, unique: true },
    lines: { type: [lineSchema], required: true, validate: [(v) => v.length > 0, "At least one line is required"] },
    neededBy: { type: Date, required: true },
    note: { type: String, default: "" },
    status: {
      type: String,
      enum: ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "SOURCING", "IN_TRANSIT", "RECEIVED", "REJECTED", "CANCELLED"],
      default: "SUBMITTED",
      index: true,
    },
    decision: { type: String, default: "" },
    events: { type: [eventSchema], default: [] },
  },
  { timestamps: true },
);

supplierSupplyRequestSchema.index({ supplier: 1, createdAt: -1 });

module.exports = mongoose.model("SupplierSupplyRequest", supplierSupplyRequestSchema);
