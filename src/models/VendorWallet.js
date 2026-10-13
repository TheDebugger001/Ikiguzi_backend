// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("VendorWallet");
  return;
}

const mongoose = require("mongoose");

const vendorWalletSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    pendingBalance: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    availableBalance: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    totalEarned: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    totalWithdrawn: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    currency: {
      type: String,
      default: "RWF",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VendorWallet", vendorWalletSchema);