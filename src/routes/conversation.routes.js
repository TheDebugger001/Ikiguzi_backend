const express = require("express");
const router = express.Router();
const {
  createConversation,
  getConversations,
  getMessages,
  sendMessage,
  markConversationRead,
  searchContacts,
} = require("../controllers/conversation.controller");
const { protect } = require("../middleware/auth.middleware");

router.use(protect); // Require JWT authentication

router.post("/", createConversation);
router.get("/", getConversations);
router.get("/contacts", searchContacts);
router.get("/:id/messages", getMessages);
router.post("/:id/messages", sendMessage);
router.patch("/:id/read", markConversationRead);

module.exports = router;