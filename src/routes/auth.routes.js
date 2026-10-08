const express = require("express");
const router = express.Router();
const auth = require("../controllers/auth.controller");

// Route for user registration
router.post("/register", auth.registerUser);
router.post("/login", auth.loginUser);
router.post("/google-login", auth.googleLogin);

// Phone OTP verification (phone-based registration & passwordless login)
router.post("/send-otp", auth.sendOtp);
router.post("/verify-otp", auth.verifyOtp);

router.post("/forgot-password", auth.forgotPassword);
router.post("/reset-password/:token", auth.resetPassword);

const { protect } = require("../middleware/auth.middleware");

router.use(protect);

router.get("/me", async (req, res) => {
  try {
    const user = await auth.getAuthenticatedUserResponse(req.user);
    return res.status(200).json({ user });
  } catch (error) {
    return res.status(500).json({ message: "Could not load the current account." });
  }
});

router.route("/addresses").get(auth.getAddresses).post(auth.addAddress);
router.route("/addresses/:addressId").put(auth.updateAddress).delete(auth.deleteAddress);

module.exports = router;