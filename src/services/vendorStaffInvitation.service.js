const crypto = require("crypto");
const Staff = require("../models/Staff");

const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

exports.createInvitationToken = () => {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
  };
};

exports.findPendingInvitation = async (token, email) =>
  Staff.findOne({
    invitationTokenHash: hashToken(token),
    invitationExpiresAt: { $gt: new Date() },
    email: normalizeEmail(email),
    status: "INVITED",
  });

exports.acceptInvitation = async (token, user) => {
  const invitation = await exports.findPendingInvitation(token, user.email);
  if (!invitation) return null;

  const existingMembership = await Staff.findOne({
    user: user._id,
    status: "ACTIVE",
  });
  if (existingMembership && existingMembership._id.toString() !== invitation._id.toString()) {
    return null;
  }

  return Staff.findOneAndUpdate(
    {
      _id: invitation._id,
      invitationTokenHash: hashToken(token),
      invitationExpiresAt: { $gt: new Date() },
      status: "INVITED",
    },
    {
      $set: { user: user._id, status: "ACTIVE" },
      $unset: { invitationTokenHash: 1, invitationExpiresAt: 1 },
    },
    { new: true, runValidators: true },
  );
};

exports.getActiveMembership = async (userId) =>
  Staff.findOne({ user: userId, status: "ACTIVE" })
    .select("vendorOwner role permissions")
    .lean();
