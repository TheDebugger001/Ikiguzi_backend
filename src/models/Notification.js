// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("Notification");
  return;
}

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
      ],
      default: "SYSTEM",
    },

    title: { type: String, required: true },
    message: { type: String, default: "" },
    reference: { type: String, default: "" }, // order/product/payout id or code
    // In-app page the notification opens (e.g. /orders/<id>).
    link: { type: String, default: "" },
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
