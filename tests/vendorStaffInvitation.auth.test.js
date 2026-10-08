const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../src/models/User");
const authController = require("../src/controllers/auth.controller");
const invitationService = require("../src/services/vendorStaffInvitation.service");

describe("Vendor staff invite registration", () => {
  it("registers the invitee as a buyer account and returns vendor staff access", async () => {
    const originalFindOne = User.findOne;
    const originalSave = User.prototype.save;
    const originalFindPending = invitationService.findPendingInvitation;
    const originalAccept = invitationService.acceptInvitation;
    const originalGetMembership = invitationService.getActiveMembership;
    const originalJwtSecret = process.env.JWT_SECRET;
    const vendorOwner = new mongoose.Types.ObjectId();

    User.findOne = async () => null;
    User.prototype.save = async function () {
      return this;
    };
    invitationService.findPendingInvitation = async (token, email) => {
      assert.equal(token, "one-time-token");
      assert.equal(email, "new.member@example.rw");
      return { _id: new mongoose.Types.ObjectId() };
    };
    invitationService.acceptInvitation = async (token, user) => {
      assert.equal(token, "one-time-token");
      assert.equal(user.email, "new.member@example.rw");
      assert.equal(user.role, "buyer");
      return { status: "ACTIVE" };
    };
    invitationService.getActiveMembership = async () => ({
      vendorOwner,
      role: "ORDER_MANAGER",
      permissions: { canManageOrders: true },
    });
    process.env.JWT_SECRET = "vendor_invitation_test_secret";

    try {
      const req = {
        body: {
          Fullname: "New Team Member",
          email: "New.Member@Example.RW",
          phone: "0788123456",
          password: "StrongPass123!",
          gender: "female",
          role: "super_admin",
          staffInviteToken: "one-time-token",
        },
      };
      const res = {
        statusCode: 200,
        jsonData: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.jsonData = data;
          return this;
        },
      };

      await authController.registerUser(req, res);

      assert.equal(res.statusCode, 201);
      assert.equal(res.jsonData.user.role, "buyer");
      assert.equal(res.jsonData.user.vendorStaff, true);
      assert.equal(res.jsonData.user.vendorOwnerId, vendorOwner.toString());
    } finally {
      User.findOne = originalFindOne;
      User.prototype.save = originalSave;
      invitationService.findPendingInvitation = originalFindPending;
      invitationService.acceptInvitation = originalAccept;
      invitationService.getActiveMembership = originalGetMembership;
      if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalJwtSecret;
    }
  });
});
