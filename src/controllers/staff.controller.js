const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const Staff = require("../models/Staff");
const Store = require("../models/Store");
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

const STAFF_ROLES = new Set([
  "STORE_MANAGER",
  "ORDER_MANAGER",
  "CATALOG_MANAGER",
]);

const PERMISSIONS = {
  VIEWDASHBOARD: "canViewDashboard",
  MANAGEPRODUCTS: "canManageProducts",
  MANAGEORDERS: "canManageOrders",
  MANAGEPAYOUTS: "canManagePayouts",
  MANAGESTAFF: "canManageStaff",
  VIEWANALYTICS: "canViewAnalytics",
  MANAGESETTINGS: "canManageSettings",
};

function normalizeRole(role) {
  const value = String(role || "staff")
    .trim()
    .toUpperCase();

  if (value === "MANAGER") return "STORE_MANAGER";
  if (value === "STAFF") return "ORDER_MANAGER";

  return value;
}

function permissionsFor(role, requested) {
  const defaults = {
    canViewDashboard: true,
    canManageProducts: role === "STORE_MANAGER" || role === "CATALOG_MANAGER",
    canManageOrders: role === "STORE_MANAGER" || role === "ORDER_MANAGER",
    canManagePayouts: false,
    canManageStaff: false,
    canViewAnalytics: role === "STORE_MANAGER",
    canManageSettings: false,
  };

  if (Array.isArray(requested)) {
    for (const slug of requested) {
      const key = PERMISSIONS[String(slug).replaceAll("_", "").toUpperCase()];

      if (key) {
        defaults[key] = true;
      }
    }
  } else if (
    requested &&
    typeof requested === "object" &&
    !Array.isArray(requested)
  ) {
    for (const [slug, value] of Object.entries(requested)) {
      const key =
        PERMISSIONS[String(slug).replaceAll("_", "").toUpperCase()] || slug;

      if (Object.hasOwn(defaults, key) && typeof value === "boolean") {
        defaults[key] = value;
      }
    }
  }

  return defaults;
}

function staffDto(staff) {
  const user = staff.user || {};

  const permissions =
    staff.permissions?.toObject?.() || staff.permissions || {};

  return {
    _id: staff._id,
    id: staff._id,
    name: user.Fullname || "Team member",
    email: user.email || staff.email || "",
    phone: user.phone || null,

    role: staff.role,
    permission_role: staff.role,

    status: staff.status,
    active: staff.status === "ACTIVE",

    store_id: staff.store,
    vendor_id: staff.vendorOwner,
    user_id: user._id || staff.user,

    permissions: Object.entries(PERMISSIONS)
      .filter(([, key]) => permissions[key])
      .map(([slug]) => slug),

    permissionsMap: permissions,

    createdAt: staff.createdAt,
  };
}

async function storeForOwner(ownerId) {
  let store = await Store.findOne({
    vendor: ownerId,
  });

  if (!store) {
    const Vendor = require("../models/Vendor");

    const vendor = await Vendor.findOne({
      user: ownerId,
    });

    if (vendor) {
      const createSlug = (text) =>
        String(text)
          .toLowerCase()
          .trim()
          .replace(/\s+/g, "-")
          .replace(/[^\w-]+/g, "")
          .replace(/--+/g, "-");

      let slug = createSlug(vendor.businessName);

      const existingStore = await Store.findOne({
        slug,
      });

      if (existingStore) {
        slug = `${slug}-${Date.now().toString(36)}`;
      }

      store = await Store.create({
        vendor: ownerId,
        storeName: vendor.businessName,
        slug,
        contactEmail: vendor.email,
        contactPhone: vendor.phone,
        status: "ACTIVE",
      });
    }
  }

  return store;
}

// @desc    Add / Invite a staff member to vendor account
// @route   POST /api/staff
// @access  Private (Vendor Owner Only)
exports.addStaffMember = async (req, res) => {
  let createdUser = null;
  let createdStaff = null;

  try {
    const name = String(req.body.name || req.body.Fullname || "").trim();

    const normalizedEmail =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password = req.body.password;
    const phone = req.body.phone || req.body.phoneNumber || null;

    const role = normalizeRole(req.body.role || req.body.permission_role);

    if (!normalizedEmail) {
      return res.status(400).json({
        message: "A staff member email is required.",
      });
    }

    if (!normalizedEmail.includes("@")) {
      return res.status(400).json({
        message: "Please provide a valid email.",
      });
    }

    if (!STAFF_ROLES.has(role)) {
      return res.status(400).json({
        message: "Choose a valid staff role.",
      });
    }

    if (
      req.body.permissions != null &&
      typeof req.body.permissions !== "object"
    ) {
      return res.status(400).json({
        message: "Permissions must be an object or array.",
      });
    }

    if (req.user.email && req.user.email.toLowerCase() === normalizedEmail) {
      return res.status(400).json({
        message: "You cannot add yourself as a staff member.",
      });
    }

    const userToInvite = await User.findOne({
      email: normalizedEmail,
    });

    if (
      userToInvite &&
      userToInvite._id.toString() === req.user.id.toString()
    ) {
      return res.status(400).json({
        message: "You cannot add yourself as a staff member.",
      });
    }

    const existingStaff = await Staff.findOne({
      vendorOwner: req.user.id,
      ...(userToInvite
        ? {
            $or: [
              {
                email: normalizedEmail,
              },
              {
                user: userToInvite._id,
              },
            ],
          }
        : {
            email: normalizedEmail,
          }),
    });

    if (existingStaff) {
      return res.status(400).json({
        message: "User is already a member of your team.",
      });
    }

    const store = await storeForOwner(req.user.id);

    if (!store) {
      return res.status(404).json({
        message: "You must create a store before adding staff.",
      });
    }

    const permissions = permissionsFor(role, req.body.permissions);

    /*
     * --------------------------------------------------
     * MODE 1: Direct account creation
     *
     * This preserves the Mvec backend behavior.
     * If the request contains a password, create
     * the staff account immediately.
     * --------------------------------------------------
     */
    if (typeof password === "string") {
      if (!name) {
        return res.status(400).json({
          message: "Full name is required when creating a staff account.",
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          message: "Password must be at least 8 characters.",
        });
      }

      if (userToInvite) {
        return res.status(409).json({
          message: "An account with this email already exists.",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      createdUser = await User.create({
        Fullname: name,
        email: normalizedEmail,
        password: hashedPassword,
        role: "vendor",
        companyName: store.storeName,
        isVendorStaff: true,
        status: "ACTIVE",
        ...(phone ? { phone } : {}),
      });

      createdStaff = await Staff.create({
        vendorOwner: req.user.id,
        user: createdUser._id,
        email: normalizedEmail,
        role,
        permissions,
        status: "ACTIVE",
        store: store._id,
      });

      await createdStaff.populate("user", "Fullname email phone");

      return res.status(201).json({
        message: "Staff account created successfully.",
        staff: staffDto(createdStaff),
      });
    }

    /*
     * --------------------------------------------------
     * MODE 2: Invitation
     *
     * This preserves the Ikiguzi invitation system.
     * No account is created until the invite is accepted.
     * --------------------------------------------------
     */

    const { token, tokenHash, expiresAt } =
      vendorStaffInvitation.createInvitationToken();

    createdStaff = await Staff.create({
      vendorOwner: req.user.id,

      ...(userToInvite
        ? {
            user: userToInvite._id,
          }
        : {}),

      email: normalizedEmail,
      role,
      permissions,

      status: "INVITED",

      invitationTokenHash: tokenHash,
      invitationExpiresAt: expiresAt,

      store: store._id,
    });

    try {
      const frontendUrl = (
        process.env.FRONTEND_URL || "http://localhost:3000"
      ).replace(/\/+$/, "");

      const inviteQuery =
        `staffInviteToken=${encodeURIComponent(token)}` +
        `&email=${encodeURIComponent(normalizedEmail)}`;

      const signupUrl = `${frontendUrl}/signup?${inviteQuery}`;

      const loginUrl = `${frontendUrl}/login?${inviteQuery}`;

      const inviterName = req.user.Fullname || "Your vendor account owner";

      const roleLabel = String(role).toLowerCase().replaceAll("_", " ");

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
          <p>
            Hello${
              userToInvite?.Fullname
                ? ` ${escapeHtml(userToInvite.Fullname)}`
                : ""
            },
          </p>

          <p>
            <strong>
              ${escapeHtml(inviterName)}
            </strong>
            invited you to join their vendor team as
            <strong>
              ${escapeHtml(roleLabel)}
            </strong>.
          </p>

          <p>
            This invitation expires
            ${escapeHtml(expiresAt.toLocaleString())}.
          </p>

          <p>
            <a href="${escapeHtml(signupUrl)}">
              Create an account and join the team
            </a>
          </p>

          <p>
            Already have an account?
            <a href="${escapeHtml(loginUrl)}">
              Sign in to accept the invitation
            </a>
          </p>

          <p>
            If you were not expecting this invitation,
            you can ignore this email.
          </p>
        `,
      });
    } catch (emailError) {
      try {
        await createdStaff.deleteOne();
      } catch (cleanupError) {
        console.error(
          "Failed to remove vendor team member after invite email failure:",
          cleanupError,
        );
      }

      console.error("Vendor team invitation email failed:", emailError);

      return res.status(500).json({
        message: "Could not send the invitation email. Please try again later.",
      });
    }

    return res.status(201).json({
      message: "Invitation email sent successfully.",

      staff: {
        _id: createdStaff._id,
        email: createdStaff.email,
        role: createdStaff.role,
        permissions: createdStaff.permissions,
        status: createdStaff.status,
        store: createdStaff.store,
        createdAt: createdStaff.createdAt,
      },
    });
  } catch (error) {
    if (createdStaff) {
      await Staff.deleteOne({
        _id: createdStaff._id,
      }).catch(() => {});
    }

    if (createdUser) {
      await User.deleteOne({
        _id: createdUser._id,
      }).catch(() => {});
    }

    if (error.code === 11000) {
      return res.status(409).json({
        message: "An account or staff record with this email already exists.",
      });
    }

    return res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get all staff members for logged-in vendor
// @route   GET /api/staff
// @access  Private (Vendor Owner Only)
exports.getStoreStaff = async (req, res) => {
  try {
    const store = await storeForOwner(req.user.id);

    if (!store) {
      return res.status(404).json({
        message: "Store not found.",
      });
    }

    const [staffList, owner] = await Promise.all([
      Staff.find({
        vendorOwner: req.user.id,
      })
        .populate("user", "Fullname email phone")
        .sort({ createdAt: 1 }),

      User.findById(req.user.id).select("Fullname email phone createdAt"),
    ]);

    const ownerRow = {
      _id: owner._id,
      id: owner._id,
      name: owner.Fullname,
      email: owner.email || "",
      phone: owner.phone || null,
      role: "OWNER",
      permission_role: "OWNER",
      status: "ACTIVE",
      active: true,
      store_id: store._id,
      vendor_id: req.user.id,
      user_id: owner._id,
      permissions: Object.keys(PERMISSIONS),
      createdAt: owner.createdAt,
    };

    return res.status(200).json({
      staff: [ownerRow, ...staffList.map(staffDto)],
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Update a staff member
// @route   PUT /api/staff/:id
// @access  Private (Vendor Owner Only)
exports.updateStaffMember = async (req, res) => {
  try {
    const isObjectId = mongoose.Types.ObjectId.isValid(req.params.id);

    if (!isObjectId) {
      return res.status(404).json({
        message: "Invalid staff ID.",
      });
    }

    const staff = await Staff.findOne({
      $or: [
        {
          _id: req.params.id,
        },
        {
          user: req.params.id,
        },
      ],
      vendorOwner: req.user.id,
    }).populate("user", "Fullname email phone");

    if (!staff) {
      return res.status(404).json({
        message: "Staff record not found.",
      });
    }

    if (req.body.role !== undefined || req.body.permission_role !== undefined) {
      const role = normalizeRole(req.body.role || req.body.permission_role);

      if (!STAFF_ROLES.has(role)) {
        return res.status(400).json({
          message: "Choose a valid staff role.",
        });
      }

      staff.role = role;
    }

    if (req.body.permissions !== undefined) {
      staff.permissions = permissionsFor(staff.role, req.body.permissions);
    }

    if (req.body.status !== undefined || req.body.active !== undefined) {
      const active =
        req.body.active === undefined
          ? req.body.status === "ACTIVE"
          : req.body.active === true;

      /*
       * An invitation must be accepted before
       * the staff account becomes active.
       */
      if (staff.status === "INVITED" && active) {
        return res.status(400).json({
          message:
            "The invitee must accept the email invitation before access is activated.",
        });
      }

      staff.status = active ? "ACTIVE" : "SUSPENDED";

      if (staff.user?._id) {
        await User.updateOne(
          {
            _id: staff.user._id,
            isVendorStaff: true,
          },
          {
            $set: {
              status: active ? "ACTIVE" : "SUSPEND",
            },
          },
        );
      }
    }

    await staff.save();

    return res.status(200).json({
      message: "Staff member updated.",
      staff: staffDto(staff),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Remove staff member
// @route   DELETE /api/staff/:id
// @access  Private (Vendor Owner Only)
exports.removeStaffMember = async (req, res) => {
  try {
    const isObjectId = mongoose.Types.ObjectId.isValid(req.params.id);

    if (!isObjectId) {
      return res.status(404).json({
        message: "Invalid staff ID.",
      });
    }

    const staff = await Staff.findOne({
      $or: [
        {
          _id: req.params.id,
        },
        {
          user: req.params.id,
        },
      ],
      vendorOwner: req.user.id,
    });

    if (!staff) {
      return res.status(404).json({
        message: "Staff record not found.",
      });
    }

    await Staff.deleteOne({
      _id: staff._id,
    });

    if (staff.user) {
      await User.updateOne(
        {
          _id: staff.user,
          isVendorStaff: true,
        },
        {
          $set: {
            status: "SUSPEND",
          },
        },
      );
    }

    return res.status(200).json({
      message: "Staff access removed successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
