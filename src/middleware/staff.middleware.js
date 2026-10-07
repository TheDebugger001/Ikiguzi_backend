const Staff = require("../models/Staff");
const Store = require("../models/Store");

exports.checkStaffPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      // If user is the store owner (primary vendor) or super admin, pass through
      if (req.user.role === "super_admin") return next();

      const store = await Store.findOne({ vendor: req.user.id });
      if (store) {
        req.store = store;
        return next(); // User is the main owner
      }

      // Check if user is an active staff member of a store
      const staffMember = await Staff.findOne({ user: req.user.id, status: "ACTIVE" });
      if (!staffMember) {
        return res.status(403).json({ message: "Access denied: Not authorized as store owner or staff." });
      }

      // Check granular permission flag
      if (requiredPermission && !staffMember.permissions[requiredPermission]) {
        return res.status(403).json({ 
          message: `Access denied: Missing permission [${requiredPermission}].` 
        });
      }

      req.staff = staffMember;
      req.store = staffMember.store
        ? await Store.findById(staffMember.store)
        : await Store.findOne({ vendor: staffMember.vendorOwner });
      if (!req.store) {
        return res.status(403).json({
          message: "The vendor account has no store yet; store operations are not available.",
        });
      }
      next();
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  };
};