const Staff = require("../models/Staff");
const Store = require("../models/Store");

exports.checkStaffPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      // super_admin always passes
      if (req.user.role === "super_admin") return next();

      // Vendors are the primary owners of their products even without a Store document
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

      // Check if user is an active staff member of a store
      const staffMember = await Staff.findOne({
        $or: [{ user: req.user.id }, { user_id: req.user.id }],
        status: "ACTIVE",
      });

      if (!staffMember) {
        return res.status(403).json({
          message: "Access denied: Not authorized as store owner or staff.",
        });
      }

      // Check granular permission flag (case-insensitive and format-agnostic)
      if (requiredPermission) {
        const perms =
          staffMember.permissions?.toObject?.() ||
          staffMember.permissions ||
          {};

        const normalizedRequired = String(requiredPermission)
          .replace(/[^a-zA-Z]/g, "")
          .toLowerCase();

        let hasPerm = false;

        for (const [k, v] of Object.entries(perms)) {
          if (
            k.replace(/[^a-zA-Z]/g, "").toLowerCase() === normalizedRequired &&
            v === true
          ) {
            hasPerm = true;
            break;
          }
        }

        if (!hasPerm) {
          return res.status(403).json({
            message: `Access denied: Missing permission [${requiredPermission}].`,
          });
        }
      }

      req.staff = staffMember;

      // Get the staff member's store
      req.store = staffMember.store
        ? await Store.findById(staffMember.store)
        : await Store.findOne({ vendor: staffMember.vendorOwner });

      if (!req.store) {
        return res.status(403).json({
          message:
            "The vendor account has no store yet; store operations are not available.",
        });
      }

      req.vendorId = staffMember.vendorOwner;
      req.ownerId = staffMember.vendorOwner;

      next();
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  };
};
