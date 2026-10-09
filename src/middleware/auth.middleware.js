const jwt = require("jsonwebtoken");
const User = require("../models/User"); // Adjust path to your User model
const Vendor = require("../models/Vendor");
const Supplier = require("../models/Supplier");
const SupplierTeamMember = require("../models/SupplierTeamMember");

exports.protect = async (req, res, next) => {
  let token;

  // 1. Check if Authorization header exists and starts with 'Bearer'
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      // Extract token string (e.g., "Bearer eyJhbGciOi...")
      token = req.headers.authorization.split(" ")[1];

      // 2. Verify token signature and expiration
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 3. Attach user data to request object (excluding password)
      req.user = await User.findById(decoded.userId || decoded.id).select("-password");

      if (!req.user) {
        return res.status(401).json({ message: "User no longer exists" });
      }

      // 4. Reject suspended/blocked/deleted accounts at the gate so they
      //    cannot keep acting through previously-issued tokens.
      if (req.user.status && req.user.status !== "ACTIVE") {
        return res.status(403).json({
          message: `Your account is ${req.user.status}. Contact support.`,
          code: "ACCOUNT_NOT_ACTIVE",
        });
      }

      // 5. Proceed to the next middleware or controller
      return next();
    } catch (error) {
      console.error("Auth Middleware Error:", error.message);
      return res.status(401).json({ message: "Not authorized, token failed" });
    }
  }

  // If no token is provided in the headers
  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token provided" });
  }
};

// Like `protect`, but does not reject a request when no token is present. Used
// for public routes that may behave differently for anonymous visitors
// (e.g. affiliate link tracking).
exports.optionalAuth = async (req, res, next) => {
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      const decoded = jwt.verify(req.headers.authorization.split(" ")[1], process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId || decoded.id).select("-password");
      if (user) req.user = user;
    } catch (error) {
      // Ignore invalid optional tokens.
    }
  }
  return next();
};

// Restrict endpoint access to specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    const isAdminSeller = req.user.role === "super_admin" && req.user.isSellerEnabled;
    if (!roles.includes(req.user.role) && !(isAdminSeller && roles.includes("vendor"))) {
      return res.status(403).json({
        message: `User role '${req.user.role}' is not authorized to access this route`,
      });
    }
    next();
  };
};

exports.requireOnboarded = async (req, res, next) => {
  if (!["vendor", "supplier"].includes(req.user.role) || (req.user.role === "super_admin" && req.user.isSellerEnabled)) return next();
  const Profile = req.user.role === "vendor" ? Vendor : Supplier;
  let profile = await Profile.findOne({ user: req.user._id }).lean();
  if (!profile && req.user.role === "supplier") {
    const membership = await SupplierTeamMember.findOne({ user: req.user._id, status: "ACTIVE" }).lean();
    if (membership) profile = await Supplier.findById(membership.supplier).lean();
  }
  const complete = Boolean(profile?.businessName && profile?.email && profile?.phone && profile?.description && profile?.logoUrl && profile?.category && profile?.location);
  if (!complete) {
    return res.status(403).json({ message: "Complete onboarding before using this action.", code: "ONBOARDING_REQUIRED" });
  }
  return next();
};

// Requires the requesting user to be a supplier owner. Team members must first
// be resolved to their supplier via `resolveSupplierContext`.
exports.requireSupplierOwner = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authorized, no token provided" });
  if (req.user.role !== "supplier") {
    return res.status(403).json({ message: "Supplier only" });
  }
  const owner = await Supplier.findOne({ user: req.user._id }).select("_id status verificationStatus").lean();
  if (!owner) return res.status(403).json({ message: "Supplier profile not found" });
  if (owner.status !== "ACTIVE") {
    return res.status(403).json({ message: `Supplier account is ${owner.status}` });
  }
  return next();
};

// Resolves the supplier profile for the requesting user (owner or active team
// member) and attaches `req.supplier` for downstream controllers.
exports.resolveSupplierContext = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authorized, no token provided" });
  if (req.user.role === "super_admin" && req.user.isSupplierEnabled) {
    return next();
  }
  if (req.user.role !== "supplier") {
    return res.status(403).json({ message: "Supplier only" });
  }
  const owner = await Supplier.findOne({ user: req.user._id }).select("-__v").lean();
  if (owner) {
    req.supplier = owner;
    return next();
  }
  // Team member: resolve through an active membership record.
  const membership = await SupplierTeamMember.findOne({ user: req.user._id, status: "ACTIVE" }).lean();
  if (membership) {
    const supplier = await Supplier.findById(membership.supplier).select("-__v").lean();
    if (supplier) {
      req.supplier = supplier;
      req.membership = membership;
      return next();
    }
  }
  return res.status(403).json({ message: "Supplier profile not found" });
};

// Permission check for supplier owner-only actions. Team members are only
// allowed through when they have the matching permission flag.
exports.requireSupplierPermission = (permission) => {
  return (req, res, next) => {
    if (!req.supplier) return res.status(403).json({ message: "Supplier context missing" });
    if (String(req.supplier.user) === String(req.user._id)) return next();
    const membership = req.membership;
    const perms = membership?.permissions || [];
    if (permission && permission !== "ALL" && !perms.includes(permission) && !perms.includes("ALL")) {
      return res.status(403).json({ message: `Missing permission: ${permission}` });
    }
    return next();
  };
};
