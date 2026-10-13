// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("Otp");
  return;
}

const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      index: true,
    },
    // Hashed OTP code (sha256) — raw code is never stored
    codeHash: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      enum: ["registration", "login"],
      required: true,
    },
    // Convenience field: optional email captured at send-time on registration
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    // Number of failed verification attempts for this code
    attempts: {
      type: Number,
      default: 0,
    },
    // Guards against re-sending too frequently for the same phone+purpose
    lastSentAt: {
      type: Date,
      default: null,
    },
    // True once the code has been successfully verified and consumed
    consumed: {
      type: Boolean,
      default: false,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

otpSchema.index({ phone: 1, purpose: 1 });

const Otp = mongoose.model("Otp", otpSchema);

module.exports = Otp;
