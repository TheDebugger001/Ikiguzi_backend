// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("AbuseReport");
  return;
}

const mongoose = require("mongoose");

const abuseReportSchema = new mongoose.Schema(
  {
    reportNumber: {
      type: String,
      unique: true,
      index: true,
    },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    targetStore: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      default: null,
    },
    targetRole: {
      type: String,
      enum: ["buyer", "vendor", "supplier", "affiliate", "super_admin", "developer"],
    },
    relatedOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    reasonCategory: {
      type: String,
      enum: [
        "FRAUDULENT_ACTIVITY",
        "HARASSMENT_OR_ABUSE",
        "NON_COMPLIANT_PRODUCT_OR_ORDER",
        "OTHER_POLICY_VIOLATION",
      ],
      required: true,
    },
    description: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    evidenceUrls: [String],
    incidentDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["INVESTIGATE", "PENDING", "RESOLVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    adminNotes: {
      type: String,
      default: "",
    },
    resolvedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("AbuseReport", abuseReportSchema);