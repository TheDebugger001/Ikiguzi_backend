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

      // 4. Proceed to the next middleware or controller
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
