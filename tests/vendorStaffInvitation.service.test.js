const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Staff = require("../src/models/Staff");
const invitationService = require("../src/services/vendorStaffInvitation.service");

describe("Vendor staff invitations", () => {
  it("accepts a pending invitation only for the invited account email", async () => {
    const { token, tokenHash, expiresAt } =
      invitationService.createInvitationToken();
    assert.equal(token.length, 64);
    assert.equal(tokenHash.length, 64);
    assert.ok(expiresAt > new Date());

    const invitationId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const originalFindOne = Staff.findOne;
    const originalFindOneAndUpdate = Staff.findOneAndUpdate;
    const calls = [];

    Staff.findOne = async (query) => {
      calls.push(query);
      if (query.user) return null;
      assert.equal(query.invitationTokenHash, tokenHash);
      assert.equal(query.email, "member@example.rw");
      assert.equal(query.status, "INVITED");
      return { _id: invitationId };
    };
    Staff.findOneAndUpdate = async (query, update, options) => {
      assert.equal(query._id, invitationId);
      assert.equal(query.invitationTokenHash, tokenHash);
      assert.equal(update.$set.user, userId);
      assert.equal(update.$set.status, "ACTIVE");
      assert.equal(options.new, true);
      return { _id: invitationId, user: userId, status: "ACTIVE" };
    };

    try {
      const accepted = await invitationService.acceptInvitation(token, {
        _id: userId,
        email: "Member@Example.RW",
      });

      assert.equal(accepted.user, userId);
      assert.equal(accepted.status, "ACTIVE");
      assert.equal(calls.length, 2);
    } finally {
      Staff.findOne = originalFindOne;
      Staff.findOneAndUpdate = originalFindOneAndUpdate;
    }
  });

  it("rejects invalid invitation tokens without linking an account", async () => {
    const originalFindOne = Staff.findOne;
    const originalFindOneAndUpdate = Staff.findOneAndUpdate;
    let updated = false;
    Staff.findOne = async () => null;
    Staff.findOneAndUpdate = async () => {
      updated = true;
      return null;
    };

    try {
      const result = await invitationService.acceptInvitation("bad-token", {
        _id: new mongoose.Types.ObjectId(),
        email: "member@example.rw",
      });
      assert.equal(result, null);
      assert.equal(updated, false);
    } finally {
      Staff.findOne = originalFindOne;
      Staff.findOneAndUpdate = originalFindOneAndUpdate;
    }
  });
});
