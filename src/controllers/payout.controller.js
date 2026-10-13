// src/controllers/payout.controller.js
const { Payout, VendorBalance } = require("../models/Payout");
const Order = require("../models/Order");
const { formatRwandanPhone } = require("../utils/momo.util");

const { TOTAL_PLATFORM_FEE_PERCENT } = require("../config/revenueSplit");

// Helper: Generate unique payout reference number
const generatePayoutNumber = () => `PAY-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

// @desc    Get Vendor Financial Balance Summary
// @route   GET /api/payouts/balance
// @access  Private (Vendor)
exports.getVendorBalance = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    let balance = await VendorBalance.findOne({ vendor: userId });
    if (!balance) {
      balance = await VendorBalance.create({ vendor: userId });
    }
    return res.status(200).json({ balance, commissionRate: `${TOTAL_PLATFORM_FEE_PERCENT}%` });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Automated Vendor Instant Payout / Withdrawal Request
// @route   POST /api/payouts/request
// @access  Private (Vendor)
exports.requestPayout = async (req, res) => {
  try {
    const { amount, payoutMethod, payoutDetails } = req.body;
    const userId = req.user.id || req.user._id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Valid withdrawal amount is required." });
    }

    if (!payoutDetails || !payoutDetails.accountName || !payoutDetails.accountNumber) {
      return res.status(400).json({ message: "Amount and complete payout details are required." });
    }

    // Format & validate Rwandan Phone Number for MOMO / AIRTEL
    const phoneInfo = formatRwandanPhone(payoutDetails.accountNumber);
    if (!phoneInfo) {
      return res.status(400).json({
        message: "Invalid Rwandan phone number. Must start with 078/079 (MTN) or 073 (Airtel).",
      });
    }

    const determinedMethod = payoutMethod || (phoneInfo.provider === "MTN" ? "MOMO" : "AIRTEL");
    payoutDetails.accountNumber = phoneInfo.formattedNumber;
    payoutDetails.bankName = phoneInfo.provider === "MTN" ? "MTN MoMo" : "Airtel Money";

    let balance = await VendorBalance.findOne({ vendor: userId });
    if (!balance || balance.availableBalance < amount) {
      return res.status(400).json({
        message: `Insufficient available balance. Available: ${balance ? balance.availableBalance : 0} RWF`,
      });
    }

    // 1. Deduct from available balance & credit lifetime withdrawn amount immediately
    balance.availableBalance -= amount;
    balance.withdrawnAmount = (balance.withdrawnAmount || 0) + amount;
    await balance.save();

    // 2. Automatically create and complete payout record
    const payout = await Payout.create({
      vendor: userId,
      payoutNumber: generatePayoutNumber(),
      amount,
      payoutMethod: determinedMethod,
      payoutDetails,
      status: "PAID", // Auto-approved and marked as PAID instantly
      processedAt: new Date(),
    });

    // Note: Gateway disbursement API (e.g. Paystack Transfer / MoMo API call) triggers here seamlessly

    return res.status(201).json({
      message: `Instant payout of ${amount} RWF disbursed to ${payoutDetails.bankName} (${phoneInfo.localNumber}).`,
      payout,
      updatedBalance: {
        availableBalance: balance.availableBalance,
        withdrawnAmount: balance.withdrawnAmount,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get all payout requests for logged-in vendor
// @route   GET /api/payouts/history
// @access  Private (Vendor)
exports.getPayoutHistory = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const payouts = await Payout.find({ vendor: userId }).sort({ createdAt: -1 });
    return res.status(200).json({ payouts });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Helper Service: Automatically credit pending balance when an order is PAID
exports.creditPendingEarnings = async (orderId, vendorId) => {
  const order = await Order.findById(orderId);
  if (!order) return;

  const vendorItems = order.items.filter(
    (item) => item.vendor && item.vendor.toString() === vendorId.toString()
  );

  const itemSubtotal = vendorItems.reduce((acc, item) => {
    const total = item.itemTotal ?? (item.price * item.quantity) ?? 0;
    return acc + total;
  }, 0);

  const platformFee = (itemSubtotal * TOTAL_PLATFORM_FEE_PERCENT) / 100;
  const netEarnings = itemSubtotal - platformFee;

  let balance = await VendorBalance.findOne({ vendor: vendorId });
  if (!balance) {
    balance = await VendorBalance.create({ vendor: vendorId });
  }

  balance.pendingBalance = (balance.pendingBalance || 0) + netEarnings;
  await balance.save();
};

// Helper Service: Transition pending funds to available balance upon DELIVERED status
exports.releaseOrderEarnings = async (orderId, vendorId) => {
  const order = await Order.findById(orderId);
  if (!order) return;
  // The seller collected this money directly (paid offline, or cash on delivery
  // for an order they recorded themselves); nothing passed through MVEC.
  if (order.paidOffline || (order.source === "MANUAL" && order.paymentMethod === "CASH_ON_DELIVERY")) return;

  const vendorItems = order.items.filter(
    (item) => item.vendor && item.vendor.toString() === vendorId.toString()
  );

  const itemSubtotal = vendorItems.reduce((acc, item) => {
    const total = item.itemTotal ?? (item.price * item.quantity) ?? 0;
    return acc + total;
  }, 0);

  const platformFee = (itemSubtotal * TOTAL_PLATFORM_FEE_PERCENT) / 100;
  // Delivery fees for this seller's parcels are paid out in full (no commission).
  const shippingFee = (order.shippingBreakdown || [])
    .filter((s) => s.vendor && s.vendor.toString() === vendorId.toString())
    .reduce((sum, s) => sum + (s.fee || 0), 0);
  const netEarnings = itemSubtotal - platformFee + shippingFee;

  let balance = await VendorBalance.findOne({ vendor: vendorId });
  if (!balance) {
    balance = await VendorBalance.create({ vendor: vendorId });
  }

  if (balance.pendingBalance >= netEarnings) {
    balance.pendingBalance -= netEarnings;
  } else {
    balance.pendingBalance = 0;
  }

  balance.totalEarned = (balance.totalEarned || 0) + netEarnings;
  balance.commissionPaid = (balance.commissionPaid || 0) + platformFee;
  balance.availableBalance = (balance.availableBalance || 0) + netEarnings;

  await balance.save();
};