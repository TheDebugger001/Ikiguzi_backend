// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("WholesaleOrder");
  return;
}

const mongoose = require("mongoose");

const wholesaleOrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        productName: { type: String, required: true },
        unitPrice: { type: Number, required: true, min: 0 },
        quantity: { type: Number, required: true, min: 1 },
        moq: { type: Number, required: true, min: 1 },
      },
    ],
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: [
        "PENDING_PAYMENT",
        "ESCROW_HELD",
        "SHIPPED",
        "DELIVERED",
        "CONFIRMED_RELEASED",
        "DISPUTED",
        "CANCELLED",
      ],
      default: "PENDING_PAYMENT",
      index: true,
    },
    deliveryOtp: {
      type: String,
      select: false, // Hidden by default for security
    },
    shippedAt: { type: Date },
    deliveredAt: { type: Date },
    confirmedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WholesaleOrder", wholesaleOrderSchema);