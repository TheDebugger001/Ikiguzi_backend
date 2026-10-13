// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("BuyerSubscription");
  return;
}

const mongoose = require("mongoose");
const crypto = require("crypto");

const buyerSubscriptionSchema = new mongoose.Schema(
  {
    publicId: {
      type: String,
      unique: true,
      index: true,
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    plan: {
      type: String,
      enum: ["FREE", "PREMIUM"],
      default: "FREE",
    },
    status: {
      type: String,
      enum: ["ACTIVE", "CANCELLED", "EXPIRED"],
      default: "ACTIVE",
    },
    price: {
      type: Number,
      default: 0,
      min: 0,
    },
    billingCycle: {
      type: String,
      enum: ["FREE", "MONTHLY", "YEARLY"],
      default: "FREE",
    },
    startDate: {
      type: Date,
      default: null,
    },
    renewalDate: {
      type: Date,
      default: null,
    },
    autoRenew: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

buyerSubscriptionSchema.pre("save", function () {
  if (!this.publicId) {
    this.publicId = `MVEC-BSUB-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  }
  if (!this.startDate) this.startDate = new Date();
  if (this.status === "ACTIVE" && !this.renewalDate && this.billingCycle !== "FREE") {
    const renewal = new Date(this.startDate);
    if (this.billingCycle === "YEARLY") renewal.setFullYear(renewal.getFullYear() + 1);
    else if (this.billingCycle === "MONTHLY") renewal.setMonth(renewal.getMonth() + 1);
    this.renewalDate = renewal;
  }
});

module.exports = mongoose.model("BuyerSubscription", buyerSubscriptionSchema);
