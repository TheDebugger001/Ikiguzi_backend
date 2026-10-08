const Staff = require("../models/Staff");
const Store = require("../models/Store");

exports.checkStaffPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      // super_admin always passes
      if (req.user.role === "super_admin") return next();

      // A staff account also has role "vendor". Resolve staff membership first
      // so its granular permissions cannot be bypassed by the broad role check.
      const staffMember = await Staff.findOne({
        $or: [{ user: req.user.id }, { user_id: req.user.id }],
        status: "ACTIVE",
      });

      if (staffMember) {
        if (requiredPermission) {
          const perms = staffMember.permissions?.toObject?.() || staffMember.permissions || {};
          const normalizedRequired = String(requiredPermission).replace(/[^a-zA-Z]/g, "").toLowerCase();
          const hasPerm = Object.entries(perms).some(([key, value]) =>
            key.replace(/[^a-zA-Z]/g, "").toLowerCase() === normalizedRequired && value === true,
          );
          if (!hasPerm) {
            return res.status(403).json({
              message: `Access denied: Missing permission [${requiredPermission}].`,
            });
          }
        }

        req.staff = staffMember;
        req.store = staffMember.store
          ? await Store.findById(staffMember.store)
          : await Store.findOne({ vendor: staffMember.vendorOwner });
        if (!req.store) {
          return res.status(403).json({ message: "The vendor account has no store yet; store operations are not available." });
        }
        req.vendorId = staffMember.vendorOwner;
        req.ownerId = staffMember.vendorOwner;
        return next();
      }

      // Vendors without a staff membership are the primary owners.
      if (req.user.role === "vendor") {
        req.vendorId = req.user.id;
        req.ownerId = req.user.id;
        return next();
      }

      // Check whether the user owns or manages a store
      const store = await Store.findOne({
        $or: [{ owner: req.user.id }, { vendor: req.user.id }],
      });

      if (store) {
        req.store = store;
        req.vendorId = store.vendor;
        req.ownerId = store.vendor;
        return next(); // User is the main store owner
      }

      return res.status(403).json({ message: "Access denied: Not authorized as store owner or staff." });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  };
};
