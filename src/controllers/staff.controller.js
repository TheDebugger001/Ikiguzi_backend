const Staff = require("../models/Staff");
const User = require("../models/User");
const authController = require("./auth.controller");
const vendorStaffInvitation = require("../services/vendorStaffInvitation.service");

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

// @desc    Add / Invite a staff member to vendor account
// @route   POST /api/staff
// @access  Private (Vendor Owner Only)
exports.addStaffMember = async (req, res) => {
  try {
    const { email, role, permissions } = req.body;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedEmail) {
      return res.status(400).json({ message: "A staff member email is required." });
    }
    const allowedRoles = ["STORE_MANAGER", "ORDER_MANAGER", "CATALOG_MANAGER"];
    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({ message: "Choose a supported vendor team role." });
    }
    if (
      permissions != null &&
      (typeof permissions !== "object" || Array.isArray(permissions))
    ) {
      return res.status(400).json({ message: "Permissions must be an object." });
    }

    if (
      req.user.email &&
      req.user.email.toLowerCase() === normalizedEmail
    ) {
      return res.status(400).json({ message: "You cannot add yourself as a staff member." });
    }
    const userToInvite = await User.findOne({ email: normalizedEmail });
    if (
      userToInvite &&
      userToInvite._id.toString() === req.user.id.toString()
    ) {
      return res.status(400).json({ message: "You cannot add yourself as a staff member." });
    }
    const existingStaff = await Staff.findOne({
      vendorOwner: req.user.id,
      ...(userToInvite
        ? { $or: [{ email: normalizedEmail }, { user: userToInvite._id }] }
        : { email: normalizedEmail }),
    });
    if (existingStaff) {
      return res.status(400).json({ message: "User is already a member of your team." });
    }

    const { token, tokenHash, expiresAt } =
      vendorStaffInvitation.createInvitationToken();
    let defaultPermissions = permissions || {};
    if (role === "CATALOG_MANAGER") {
      defaultPermissions = { canManageProducts: true, canManageOrders: false, canViewAnalytics: false, canManageSettings: false, ...permissions };
    } else if (role === "ORDER_MANAGER") {
      defaultPermissions = { canManageProducts: false, canManageOrders: true, canViewAnalytics: false, canManageSettings: false, ...permissions };
    } else if (role === "STORE_MANAGER") {
      defaultPermissions = { canManageProducts: true, canManageOrders: true, canViewAnalytics: true, canManageSettings: false, ...permissions };
    }

    const staff = await Staff.create({
      vendorOwner: req.user.id,
      ...(userToInvite ? { user: userToInvite._id } : {}),
      email: normalizedEmail,
      role: role || "ORDER_MANAGER",
      permissions: defaultPermissions,
      status: "INVITED",
      invitationTokenHash: tokenHash,
      invitationExpiresAt: expiresAt,
    });

    try {
      const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000")
        .replace(/\/+$/, "");
      const inviteQuery = `staffInviteToken=${encodeURIComponent(token)}&email=${encodeURIComponent(normalizedEmail)}`;
      const signupUrl = `${frontendUrl}/signup?${inviteQuery}`;
      const loginUrl = `${frontendUrl}/login?${inviteQuery}`;
      const inviterName = req.user.Fullname || "Your vendor account owner";
      const roleLabel = String(role || "ORDER_MANAGER")
        .toLowerCase()
        .replaceAll("_", " ");
      const transporter = authController.getTransporter();
      await transporter.sendMail({
        from: `"MVEC" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
        to: normalizedEmail,
        subject: "You have been invited to a vendor team on MVEC",
        text: [
          `Hello${userToInvite?.Fullname ? ` ${userToInvite.Fullname}` : ""},`,
          "",
          `${inviterName} invited you to join their vendor team as ${roleLabel}.`,
          `Create an account or accept the invitation by ${expiresAt.toLocaleString()}:`,
          signupUrl,
          "",
          `If you already have an account, sign in to accept: ${loginUrl}`,
          "",
          "If you were not expecting this invitation, you can ignore this email.",
        ].join("\n"),
        html: `
          <p>Hello${userToInvite?.Fullname ? ` ${escapeHtml(userToInvite.Fullname)}` : ""},</p>
          <p><strong>${escapeHtml(inviterName)}</strong> invited you to join their vendor team as <strong>${escapeHtml(roleLabel)}</strong>.</p>
          <p>This invitation expires ${escapeHtml(expiresAt.toLocaleString())}.</p>
          <p><a href="${escapeHtml(signupUrl)}">Create an account and join the team</a></p>
          <p>Already have an account? <a href="${escapeHtml(loginUrl)}">Sign in to accept the invitation</a></p>
          <p>If you were not expecting this invitation, you can ignore this email.</p>
        `,
      });
    } catch (emailError) {
      try {
        await staff.deleteOne();
      } catch (cleanupError) {
        console.error("Failed to remove vendor team member after invite email failure:", cleanupError);
      }
      console.error("Vendor team invitation email failed:", emailError);
      return res.status(500).json({
        message: "Could not send the invitation email. Please try again later.",
      });
    }

    return res.status(201).json({
      message: "Invitation email sent successfully.",
      staff: {
        _id: staff._id,
        email: staff.email,
        role: staff.role,
        permissions: staff.permissions,
        status: staff.status,
        createdAt: staff.createdAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get all staff members for logged-in vendor account
// @route   GET /api/staff
// @access  Private (Vendor Owner Only)
exports.getStoreStaff = async (req, res) => {
  try {
    const staffList = await Staff.find({ vendorOwner: req.user.id }).populate(
      "user",
      "Fullname email role",
    );
    return res.status(200).json({ staff: staffList });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Update staff role or permissions
// @route   PUT /api/staff/:id
// @access  Private (Vendor Owner Only)
exports.updateStaffMember = async (req, res) => {
  try {
    const { role, permissions, status } = req.body;

    const staff = await Staff.findById(req.params.id);
    if (!staff)
      return res.status(404).json({ message: "Staff record not found." });

    if (staff.vendorOwner.toString() !== req.user.id.toString()) {
      return res
        .status(403)
        .json({ message: "Unauthorized to modify this staff member." });
    }

    if (staff.status === "INVITED" && status === "ACTIVE") {
      return res.status(400).json({
        message: "The invitee must accept the email invitation before access is activated.",
      });
    }

    if (role) staff.role = role;
    if (status) staff.status = status;
    if (permissions)
      staff.permissions = { ...staff.permissions, ...permissions };

    await staff.save();
    return res
      .status(200)
      .json({ message: "Staff permissions updated", staff });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Remove staff member
// @route   DELETE /api/staff/:id
// @access  Private (Vendor Owner Only)
exports.removeStaffMember = async (req, res) => {
  try {
    const staff = await Staff.findById(req.params.id);
    if (!staff)
      return res.status(404).json({ message: "Staff record not found." });

    if (staff.vendorOwner.toString() !== req.user.id.toString()) {
      return res
        .status(403)
        .json({ message: "Unauthorized to remove this staff member." });
    }

    await staff.deleteOne();
    return res
      .status(200)
      .json({ message: "Staff member removed successfully." });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
