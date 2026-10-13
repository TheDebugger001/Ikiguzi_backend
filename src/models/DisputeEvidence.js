// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("DisputeEvidence");
  return;
}

const mongoose = require("mongoose");

const disputeEvidenceSchema = new mongoose.Schema(
  {
    dispute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Dispute",
      required: true,
      index: true,
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderRole: {
      type: String,
      enum: ["buyer", "vendor", "super_admin"],
      required: true,
    },
    message: {
      type: String,
      trim: true,
    },
    attachments: [
      {
        fileUrl: { type: String, required: true },
        fileType: { type: String, enum: ["image", "pdf", "video", "document"] },
        fileName: { type: String },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("DisputeEvidence", disputeEvidenceSchema);