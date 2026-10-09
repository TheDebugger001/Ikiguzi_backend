const SupplierTeamMember = require("../models/SupplierTeamMember");
const Supplier = require("../models/Supplier");

// What each supplier team role is allowed to DO. Reading (GET) is always
// allowed; these capabilities only guard mutations. The supplier account owner
// is never restricted (handled below).
const CAPABILITIES_BY_ROLE = {
  OPERATIONS: ["catalog", "supply", "analytics"],
  WAREHOUSE: ["supply"],
  FULFILMENT: ["supply"],
  FINANCE: ["finance", "analytics"],
  VIEWER: [],
};

// Staff/team members of a supplier may only perform the actions their team
// role allows. Owners (and super_admins) always pass.
exports.checkSupplierPermission = (capability) => {
  return async (req, res, next) => {
    try {
      if (!req.user || req.user.role !== "supplier") return next();

      const ownedProfile = await Supplier.findOne({ user: req.user._id }).select("_id");
      if (ownedProfile) return next(); // the supplier account owner

      const membership = await SupplierTeamMember.findOne({
        $or: [{ user: req.user._id }, { user_id: req.user._id }],
        status: "ACTIVE",
      });
      if (!membership) {
        return res.status(403).json({ message: "Access denied: you are not an active member of this supplier team." });
      }

      const allowed = CAPABILITIES_BY_ROLE[membership.role] || [];
      if (!allowed.includes(capability)) {
        return res.status(403).json({
          message: `Access denied: your team role (${membership.role}) is not allowed to perform this action.`,
        });
      }

      req.supplierTeamRole = membership.role;
      return next();
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  };
};