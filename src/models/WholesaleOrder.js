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
          ref: "WholesaleProduct",
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
    // Platform commission deducted on release (0 until fees are configured).
    commissionAmount: { type: Number, default: 0, min: 0 },
    // Amount actually credited to the supplier on release (total - commission).
    netAmount: { type: Number, default: 0, min: 0 },
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
    paymentStatus: {
      type: String,
      enum: ["PENDING", "PAID", "REFUNDED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    paymentRef: { type: String, default: null },
    // Delivery / fulfilment details raised by the vendor at order time.
    deliveryAddress: { type: String, default: "" },
    contactName: { type: String, default: "" },
    contactPhone: { type: String, default: "" },
    note: { type: String, default: "" },
    // Shipping details captured by the supplier when the order is dispatched.
    trackingNumber: { type: String, default: "" },
    carrier: { type: String, default: "" },
    shipNote: { type: String, default: "" },
    expectedDeliveryAt: { type: Date, default: null },
    // Delivery confirmation OTP: stored hashed, never returned to clients.
    otpHash: { type: String, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    otpLocked: { type: Boolean, default: false, select: false },
    // Auto-release / auto-cancel SLA deadlines.
    autoReleaseAt: { type: Date, default: null },
    autoCancelAt: { type: Date, default: null },
    shippedAt: { type: Date },
    deliveredAt: { type: Date },
    confirmedAt: { type: Date },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, default: "" },
    disputeReason: { type: String, default: "" },
  },
  { timestamps: true }
);

wholesaleOrderSchema.index({ supplier: 1, status: 1, createdAt: -1 });
wholesaleOrderSchema.index({ vendor: 1, createdAt: -1 });

module.exports = mongoose.model("WholesaleOrder", wholesaleOrderSchema);