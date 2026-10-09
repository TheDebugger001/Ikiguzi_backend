const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        "ORDER",
        "DELIVERY",
        "PAYMENT",
        "PAYOUT",
        "STOCK",
        "REVIEW",
        "MESSAGE",
        "SUBSCRIPTION",
        "ADMIN",
        "SYSTEM",
        "COMMISSION",
        "CAMPAIGN",
        "VERIFICATION",
        "AFFILIATE",
        "SUPPLIER_ORDER",
        "SUPPLY_REQUEST",
      ],
      default: "SYSTEM",
    },

    title: { type: String, required: true },
    message: { type: String, default: "" },
    reference: { type: String, default: "" }, // order/product/payout id or code
    channel: {
      type: String,
      enum: ["IN_APP", "SMS", "PUSH", "EMAIL"],
      default: "IN_APP",
    },

    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
