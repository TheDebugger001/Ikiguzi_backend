const mongoose = require("mongoose");

const supplierTeamMemberSchema = new mongoose.Schema(
  {
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      index: true,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    role: {
      type: String,
      enum: ["OPERATIONS", "WAREHOUSE", "FULFILMENT", "FINANCE", "VIEWER"],
      default: "VIEWER",
    },
    status: {
      type: String,
      enum: ["ACTIVE", "INVITED", "SUSPENDED"],
      default: "ACTIVE",
    },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

supplierTeamMemberSchema.index({ supplier: 1, createdAt: -1 });

module.exports = mongoose.model("SupplierTeamMember", supplierTeamMemberSchema);
