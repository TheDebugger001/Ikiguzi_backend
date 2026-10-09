const express = require("express");
const router = express.Router();
const notification = require("../controllers/notification.controller");
const { protect, authorize } = require("../middleware/auth.middleware");

// Public create (for authenticated roles pushing system events) and self-management.
router.use(protect);

router.post("/", authorize("super_admin"), notification.createNotification);
router.get("/mine", notification.listMyNotifications);
router.get("/read-all", notification.markAllRead);
router.post("/read-all", notification.markAllRead);
router.patch("/:id/read", notification.markRead);

// Admin oversight.
router.get("/", authorize("super_admin"), notification.adminListNotifications);

module.exports = router;
