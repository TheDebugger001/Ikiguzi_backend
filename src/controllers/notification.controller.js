const mongoose = require("mongoose");
const Notification = require("../models/Notification");

const allowedTypes = [
  "ORDER",
  "DELIVERY",
  "PAYMENT",
  "PAYOUT",
  "STOCK",
  "REVIEW",
  "MESSAGE",
  "SUBSCRIPTION",
  "ADMIN",
  "SYSTEM",
  "COMMISSION",
  "CAMPAIGN",
  "VERIFICATION",
  "AFFILIATE",
  "SUPPLIER_ORDER",
  "SUPPLY_REQUEST",
];

function mapNotification(n) {
  return {
    id: n._id,
    recipient: n.recipient,
    type: n.type,
    title: n.title,
    message: n.message,
    reference: n.reference,
    channel: n.channel,
    status: n.isRead ? "Read" : "Unread",
    isRead: n.isRead,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

// @desc    Create a notification for a recipient
// @route   POST /api/notifications
// @access  Private (any authenticated role)
exports.createNotification = async (req, res) => {
  try {
    const { recipient, type, title, message, reference, channel, isRead } = req.body;

    if (!recipient) {
      return res.status(400).json({ message: "Recipient is required" });
    }
    if (!title || !title.trim()) {
      return res.status(400).json({ message: "Notification title is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(recipient)) {
      return res.status(400).json({ message: "Invalid recipient id" });
    }

    const noteType = type || "SYSTEM";
    if (!allowedTypes.includes(noteType)) {
      return res.status(400).json({ message: "Invalid notification type" });
    }

    const notification = await Notification.create({
      recipient,
      type: noteType,
      title: title.trim(),
      message: message || "",
      reference: reference || "",
      channel: channel || "IN_APP",
      isRead: isRead || false,
    });

    return res.status(201).json({
      message: "Notification created",
      notification: mapNotification(notification.toObject()),
    });
  } catch (error) {
    console.error("Error creating notification:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    List current user's notifications
// @route   GET /api/notifications/mine?status=&limit=
// @access  Private (authenticated)
exports.listMyNotifications = async (req, res) => {
  try {
    const query = { recipient: req.user._id };
    if (req.query.status === "unread") query.isRead = false;
    if (req.query.status === "read") query.isRead = true;

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false,
    });
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.status(200).json({
      data: notifications.map((n) => mapNotification(n.toObject())),
      meta: { total: notifications.length, unreadCount },
    });
  } catch (error) {
    console.error("Error listing notifications:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Mark a single notification as read
// @route   PATCH /api/notifications/:id/read
// @access  Private (owner)
exports.markRead = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    if (String(notification.recipient) !== String(req.user._id)) {
      return res.status(403).json({ message: "Not authorized to update this notification" });
    }

    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    return res.status(200).json({
      message: "Notification marked as read",
      notification: mapNotification(notification.toObject()),
    });
  } catch (error) {
    console.error("Error marking notification read:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Mark all of the user's notifications as read
// @route   POST /api/notifications/read-all
// @access  Private (authenticated)
exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { isRead: true, readAt: new Date() }
    );
    return res.status(200).json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all notifications read:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Admin list all notifications (optional filters)
// @route   GET /api/notifications?recipient=&type=&status=
// @access  Private (super_admin)
exports.adminListNotifications = async (req, res) => {
  try {
    const { recipient, type, status } = req.query;
    const query = {};
    if (recipient) query.recipient = recipient;
    if (type) query.type = type;
    if (status === "unread") query.isRead = false;
    if (status === "read") query.isRead = true;

    const notifications = await Notification.find(query).sort({ createdAt: -1 });
    return res.status(200).json({
      data: notifications.map((n) => mapNotification(n.toObject())),
      meta: { total: notifications.length },
    });
  } catch (error) {
    console.error("Error listing notifications:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
