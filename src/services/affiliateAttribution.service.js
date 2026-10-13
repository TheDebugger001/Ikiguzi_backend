const crypto = require("crypto");
const mongoose = require("mongoose");
const AffiliateAttribution = require("../models/AffiliateAttribution");
const AffiliateLink = require("../models/AffiliateLink");
const AffiliateWallet = require("../models/AffiliateWallet");
const ConversionAudit = require("../models/ConversionAudit");
const LedgerAccount = require("../models/LedgerAccount");
const Order = require("../models/Order");
const Product = require("../models/Product");

// Referral window: a click is eligible while now < clickedAt + 30 days. The
// boundary instant itself is already expired, and clicks dated in the future
// (clock skew, tampering) are never eligible.
const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
// Products a visitor can still land on and buy.
const PROMOTABLE_STATUSES = ["ACTIVE", "OUT_OF_STOCK"];

const VISITOR_ID_PATTERN = /^[a-f0-9]{32}$/;
const mintVisitorId = () => crypto.randomBytes(16).toString("hex");
const cleanVisitorId = (value) =>
  typeof value === "string" && VISITOR_ID_PATTERN.test(value) ? value : null;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function isWithinWindow(clickedAt, now = new Date()) {
  if (!clickedAt) return false;
  const age = now.getTime() - new Date(clickedAt).getTime();
  return age >= 0 && age < ATTRIBUTION_WINDOW_MS;
}

/**
 * Last-click write: the newest click on any eligible link for the product
 * replaces the previous attribution and restarts the 30-day window.
 */
async function recordClickAttribution({ visitorId, link, now = new Date() }) {
  if (!link.targetProduct) return null;
  const productId = link.targetProduct._id || link.targetProduct;
  const product = await Product.findById(productId).select("status");
  if (!product || !PROMOTABLE_STATUSES.includes(product.status)) return null;

  return AffiliateAttribution.findOneAndUpdate(
    { visitorId, product: productId },
    {
      $set: {
        link: link._id,
        affiliateUser: link.affiliateUser,
        affiliateCode: link.affiliateCode,
        clickedAt: now,
      },
    },
    { upsert: true, returnDocument: "after" }
  );
}

/**
 * Checkout-time lookup. Returns Map<productId, {link, affiliateUser,
 * affiliateCode, clickedAt}> using only server-side records; the caller passes
 * a visitorId and product ids it already validated against the database.
 */
async function resolveAttributions({ visitorId, buyerId = null, productIds = [], now = new Date() }) {
  const result = new Map();
  const vid = cleanVisitorId(visitorId);
  if (!vid || !productIds.length) return result;

  const rows = await AffiliateAttribution.find({
    visitorId: vid,
    product: { $in: productIds },
    clickedAt: { $gt: new Date(now.getTime() - ATTRIBUTION_WINDOW_MS), $lte: now },
  });

  for (const row of rows) {
    if (buyerId && String(row.affiliateUser) === String(buyerId)) continue; // no self-referral
    const link = await AffiliateLink.findById(row.link).select("targetProduct affiliateUser");
    if (!link || String(link.targetProduct) !== String(row.product)) continue;
    result.set(String(row.product), {
      link: link._id,
      affiliateUser: row.affiliateUser,
      affiliateCode: row.affiliateCode,
      clickedAt: row.clickedAt,
    });
  }
  return result;
}

/** Copies a resolved attribution onto a pending order item (mutates the plain item object). */
function applyAttribution(item, attribution) {
  if (!attribution) return item;
  item.affiliateUser = attribution.affiliateUser;
  item.affiliateLink = attribution.link;
  item.affiliateCode = attribution.affiliateCode;
  item.affiliateClickedAt = attribution.clickedAt;
  return item;
}

/** Which affiliate (if any) earns on this order item. Legacy order-level fields are honoured as a fallback. */
function itemAffiliate(order, item) {
  if (item.affiliateUser && item.affiliateCode) {
    return { user: item.affiliateUser, code: item.affiliateCode, link: item.affiliateLink || null };
  }
  if (order.affiliateUser && order.affiliateCode) {
    return { user: order.affiliateUser, code: order.affiliateCode, link: null };
  }
  return null;
}

/**
 * Creates the commission record for one paid order item. Idempotent on
 * (order, orderItemId): a repeated webhook finds the row and changes nothing.
 */
async function recordConversion({ order, item, settlement, session }) {
  const aff = itemAffiliate(order, item);
  if (!aff || !settlement || !(settlement.affiliateShare > 0)) return null;

  const res = await ConversionAudit.updateOne(
    { order: order._id, orderItemId: item._id },
    {
      $setOnInsert: {
        affiliateUser: aff.user,
        link: aff.link,
        targetProduct: item.product || null,
        referralCode: aff.code,
        conversionValue: settlement.grossAmount,
        commissionEarned: settlement.affiliateShare,
        settlement: settlement._id,
        buyer: order.user,
        quantity: item.quantity,
        clickedAt: item.affiliateClickedAt || null,
        status: "PENDING",
        convertedAt: new Date(),
      },
    },
    { upsert: true, session }
  );

  if (res.upsertedCount && aff.link) {
    await AffiliateLink.updateOne({ _id: aff.link }, { $inc: { conversionCount: 1 } }, { session });
  }
  return res.upsertedCount ? true : false;
}

/**
 * Reverses commission after a refund/cancellation.
 *  - refundAmount omitted (or >= order total): full reversal of what remains.
 *  - otherwise proportional to refundAmount / order total, never above what remains.
 * `key` makes the call idempotent: replaying the same refund event is a no-op.
 * Pass `session` to join the caller's transaction (e.g. the refund that
 * triggered it); otherwise this opens its own.
 *
 * Which wallet bucket is debited follows the commission's own status, not the
 * vendor settlement: PENDING commission sits in pendingBalance, APPROVED/PAID
 * commission sits in availableBalance (and the AFFILIATE_COMMISSION ledger).
 *
 * The claim is a compare-and-set on (status, reversedAmount) with plain column
 * filters, so exactly one of two concurrent replays applies and it behaves the
 * same on MongoDB and on the MySQL compatibility layer.
 */
async function reverseOrderCommission({ orderId, refundAmount = null, key, reason = "", session: outer = null }) {
  if (!key) throw new Error("A reversal key is required.");
  const order = await Order.findById(orderId).select("totalAmount").session(outer);
  if (!order) throw new Error("Order not found.");

  const full = refundAmount == null || Number(refundAmount) >= order.totalAmount;
  const ratio = full ? 1 : Math.max(0, Number(refundAmount)) / order.totalAmount;
  const outcome = [];

  const run = async (session) => {
    outcome.length = 0;
    const audits = await ConversionAudit.find({
      order: orderId,
      status: { $in: ["PENDING", "APPROVED", "PAID"] },
    }).session(session);

    for (const first of audits) {
      let audit = first;
      for (let attempt = 0; attempt < 5 && audit; attempt++) {
        if ((audit.reversals || []).some((r) => r.key === key)) break;
        if (!["PENDING", "APPROVED", "PAID"].includes(audit.status)) break;
        const remaining = round2(audit.commissionEarned - audit.reversedAmount);
        const amount = Math.min(remaining, full ? remaining : round2(audit.commissionEarned * ratio));
        if (!(amount > 0)) break;

        const wasPending = audit.status === "PENDING";
        const fullyReversed = round2(audit.reversedAmount + amount) >= audit.commissionEarned;

        // How much of an approved commission can still be taken back from the
        // available balance (the rest was already withdrawn).
        let taken = amount;
        if (!wasPending) {
          const wallet = await AffiliateWallet.findOne({ affiliateUser: audit.affiliateUser }).session(session);
          taken = Math.min(wallet ? wallet.availableBalance : 0, amount);
        }

        const update = {
          $inc: { reversedAmount: amount, unrecoveredAmount: wasPending ? 0 : round2(amount - taken) },
          $push: { reversals: { key, amount, reason, at: new Date() } },
        };
        if (fullyReversed) update.$set = { status: "REVERSED" };
        // Only the winner of this compare-and-set touches the wallet below.
        const claimed = await ConversionAudit.findOneAndUpdate(
          { _id: audit._id, status: audit.status, reversedAmount: audit.reversedAmount },
          update,
          { returnDocument: "after", session }
        );
        if (!claimed) {
          // Someone else changed the row (approval, another reversal): re-read and retry.
          audit = await ConversionAudit.findById(audit._id).session(session);
          continue;
        }

        if (wasPending) {
          await AffiliateWallet.updateOne(
            { affiliateUser: audit.affiliateUser },
            { $inc: { pendingBalance: -amount } },
            { session }
          );
        } else {
          if (taken > 0) {
            await AffiliateWallet.updateOne(
              { affiliateUser: audit.affiliateUser },
              { $inc: { availableBalance: -taken } },
              { session }
            );
          }
          // Mirror approveAffiliateCommissionsForOrder, which credited this account.
          const affAccount = await LedgerAccount.findOne({ accountType: "AFFILIATE_COMMISSION" }).session(session);
          if (affAccount) {
            await LedgerAccount.updateOne(
              { _id: affAccount._id },
              { $inc: { balance: -amount } },
              { session }
            );
          }
        }
        outcome.push({ audit: audit._id, amount, unrecovered: wasPending ? 0 : round2(amount - taken) });
        break;
      }
    }
  };

  if (outer) {
    await run(outer);
    return outcome;
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() => run(session));
  } finally {
    await session.endSession();
  }
  return outcome;
}

module.exports = {
  ATTRIBUTION_WINDOW_MS,
  PROMOTABLE_STATUSES,
  mintVisitorId,
  cleanVisitorId,
  isWithinWindow,
  recordClickAttribution,
  resolveAttributions,
  applyAttribution,
  itemAffiliate,
  recordConversion,
  reverseOrderCommission,
};
