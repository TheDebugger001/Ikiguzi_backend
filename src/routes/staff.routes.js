const express = require("express");
const router = express.Router();
const {
  addStaffMember,
  getStoreStaff,
  updateStaffMember,
  removeStaffMember,
} = require("../controllers/staff.controller");

const { protect, authorize } = require("../middleware/auth.middleware");
const { checkStaffPermission } = require("../middleware/staff.middleware");

router.use(protect);
router.use(authorize("vendor"));
// Managing the team is itself a permission: the owner always passes, a staff
// member only when they were granted `canManageStaff`.
router.use(checkStaffPermission("canManageStaff"));

router.route("/")
  .post(addStaffMember)
  .get(getStoreStaff);

router.route("/:id")
  .put(updateStaffMember)
  .delete(removeStaffMember);

module.exports = router;