const affiliateService = require("../services/affiliate.service");

// "…not found" errors deserve a real 404; everything else is a validation error.
const statusFor = (error) => (/not found/i.test(error?.message || "") ? 404 : 400);
const fail = (res, error) =>
  res.status(statusFor(error)).json({ success: false, message: error.message });

exports.generateLink = async (req, res) => {
  try {
    const { productId, campaignId, label } = req.body;
    const userId = req.user.id;

    const link = await affiliateService.generateAffiliateLink(
      userId,
      productId || null,
      campaignId || null,
      label || ""
    );

    return res.status(201).json({
      success: true,
      message: "Affiliate referral link created.",
      // `link` is what the app reads; `data` kept for older clients.
      link,
      data: link,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.trackClick = async (req, res) => {
  try {
    const code = req.params.code || req.body.code;
    const visitorIp = req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress;
    const buyerUserId = req.user ? req.user.id || String(req.user._id) : null;

    const result = await affiliateService.trackClick(code, visitorIp, buyerUserId);
    if (result.FraudGuardFlagged) {
      return res.status(202).json({ success: false, fraudGuard: true, reason: result.reason });
    }

    return res.status(200).json({
      success: true,
      data: result,
      affiliateCode: result.affiliateCode,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.requestPayout = async (req, res) => {
  try {
    const { amount, paymentMethod, accountDetails } = req.body;
    const userId = req.user.id;

    const payout = await affiliateService.requestPayout({
      userId,
      amount,
      paymentMethod,
      accountDetails,
    });

    return res.status(201).json({
      success: true,
      message: "Payout request submitted successfully.",
      // `payout` is what the app reads; `data` kept for older clients.
      payout,
      data: payout,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.adminProcessPayout = async (req, res) => {
  try {
    const { payoutId } = req.params;
    const { status, transactionReference, rejectionReason } = req.body;
    const adminId = req.user.id;

    const updatedPayout = await affiliateService.processAdminPayout({
      payoutId,
      adminId,
      status,
      transactionReference,
      rejectionReason,
    });

    return res.status(200).json({
      success: true,
      message: `Payout request updated to ${status}.`,
      data: updatedPayout,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.getMyDashboard = async (req, res) => {
  try {
    const data = await affiliateService.getDashboard(req.user.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.adminListAffiliates = async (req, res) => {
  try {
    const data = await affiliateService.listAffiliates();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.listMyPayouts = async (req, res) => {
  try {
    const data = await affiliateService.listPayouts({ user: req.user.id });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.adminListPayouts = async (req, res) => {
  try {
    const data = await affiliateService.listPayouts({ isAdmin: true });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.getMyConversions = async (req, res) => {
  try {
    const data = await affiliateService.getConversionAudit(req.user.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Dashboard API consumed by the affiliate app ────────────────────────────

exports.getProfile = async (req, res) => {
  try {
    const profile = await affiliateService.getProfile(req.user.id);
    return res.status(200).json({ success: true, profile });
  } catch (error) {
    return fail(res, error);
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const profile = await affiliateService.updateProfile(req.user.id, req.body || {});
    return res.status(200).json({ success: true, profile });
  } catch (error) {
    return fail(res, error);
  }
};

exports.getVerification = async (req, res) => {
  try {
    const verification = await affiliateService.getVerification(req.user.id);
    return res.status(200).json({ success: true, verification });
  } catch (error) {
    return fail(res, error);
  }
};

exports.getOverview = async (req, res) => {
  try {
    const overview = await affiliateService.getOverview(req.user.id);
    // Read from the top level of the body, so spread it alongside `success`.
    return res.status(200).json({ success: true, ...overview });
  } catch (error) {
    return fail(res, error);
  }
};

exports.listLinks = async (req, res) => {
  try {
    const data = await affiliateService.listLinks(req.user.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
};

exports.updateLink = async (req, res) => {
  try {
    const link = await affiliateService.updateLink(req.user.id, req.params.linkId, req.body || {});
    return res.status(200).json({ success: true, link, data: link });
  } catch (error) {
    return fail(res, error);
  }
};

exports.deleteLink = async (req, res) => {
  try {
    const data = await affiliateService.removeLink(req.user.id, req.params.linkId);
    return res.status(200).json({ success: true, message: "Affiliate link deleted.", data });
  } catch (error) {
    return fail(res, error);
  }
};

exports.getStats = async (req, res) => {
  try {
    const stats = await affiliateService.getStats(req.user.id, req.query.range);
    return res.status(200).json({ success: true, ...stats });
  } catch (error) {
    return fail(res, error);
  }
};

exports.getWallet = async (req, res) => {
  try {
    const wallet = await affiliateService.getWalletSummary(req.user.id);
    return res.status(200).json({ success: true, wallet });
  } catch (error) {
    return fail(res, error);
  }
};

exports.listCommissions = async (req, res) => {
  try {
    const data = await affiliateService.listCommissions(req.user.id, {
      limit: req.query.limit,
      status: req.query.status,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
};

exports.listCampaigns = async (req, res) => {
  try {
    const data = await affiliateService.listCampaigns(req.user.id, { status: req.query.status });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
};

exports.joinCampaign = async (req, res) => {
  try {
    const campaign = await affiliateService.joinCampaign(req.user.id, req.params.campaignId);
    return res.status(200).json({ success: true, campaign, data: campaign });
  } catch (error) {
    return fail(res, error);
  }
};

exports.listNotifications = async (req, res) => {
  try {
    const data = await affiliateService.listNotifications(req.user.id, { limit: req.query.limit });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
};

exports.markNotificationsRead = async (req, res) => {
  try {
    const data = await affiliateService.markNotificationsRead(req.user.id, req.params.id || null);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return fail(res, error);
  }
};

exports.getSettings = async (req, res) => {
  try {
    const settings = await affiliateService.getSettings(req.user.id);
    return res.status(200).json({ success: true, settings });
  } catch (error) {
    return fail(res, error);
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = await affiliateService.updateSettings(req.user.id, req.body || {});
    return res.status(200).json({ success: true, settings });
  } catch (error) {
    return fail(res, error);
  }
};