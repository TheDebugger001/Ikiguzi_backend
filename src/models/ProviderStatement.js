// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("ProviderStatement");
  return;
}

const mongoose = require("mongoose");

const providerStatementSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["MTN_MOMO", "AIRTEL_MONEY"], required: true },
    externalTransactionId: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "RWF", required: true },
    transactionDate: { type: Date, required: true },
    reconciliationStatus: {
      type: String,
      enum: ["MATCHED", "MISMATCHED", "MISSING_IN_LEDGER"],
      default: "MISSING_IN_LEDGER",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProviderStatement", providerStatementSchema);