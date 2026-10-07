const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const express = require("express");
const User = require("../models/User");
const Otp = require("../models/Otp");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { normalizePhone, phoneVariants, generateOtpCode, sendOtpSms } = require("../utils/sms.util");
const vendorStaffInvitation = require("../services/vendorStaffInvitation.service");

// ─── HELPER: GOOGLE OAUTH CLIENT ─────────────────────────────────────────────
const getGoogleClient = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "GOOGLE_CLIENT_ID is not configured. Add it to your .env file."
    );
  }
  return new OAuth2Client(clientId);
};

// ─── HELPER: SIGN JWT & BUILD SANITIZED USER RESPONSE ───────────────────────
const signToken = (userId) =>
  jwt.sign({ userId: userId.toString() }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });

const buildUserResponse = (u) => ({
  _id: u._id,
  Fullname: u.Fullname,
  email: u.email || null,
  role: u.role,
  phone: u.phone || null,
  gender: u.gender || null,
  companyName: u.companyName || null,
});

const buildAuthenticatedUserResponse = async (user) => {
  const response = buildUserResponse(user);
  const membership = await vendorStaffInvitation.getActiveMembership(user._id);
  if (!membership) return response;
  return {
    ...response,
    vendorStaff: true,
    vendorOwnerId: membership.vendorOwner.toString(),
    staffRole: membership.role,
    vendorPermissions: membership.permissions,
  };
};

exports.getAuthenticatedUserResponse = buildAuthenticatedUserResponse;

// ─── REGISTER USER ───────────────────────────────────────────────────────────
// Supports two flows:
//   1. Legacy sign-up: Fullname, email, password, gender, phone, role.
//   2. Phone-first sign-up (OTP): full profile + a `verificationToken` issued
//      by POST /api/auth/verify-otp (purpose "registration"). email optional.
exports.registerUser = async (req, res) => {
  try {
    const {
      Fullname,
      email,
      password,
      gender,
      phone,
      role,
      companyName,
      verificationToken,
      staffInviteToken,
    } = req.body;
    const accountRole = staffInviteToken ? "buyer" : role;

    if (!Fullname || !password || !gender || !accountRole) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!phone && !verificationToken) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    if (accountRole === "vendor" && !companyName) {
      return res.status(400).json({ message: "Company name is required" });
    }

    // Validate that the phone was actually verified via OTP when supplied.
    let verifiedPhone = null;
    if (verificationToken) {
      let decoded;
      try {
        decoded = jwt.verify(verificationToken, process.env.JWT_SECRET);
      } catch {
        return res.status(400).json({
          message: "Invalid or expired phone verification. Please re-verify.",
        });
      }
      if (
        decoded.purpose !== "registration" ||
        !normalizePhone(decoded.phone)
      ) {
        return res.status(400).json({
          message: "Invalid phone verification token",
        });
      }
      verifiedPhone = normalizePhone(decoded.phone);

      // If a phone was also sent in the body, it must match the verified phone.
      if (phone) {
        const bodyPhone = normalizePhone(phone);
        if (bodyPhone !== verifiedPhone) {
          return res.status(400).json({
            message: "Phone number does not match the verified phone number.",
          });
        }
      }
    } else {
      verifiedPhone = normalizePhone(phone);
    }

    if (!verifiedPhone) {
      return res.status(400).json({
        message:
          "A valid Rwandan phone number is required (e.g. 0788123456 or +250781234567)",
      });
    }

    const normalizedEmail = email ? email.trim().toLowerCase() : undefined;
    if (staffInviteToken) {
      if (!normalizedEmail) {
        return res.status(400).json({
          message: "Use the email address that received the invitation.",
        });
      }
      const invitation = await vendorStaffInvitation.findPendingInvitation(
        staffInviteToken,
        normalizedEmail,
      );
      if (!invitation) {
        return res.status(400).json({
          message: "This vendor team invitation is invalid or has expired.",
        });
      }
    }

    // Check if the user already exists by email or phone
    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { phone: { $in: phoneVariants(verifiedPhone) } }],
    });

    if (existingUser) {
      const isEmailMatch =
        normalizedEmail && existingUser.email === normalizedEmail;
      return res.status(400).json({
        message: isEmailMatch
          ? "User with this email already exists"
          : "User with this phone number already exists",
      });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new user
    const newUser = new User({
      Fullname: Fullname.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      gender,
      phone: verifiedPhone,
      role: accountRole,
      companyName: accountRole === "vendor" ? companyName.trim() : undefined,
    });

    // Save the user to the database
    await newUser.save();

    if (staffInviteToken) {
      const membership = await vendorStaffInvitation.acceptInvitation(
        staffInviteToken,
        newUser,
      );
      if (!membership) {
        await newUser.deleteOne();
        return res.status(400).json({
          message: "This vendor team invitation has already been used or expired.",
        });
      }
    }

    // Generate JWT token so frontend can immediately log in after registration
    const token = signToken(newUser._id);

    return res.status(201).json({
      message: "User registered successfully",
      user: await buildAuthenticatedUserResponse(newUser),
      token,
    });
  } catch (error) {
    console.error("Error registering user:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── LOGIN USER ──────────────────────────────────────────────────────────────
exports.loginUser = async (req, res) => {
  try {
    const { email, phone, password, staffInviteToken } = req.body;

    if ((!email && !phone) || !password) {
      return res
        .status(400)
        .json({ message: "Email or phone and password are required" });
    }

    const normalizedEmail = email ? email.trim().toLowerCase() : null;
    const phoneVariantsList = phone ? phoneVariants(phone) : [];

    const user = await User.findOne(
      normalizedEmail && phoneVariantsList.length
        ? { $or: [{ email: normalizedEmail }, { phone: { $in: phoneVariantsList } }] }
        : normalizedEmail
        ? { email: normalizedEmail }
        : { phone: { $in: phoneVariantsList } }
    );

    if (!user) {
      return res.status(400).json({ message: "Invalid email/phone or password" });
    }

    // Check if user is a Google-only account without password
    if (!user.password && user.googleId) {
      return res.status(400).json({
        message:
          "This account was created using Google Sign-In. Please log in with Google.",
      });
    }

    // Compare the provided password with the hashed password in the database
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Invalid email/phone or password" });
    }

    if (staffInviteToken) {
      const membership = await vendorStaffInvitation.acceptInvitation(
        staffInviteToken,
        user,
      );
      if (!membership) {
        return res.status(400).json({
          message: "This vendor team invitation is invalid, expired, or already used.",
        });
      }
    }

    // Generate a JWT token for the authenticated user
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    // Return response excluding sensitive password hash
    const userResponse = await buildAuthenticatedUserResponse(user);

    return res.status(200).json({
      message: "Login successful",
      user: userResponse,
      token,
    });
  } catch (error) {
    console.error("Error logging in user:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── GOOGLE SIGN-IN ──────────────────────────────────────────────────────────
// Verifies a Google ID token (produced on the frontend by the GSI library or
// Google Identity Services), then creates a new account, links an existing
// email/password account, or signs the user straight in — returning a JWT.
exports.googleLogin = async (req, res) => {
  try {
    const idToken = req.body.idToken || req.body.token;
    const requestedRole = req.body.role;

    if (!idToken || typeof idToken !== "string") {
      return res.status(400).json({ message: "Google ID token is required" });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({
        message:
          "Google Sign-In is not configured. Please set GOOGLE_CLIENT_ID in the backend environment.",
      });
    }

    // Verify the ID token's signature, audience and expiry with Google
    const client = getGoogleClient();
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, sub: googleId, email_verified } = payload;

    // Google guarantees verified addresses from the hosted domain UI, but we
    // still fail closed when the profile is missing an email.
    if (!email) {
      return res.status(400).json({
        message: "Your Google account has no email address we can use.",
      });
    }

    const normalizedEmail = email.toLowerCase();

    // Case 1: existing user with the same Google ID → sign straight in.
    let user = await User.findOne({ googleId });

    // Case 2: existing account with this email (password-based) → link Google ID.
    if (!user) {
      const byEmail = await User.findOne({ email: normalizedEmail });
      if (byEmail) {
        byEmail.googleId = googleId;
        await byEmail.save();
        user = byEmail;
      }
    }

    // Case 3: brand new Google user → create the account. Credentials that are
    // required on the normal sign-up form (password, gender, phone) are not
    // needed for a Google-authenticated profile.
    if (!user) {
      const allowedRoles = ["buyer", "vendor", "supplier", "affiliate"];
      const role = allowedRoles.includes(requestedRole) ? requestedRole : "buyer";

      user = new User({
        Fullname: name || "Google User",
        email: normalizedEmail,
        googleId,
        role,
        email_verified: Boolean(email_verified),
      });
      await user.save();
    }

    const token = signToken(user._id);

    return res.status(200).json({
      message: "Google sign-in successful",
      user: await buildAuthenticatedUserResponse(user),
      token,
    });
  } catch (error) {
    if (error.message && error.message.includes("GOOGLE_CLIENT_ID")) {
      return res.status(500).json({ message: error.message });
    }
    // Google library failures on bad/expired/mismatched tokens and audience.
    if (
      error.message &&
      /invalid token|wrong number of segments|audience|no pem|key id|token used too late|could not retrieve/i.test(
        error.message,
      )
    ) {
      return res.status(401).json({ message: "Invalid Google ID token" });
    }
    console.error("Error logging in with Google:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── HELPER: NODEMAILER TRANSPORTER ──────────────────────────────────────────
const getTransporter = () => {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    throw new Error(
      "Email credentials are not configured. Please set EMAIL_USER and EMAIL_PASS environment variables."
    );
  }

  // If EMAIL_HOST is provided, use custom SMTP options; otherwise fallback to Gmail service
  if (process.env.EMAIL_HOST) {
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === "true" || process.env.EMAIL_PORT === "465",
      auth: { user, pass },
    });
  }

  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || "Gmail",
    auth: { user, pass },
  });
};

const sendResetEmail = async (toEmail, resetUrl) => {
  const transporter = getTransporter();
  const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  await transporter.sendMail({
    from: `"MVEC Support" <${fromAddress}>`,
    to: toEmail,
    subject: "Password Reset Request",
    text: `You requested a password reset for your MVEC account.\n\nPlease click the following link to reset your password (valid for 15 minutes):\n${resetUrl}\n\nIf you did not request this, please ignore this email.`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          .container { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; }
          .header { text-align: center; border-bottom: 1px solid #eee; padding-bottom: 15px; margin-bottom: 20px; }
          .btn { background-color: #4CAF50; color: #ffffff !important; padding: 12px 24px; text-decoration: none; display: inline-block; border-radius: 5px; font-weight: bold; margin: 15px 0; }
          .footer { font-size: 12px; color: #888; margin-top: 25px; border-top: 1px solid #eee; padding-top: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Password Reset Request</h2>
          </div>
          <p>Hello,</p>
          <p>You requested a password reset for your MVEC account. Click the button below to set a new password:</p>
          <p style="text-align: center;">
            <a href="${resetUrl}" class="btn" style="color: #ffffff;">Reset Password</a>
          </p>
          <p>Or copy and paste this link into your browser:</p>
          <p><a href="${resetUrl}">${resetUrl}</a></p>
          <p><strong>Note:</strong> This link is valid for 15 minutes only. If you did not request this, please ignore this email.</p>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} MVEC. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  });
};

// Export assisting functions for unit tests
exports.getTransporter = getTransporter;
exports.sendResetEmail = sendResetEmail;

// ─── 1. FORGOT PASSWORD CONTROLLER ───────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ message: "Email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    // Consistent generic response message to prevent email enumeration
    const genericResponse = {
      message: "If an account exists with that email, a reset link has been sent.",
    };

    if (!user) {
      return res.status(200).json(genericResponse);
    }

    // Block Google OAuth users without local password from password reset
    if (!user.password && user.googleId) {
      return res.status(400).json({
        message: "This account was created using Google Sign-In. Please log in with Google.",
      });
    }

    // Generate unhashed random token for URL
    const resetToken = crypto.randomBytes(32).toString("hex");

    // Hash token before saving to database (SHA-256)
    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000); // 15-minute expiration

    await user.save({ validateBeforeSave: false });

    // Construct reset link for the React frontend safely
    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

    // Send email safely
    try {
      await sendResetEmail(user.email, resetUrl);
      return res.status(200).json(genericResponse);
    } catch (emailError) {
      console.error("Email Sending Error:", emailError.message);

      // Clear reset fields in DB so no invalid token remains if sending fails
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false });

      return res.status(500).json({
        message: "Could not send reset email. Please try again later.",
      });
    }
  } catch (error) {
    console.error("Forgot Password Error:", error);
    return res.status(500).json({ message: "Failed to process request" });
  }
};

// ─── 2. RESET PASSWORD CONTROLLER ────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const newPassword = req.body.newPassword || req.body.password;

    if (!token || typeof token !== "string" || !token.trim()) {
      return res.status(400).json({ message: "Reset token is required" });
    }

    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({
        message: "Password is required and must be at least 6 characters long",
      });
    }

    // Hash the token from URL parameter to match DB record
    const hashedToken = crypto
      .createHash("sha256")
      .update(token.trim())
      .digest("hex");

    // Search for user with matching token that hasn't expired yet
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ message: "Invalid or expired reset token" });
    }

    // Hash new password and clear token fields
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    return res.status(200).json({
      message: "Password reset successful! You can now log in with your new password.",
    });
  } catch (error) {
    console.error("Reset Password Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── 3. USER ADDRESSES ───────────────────────────────────────────────────────
// @desc    Add a new address for logged-in user
// @route   POST /api/auth/addresses
// @access  Private
exports.addAddress = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id || req.user.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const {
      type,
      country,
      provinceState,
      cityDistrict,
      street,
      building,
      apartment,
      postalCode,
      phone,
      deliveryInstructions,
      isDefaultShipping,
      isDefaultBilling,
    } = req.body;

    // Unset current default flags if this address is being set as default
    if (isDefaultShipping) {
      user.addresses.forEach((addr) => (addr.isDefaultShipping = false));
    }
    if (isDefaultBilling) {
      user.addresses.forEach((addr) => (addr.isDefaultBilling = false));
    }

    // First address added automatically becomes default
    const isFirstAddress = user.addresses.length === 0;

    user.addresses.push({
      type,
      country,
      provinceState,
      cityDistrict,
      street,
      building,
      apartment,
      postalCode,
      phone,
      deliveryInstructions,
      isDefaultShipping: isFirstAddress ? true : Boolean(isDefaultShipping),
      isDefaultBilling: isFirstAddress ? true : Boolean(isDefaultBilling),
    });

    await user.save();
    return res.status(201).json({
      message: "Address added successfully",
      addresses: user.addresses,
    });
  } catch (error) {
    console.error("Error adding address:", error);
    return res.status(400).json({ message: error.message });
  }
};

// @desc    Get all addresses for logged-in user
// @route   GET /api/auth/addresses
// @access  Private
exports.getAddresses = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id || req.user.userId;
    const user = await User.findById(userId).select("addresses");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ addresses: user.addresses });
  } catch (error) {
    console.error("Error fetching addresses:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// @desc    Update an existing address
// @route   PUT /api/auth/addresses/:addressId
// @access  Private
exports.updateAddress = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id || req.user.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const address = user.addresses.id(req.params.addressId);
    if (!address) {
      return res.status(404).json({ message: "Address not found" });
    }

    const { isDefaultShipping, isDefaultBilling, _id, ...updateFields } = req.body;

    // Handle default flag switches across other stored addresses
    if (isDefaultShipping) {
      user.addresses.forEach((addr) => (addr.isDefaultShipping = false));
    }
    if (isDefaultBilling) {
      user.addresses.forEach((addr) => (addr.isDefaultBilling = false));
    }

    Object.assign(address, updateFields);
    if (typeof isDefaultShipping !== "undefined") {
      address.isDefaultShipping = Boolean(isDefaultShipping);
    }
    if (typeof isDefaultBilling !== "undefined") {
      address.isDefaultBilling = Boolean(isDefaultBilling);
    }

    await user.save();
    return res.status(200).json({
      message: "Address updated successfully",
      addresses: user.addresses,
    });
  } catch (error) {
    console.error("Error updating address:", error);
    return res.status(400).json({ message: error.message });
  }
};

// @desc    Delete an address
// @route   DELETE /api/auth/addresses/:addressId
// @access  Private
exports.deleteAddress = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id || req.user.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const address = user.addresses.id(req.params.addressId);
    if (!address) {
      return res.status(404).json({ message: "Address not found" });
    }

    const wasDefaultShipping = address.isDefaultShipping;
    const wasDefaultBilling = address.isDefaultBilling;

    // Remove the address subdocument
    address.deleteOne();

    // Reassign defaults if a default address was deleted
    if (user.addresses.length > 0) {
      if (wasDefaultShipping && !user.addresses.some((a) => a.isDefaultShipping)) {
        user.addresses[0].isDefaultShipping = true;
      }
      if (wasDefaultBilling && !user.addresses.some((a) => a.isDefaultBilling)) {
        user.addresses[0].isDefaultBilling = true;
      }
    }

    await user.save();
    return res.status(200).json({
      message: "Address deleted successfully",
      addresses: user.addresses,
    });
  } catch (error) {
    console.error("Error deleting address:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── OTP: SEND VERIFICATION CODE ────────────────────────────────────────────
// @desc    Send a one-time verification code to a phone number via SMS
// @route   POST /api/auth/send-otp
// @access  Public
// @body    { phone: "0788123456", purpose: "registration" | "login", email? }
exports.sendOtp = async (req, res) => {
  try {
    const { phone, purpose, email } = req.body;

    const validPurposes = ["registration", "login"];
    if (!validPurposes.includes(purpose)) {
      return res.status(400).json({
        message: `purpose must be one of: ${validPurposes.join(", ")}`,
      });
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return res.status(400).json({
        message:
          "A valid Rwandan phone number is required (e.g. 0788123456 or +250781234567)",
      });
    }

    const otpTtlSeconds = Number(process.env.OTP_EXPIRY_SECONDS || 300);
    const cooldownSeconds = Number(process.env.OTP_COOLDOWN_SECONDS || 60);

    // 1. Rate-limit: block re-sends for the same phone+purpose within the cooldown.
    const recent = await Otp.findOne({
      phone: normalizedPhone,
      purpose,
      lastSentAt: { $gt: new Date(Date.now() - cooldownSeconds * 1000) },
    });
    if (recent) {
      return res.status(429).json({
        message: `Please wait ${cooldownSeconds}s before requesting a new code.`,
      });
    }

    // 2. Generate and hash the code.
    const code = generateOtpCode(6);
    const codeHash = crypto
      .createHash("sha256")
      .update(code)
      .digest("hex");

    // 3. Invalidate any previous unconsumed codes for this phone+purpose.
    await Otp.updateMany(
      { phone: normalizedPhone, purpose, consumed: false },
      { $set: { consumed: true } },
    );

    // 4. Persist a fresh record.
    await Otp.create({
      phone: normalizedPhone,
      codeHash,
      purpose,
      email: email ? email.trim().toLowerCase() : undefined,
      expiresAt: new Date(Date.now() + otpTtlSeconds * 1000),
      attempts: 0,
      lastSentAt: new Date(),
      consumed: false,
    });

    // 5. Deliver the code (logged to console in dev; SMS provider pluggable).
    await sendOtpSms(normalizedPhone, code, { purpose });

    return res.status(200).json({
      message: `Verification code sent to ${normalizedPhone}`,
      // In development the code is exposed so flows can be tested end-to-end.
      ...(process.env.NODE_ENV === "development" && { devCode: code }),
    });
  } catch (error) {
    console.error("Error sending OTP:", error);
    return res.status(500).json({ message: "Failed to send verification code" });
  }
};

// ─── OTP: VERIFY & CONSUME CODE ─────────────────────────────────────────────
// @desc    Validate the phone OTP code for passwordless login / registration
// @route   POST /api/auth/verify-otp
// @access  Public
// @body    { phone, code, purpose, role? }
//          - purpose "login"         → signs the user in (passwordless) with a JWT
//          - purpose "registration"  → confirms ownership of the phone; returns a
//                                      short-lived verificationToken that the
//                                      sign-up flow presents along with the rest
//                                      of the profile to /api/auth/register.
exports.verifyOtp = async (req, res) => {
  try {
    const { phone, code, purpose, role } = req.body;

    const validPurposes = ["registration", "login"];
    if (!validPurposes.includes(purpose)) {
      return res.status(400).json({
        message: `purpose must be one of: ${validPurposes.join(", ")}`,
      });
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return res.status(400).json({
        message:
          "A valid Rwandan phone number is required (e.g. 0788123456 or +250781234567)",
      });
    }

    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
      return res
        .status(400)
        .json({ message: "A 6-digit verification code is required" });
    }

    const codeHash = crypto
      .createHash("sha256")
      .update(code.trim())
      .digest("hex");

    // Look up the latest unconsumed, unexpired code for this phone+purpose
    const otp = await Otp.findOne({
      phone: normalizedPhone,
      purpose,
      consumed: false,
      expiresAt: { $gt: Date.now() },
    }).sort({ createdAt: -1 });

    if (!otp) {
      return res
        .status(400)
        .json({ message: "Invalid or expired verification code" });
    }

    const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS || 5);

    // Wrong code → count the failed attempt (and lock the code when exceeded)
    if (otp.codeHash !== codeHash) {
      otp.attempts += 1;
      const exhausted = otp.attempts >= maxAttempts;
      if (exhausted) otp.consumed = true;
      await otp.save();
      if (exhausted) {
        return res.status(429).json({
          message: "Too many failed attempts. Please request a new code.",
        });
      }
      return res
        .status(400)
        .json({ message: "Invalid or expired verification code" });
    }

    // Code matches → mark consumed (single-use)
    otp.consumed = true;
    await otp.save();

    // ── PURPOSE: PASSWORDLESS LOGIN ─────────────────────────────────────────
    if (purpose === "login") {
      const user = await User.findOne({
        phone: { $in: phoneVariants(normalizedPhone) },
      });

      if (!user) {
        return res.status(404).json({
          message:
            "No account is linked to this phone number. Please register first.",
        });
      }

      const token = signToken(user._id);
      return res.status(200).json({
        message: "Phone verified — you are now signed in",
        user: await buildAuthenticatedUserResponse(user),
        token,
        verified: true,
      });
    }

    // ── PURPOSE: REGISTRATION ───────────────────────────────────────────────
    // The phone belongs to the caller. Issue a short-lived token the sign-up
    // request must present to prove the phone was verified.
    const allowedRoles = ["buyer", "vendor", "supplier", "affiliate"];
    const finalRole = allowedRoles.includes(role) ? role : "buyer";
    const verificationToken = jwt.sign(
      { phone: normalizedPhone, purpose, role: finalRole },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );

    return res.status(200).json({
      message: "Phone verified successfully. Complete your registration.",
      verificationToken,
      phone: normalizedPhone,
      verified: true,
    });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    return res.status(500).json({ message: "Failed to verify code" });
  }
};
