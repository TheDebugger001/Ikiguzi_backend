// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("LedgerEntry");
  return;
}

const mongoose = require("mongoose");

const ledgerEntrySchema = new mongoose.Schema(
  {
    transactionReference: { type: String, required: true, index: true },
    debitAccount: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerAccount", required: true },
    creditAccount: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerAccount", required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "RWF", required: true },
    entryType: {
      type: String,
      enum: [
        "PAYMENT_ESCROW_LOCK",
        "ESCROW_RELEASE_VENDOR",
        "PLATFORM_COMMISSION_DEDUCTION",
        "COURIER_FEE_PAYOUT",
        "BUYER_REFUND",
        "ADMIN_MANUAL_ADJUSTMENT",
      ],
      required: true,
    },
    relatedOrder: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    description: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LedgerEntry", ledgerEntrySchema);