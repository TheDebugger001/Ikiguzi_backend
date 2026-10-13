// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("Order");
  return;
}

const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: false,
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Category",
  },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  image: { type: String },
  // Server-resolved last-click attribution for this item (never client supplied).
  affiliateUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  affiliateLink: { type: mongoose.Schema.Types.ObjectId, ref: "AffiliateLink", default: null },
  affiliateCode: { type: String, default: null },
  affiliateClickedAt: { type: Date, default: null },
});

const orderSchema = new mongoose.Schema(
  {
    // Buyer account. Manual orders for walk-in / phone customers may have none;
    // their contact details are kept in `customer`.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function () { return this.source !== "MANUAL"; },
    },
    // ONLINE = placed by the buyer at checkout; MANUAL = recorded by the seller.
    source: { type: String, enum: ["ONLINE", "MANUAL"], default: "ONLINE", index: true },
    customer: {
      name: String,
      phone: String,
      email: String,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Paid to the seller outside MVEC (cash / MoMo / bank): no escrow, no wallet credit.
    paidOffline: { type: Boolean, default: false },
    offlinePaymentMethod: { type: String, enum: ["CASH", "MOMO", "BANK", null], default: null },
    sellerNote: { type: String, default: "", maxlength: 500 },
    orderNumber: {
      type: String,
      unique: true,
      required: true,
    },
    items: [orderItemSchema],
    shippingAddress: {
      street: { type: String, required: true },
      // District (Rwanda) / city.
      city: { type: String, required: true },
      province: { type: String },
      sector: { type: String },
      // Legacy field: older orders stored the province or sector here.
      state: { type: String },
      country: { type: String, required: true },
      postalCode: String,
      province: String,
      district: String,
      sector: String,
    },
    // Who receives the parcel. Couriers and sellers need a phone number to
    // deliver; it is captured at checkout because it may differ from the
    // account holder's.
    recipient: {
      name: { type: String },
      phone: { type: String },
      email: { type: String },
    },
    deliveryMethod: {
      type: String,
      enum: ["standard", "express"],
      default: "standard",
    },
    // subtotal (products) + shippingFee = totalAmount, all computed server side.
    subtotal: { type: Number },
    shippingFee: { type: Number, default: 0 },
    shippingMethod: { type: String, enum: ["STANDARD", "EXPRESS", "PICKUP"], default: "STANDARD" },
    // One entry per parcel (seller store); fee is paid to that seller with no commission.
    shippingBreakdown: [
      {
        _id: false,
        vendor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", default: null },
        storeName: String,
        zone: { type: mongoose.Schema.Types.ObjectId, ref: "ShippingZone", default: null },
        zoneName: String,
        method: String,
        fee: { type: Number, default: 0 },
        eta: String,
      },
    ],
    totalAmount: { type: Number, required: true },
    paidAt: Date,
    paymentStatus: {
      type: String,
      // DISPUTED freezes a paid order (no delivery release, no cancellation)
      // until an admin resolves the dispute.
      enum: ["PENDING", "CONFIRMED", "PAID", "FAILED", "REFUNDED", "DISPUTED"],
      default: "PENDING",
    },
    orderStatus: {
      type: String,
      enum: [
        "PENDING",
        "CONFIRMED",
        "PROCESSING",
        "READY_FOR_SHIPMENT",
        "SHIPPED",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
        "RETURNED",
        "REFUNDED",
        "FAILED",
      ],
      default: "PENDING",
    },
    paymentMethod: {
      type: String,
      enum: ["MOMO", "AIRTEL", "CASH_ON_DELIVERY", "CARD", "BANK", "CASH"],
      default: "MOMO",
    },
    deliveryOtp: String,
    // Wrong delivery codes entered; locked after 5 so it cannot be guessed.
    deliveryOtpAttempts: { type: Number, default: 0 },
    // Courier assigned by an admin (role "delivery"). Optional: a vendor can
    // also deliver its own items and confirm with the buyer's code.
    courier: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Vendors whose items were handed over (multi-vendor orders complete when all are in).
    deliveredVendors: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    shippedAt: Date,
    paymentReminderSentAt: Date,
    isDelivered: {
      type: Boolean,
      default: false,
    },
    deliveredAt: Date,
    slaBreached: {
      type: Boolean,
      default: false,
    },
    slaBreachedAt: {
      type: Date,
    },
    cancellationReason: {
      type: String,
    },
    adminNotes: {
      type: String,
    },
    paymentReference: String,
    affiliateCode: { type: String, default: null },
    affiliateUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    // Expose `id` alongside `_id` so clients can rely on a single field.
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Expose `id` alongside `_id` (checkout redirects to /payment/:id).
orderSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("Order", orderSchema);
