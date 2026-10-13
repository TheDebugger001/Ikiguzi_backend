// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("LedgerAccount");
  return;
}

const mongoose = require("mongoose");

const ledgerAccountSchema = new mongoose.Schema(
  {
    accountNumber: { type: String, required: true, unique: true, index: true },
    accountType: {
      type: String,
      enum: [
        "ESCROW_HOLDING",
        "PLATFORM_REVENUE",
        "VENDOR_PAYABLE",
        "SUPPLIER_PAYABLE",
        "COURIER_PAYABLE",
        "BUYER_REFUND_HOLD",
        "DEVELOPER_REVENUE",
        "ADMIN_REVENUE",
        "AFFILIATE_COMMISSION",
        "GATEWAY_FEES",
      ],
      required: true,
    },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    currency: { type: String, default: "RWF", required: true },
    balance: { type: Number, default: 0, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LedgerAccount", ledgerAccountSchema);