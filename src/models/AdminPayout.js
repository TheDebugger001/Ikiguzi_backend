// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("AdminPayout");
  return;
}

const mongoose = require("mongoose");

const adminPayoutSchema = new mongoose.Schema(
  {
    payoutNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    adminUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1000, "Minimum payout request amount is 1,000 RWF"],
    },
    paymentMethod: {
      type: String,
      enum: ["MOMO", "AIRTEL"],
      default: "MOMO",
    },
    accountDetails: {
      accountName: { type: String, required: true },
      accountNumber: { type: String, required: true },
      bankName: { type: String, default: "MTN MoMo" },
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "PAID", "REJECTED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    transactionReference: { type: String },
    rejectionReason: { type: String },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminPayout", adminPayoutSchema);
