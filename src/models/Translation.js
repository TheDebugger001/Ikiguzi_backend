// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("Translation");
  return;
}

const mongoose = require("mongoose");

const translationSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, "Translation key is required"],
      unique: true,
      trim: true,
      index: true, // e.g., "auth.login_title", "cart.checkout_btn"
    },
    module: {
      type: String,
      default: "common",
      trim: true,
      index: true, // e.g., "common", "checkout", "auth"
    },
    translations: {
      en: { type: String, required: true, trim: true },
      rw: { type: String, required: true, trim: true },
      fr: { type: String, required: true, trim: true },
    },
    isApproved: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Translation", translationSchema);