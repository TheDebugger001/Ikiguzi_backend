const mongoose = require("mongoose");
const LedgerAccount = require("../models/LedgerAccount");
const LedgerEntry = require("../models/LedgerEntry");
const Settlement = require("../models/Settlement");
const VendorWallet = require("../models/VendorWallet");
const AdminWallet = require("../models/AdminWallet");
const DeveloperWallet = require("../models/DeveloperWallet");
const AffiliateWallet = require("../models/AffiliateWallet");
const ConversionAudit = require("../models/ConversionAudit");
const AffiliateLink = require("../models/AffiliateLink");
const User = require("../models/User");

async function getOrCreateLedgerAccount({ accountType, ownerId = null, session }) {
  const query = { accountType };
  if (ownerId) query.ownerId = ownerId;

  let account = await LedgerAccount.findOne(query).session(session);
  if (!account) {
    const accountNumber = ownerId
      ? `ACC-${accountType}-${ownerId}`
      : `ACC-${accountType}-001`;
    account = await LedgerAccount.create(
      [{ accountNumber, accountType, ownerId, balance: 0 }],
      { session }
    ).then((res) => res[0]);
  }
  return account;
}

async function findDefaultAdmin(session) {
  const admin = await User.findOne({ role: { $in: ["super_admin", "admin"] } })
    .session(session)
    .sort({ createdAt: 1 });
  return admin ? admin._id : null;
}

async function findDefaultDeveloper(session) {
  const dev = await User.findOne({ role: "developer" })
    .session(session)
    .sort({ createdAt: 1 });
  return dev ? dev._id : null;
}

exports.lockPaymentInEscrow = async ({
  orderId,
  vendorId,
  grossAmount,
  commissionAmount,
  session,
  split = null,
  affiliateUserId = null,
}) => {
  const platformFee = split
    ? Number(split.totalPlatformFee) || Number(split.commissionAmount) || 0
    : Number(commissionAmount) || 0;
  const netAmount = split
    ? Number(split.vendorNet) || Number(split.vendorNetEarnings) || grossAmount - platformFee
    : grossAmount - commissionAmount;
  const devShare = split ? split.developerShare : 0;
  const adminShare = split ? split.adminShare : 0;
  const affShare = split ? split.affiliateShare : 0;
  const gwFee = split ? split.gatewayFee : 0;

  const escrowAccount = await getOrCreateLedgerAccount({ accountType: "ESCROW_HOLDING", session });
  const vendorAccount = await getOrCreateLedgerAccount({ accountType: "VENDOR_PAYABLE", ownerId: vendorId, session });

  escrowAccount.balance += grossAmount;
  await escrowAccount.save({ session });

  await LedgerEntry.create(
    [
      {
        transactionReference: `MVEC-TXN-${Date.now()}`,
        debitAccount: escrowAccount._id,
        creditAccount: vendorAccount._id,
        amount: grossAmount,
        entryType: "PAYMENT_ESCROW_LOCK",
        relatedOrder: orderId,
        description: `Escrow hold for Order #${orderId}`,
      },
    ],
    { session }
  );

  const adminUserId = adminShare > 0 ? await findDefaultAdmin(session) : null;

  const settlement = await Settlement.create(
    [
      {
        settlementReference: `MVEC-SETTLE-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
        order: orderId,
        vendor: vendorId,
        grossAmount,
        commissionAmount: platformFee,
        netAmount,
        developerShare: devShare,
        adminShare,
        affiliateShare: affShare,
        gatewayFee: gwFee,
        affiliateUser: affiliateUserId,
        status: "HELD",
      },
    ],
    { session }
  );

  await VendorWallet.findOneAndUpdate(
    { vendor: vendorId },
    { $inc: { pendingBalance: netAmount } },
    { upsert: true, session }
  );

  if (devShare > 0) {
    const developerUserId = await findDefaultDeveloper(session);
    if (developerUserId) {
      await DeveloperWallet.findOneAndUpdate(
        { developerUser: developerUserId },
        { $inc: { pendingBalance: devShare } },
        { upsert: true, session }
      );
    }
  }

  if (adminShare > 0 && adminUserId) {
    await AdminWallet.findOneAndUpdate(
      { adminUser: adminUserId },
      { $inc: { pendingBalance: adminShare } },
      { upsert: true, session }
    );
  }

  if (affShare > 0 && affiliateUserId) {
    await AffiliateWallet.findOneAndUpdate(
      { affiliateUser: affiliateUserId },
      { $inc: { pendingBalance: affShare } },
      { upsert: true, session }
    );
  }

  return settlement[0];
};

exports.releaseEscrowToVendor = async ({ settlementId, session, adminUserId = null }) => {
  const settlement = await Settlement.findById(settlementId).session(session);
  if (!settlement) {
    throw new Error("Settlement not found.");
  }

  if (settlement.status !== "HELD") {
    throw new Error(`Settlement is not eligible for release with status: ${settlement.status}`);
  }

  const escrowAccount = await getOrCreateLedgerAccount({ accountType: "ESCROW_HOLDING", session });
  const vendorAccount = await getOrCreateLedgerAccount({ accountType: "VENDOR_PAYABLE", ownerId: settlement.vendor, session });
  const platformAccount = await getOrCreateLedgerAccount({ accountType: "PLATFORM_REVENUE", session });

  const devShare = settlement.developerShare || 0;
  const adminShare = settlement.adminShare || 0;
  const affShare = settlement.affiliateShare || 0;
  const gwFee = settlement.gatewayFee || 0;

  escrowAccount.balance -= settlement.grossAmount;
  vendorAccount.balance += settlement.netAmount;
  platformAccount.balance += settlement.commissionAmount;

  await escrowAccount.save({ session });
  await vendorAccount.save({ session });
  await platformAccount.save({ session });

  if (devShare > 0) {
    const devAccount = await getOrCreateLedgerAccount({ accountType: "DEVELOPER_REVENUE", session });
    devAccount.balance += devShare;
    await devAccount.save({ session });

    const developerUserId = await findDefaultDeveloper(session);
    if (developerUserId) {
      await DeveloperWallet.findOneAndUpdate(
        { developerUser: developerUserId },
        {
          $inc: {
            pendingBalance: -devShare,
            availableBalance: devShare,
            totalEarned: devShare,
          },
        },
        { session }
      );
    }
  }

  if (adminShare > 0) {
    const adminAccount = await getOrCreateLedgerAccount({ accountType: "ADMIN_REVENUE", session });
    adminAccount.balance += adminShare;
    await adminAccount.save({ session });

    const targetAdminId = adminUserId || (await findDefaultAdmin(session));
    if (targetAdminId) {
      await AdminWallet.findOneAndUpdate(
        { adminUser: targetAdminId },
        {
          $inc: {
            pendingBalance: -adminShare,
            availableBalance: adminShare,
            totalEarned: adminShare,
          },
        },
        { session }
      );
    }
  }

  if (affShare > 0 && settlement.affiliateUser) {
    const affAccount = await getOrCreateLedgerAccount({ accountType: "AFFILIATE_COMMISSION", session });
    affAccount.balance += affShare;
    await affAccount.save({ session });

    await AffiliateWallet.findOneAndUpdate(
      { affiliateUser: settlement.affiliateUser },
      {
        $inc: {
          pendingBalance: -affShare,
          availableBalance: affShare,
          totalEarned: affShare,
        },
      },
      { session }
    );
  }

  if (gwFee > 0) {
    const gwAccount = await getOrCreateLedgerAccount({ accountType: "GATEWAY_FEES", session });
    gwAccount.balance += gwFee;
    await gwAccount.save({ session });
  }

  settlement.status = "RELEASED";
  settlement.releasedAt = new Date();
  await settlement.save({ session });

  await LedgerEntry.create(
    [
      {
        transactionReference: `MVEC-RELEASE-${Date.now()}`,
        debitAccount: escrowAccount._id,
        creditAccount: vendorAccount._id,
        amount: settlement.netAmount,
        entryType: "ESCROW_RELEASE_VENDOR",
        relatedOrder: settlement.order,
        description: `Net payout released to vendor for settlement ${settlement.settlementReference}`,
      },
      {
        transactionReference: `MVEC-COMM-${Date.now()}`,
        debitAccount: escrowAccount._id,
        creditAccount: platformAccount._id,
        amount: settlement.commissionAmount,
        entryType: "PLATFORM_COMMISSION_DEDUCTION",
        relatedOrder: settlement.order,
        description: `Platform commission deducted for settlement ${settlement.settlementReference}`,
      },
    ],
    { session }
  );

  await VendorWallet.findOneAndUpdate(
    { vendor: settlement.vendor },
    {
      $inc: {
        pendingBalance: -settlement.netAmount,
        availableBalance: settlement.netAmount,
        totalEarned: settlement.netAmount,
      },
    },
    { session }
  );

  // For affiliate conversions, a RELEASED settlement means the commission is
  // "approved" (confirmed) — it may now be withdrawn once available.
  if (affShare > 0 && settlement.affiliateUser) {
    await ConversionAudit.updateMany(
      { order: settlement.order, affiliateUser: settlement.affiliateUser, status: "PENDING" },
      { status: "APPROVED", approvedAt: new Date() },
      { session }
    );
  }

  return settlement;
};

// Reverses a settlement for a cancelled/refunded order. Handles both money
// states:
//  - HELD    -> escrow was never released; simply unwind pending balances.
//  - RELEASED-> money already reached vendor/affiliate wallets; claw back from
//               available balances (floored at 0) and track any shortfall as a
//               debt on `clawbackBalance` to be recovered from future payouts.
async function applyWalletClawback({ walletModel, ownerField, ownerId, amount, session }) {
  if (!amount || amount <= 0) return;
  const wallet = await walletModel.findOne({ [ownerField]: ownerId }).session(session);
  if (!wallet) return;

  const available = Number(wallet.availableBalance) || 0;
  const recover = Math.min(available, amount);
  const shortfall = amount - recover;

  const update = {
    availableBalance: available - recover,
    totalEarned: Math.max(0, (Number(wallet.totalEarned) || 0) - amount),
  };
  if (shortfall > 0) {
    update.clawbackBalance = (Number(wallet.clawbackBalance) || 0) + shortfall;
  }
  await walletModel.updateOne({ _id: wallet._id }, { $set: update }).session(session);
}

async function markConversionRejected({ orderId, commissionAmount, session }) {
  const audits = await ConversionAudit.find({ order: orderId, status: { $in: ["PENDING", "APPROVED"] } })
    .session(session);
  const affectedLinks = new Set();
  for (const audit of audits) {
    if (audit.link) affectedLinks.add(String(audit.link));
  }
  await ConversionAudit.updateMany(
    { order: orderId },
    { status: "REJECTED" },
    { session }
  );
  for (const linkId of affectedLinks) {
    await AffiliateLink.updateOne(
      { _id: linkId, conversionCount: { $gt: 0 } },
      { $inc: { conversionCount: -1 } },
      { session }
    );
  }
}

exports.reverseSettlement = async ({ orderId, reason = "REFUND", session, adminUserId = null }) => {
  const settlements = await Settlement.find({ order: orderId, status: { $in: ["HELD", "RELEASED"] } })
    .session(session);

  if (settlements.length === 0) return { reversed: 0 };

  let reversed = 0;
  for (const settlement of settlements) {
    const escrowAccount = await getOrCreateLedgerAccount({ accountType: "ESCROW_HOLDING", session });
    const vendorAccount = await getOrCreateLedgerAccount({ accountType: "VENDOR_PAYABLE", ownerId: settlement.vendor, session });
    const platformAccount = await getOrCreateLedgerAccount({ accountType: "PLATFORM_REVENUE", session });

    const gross = settlement.grossAmount;
    const net = settlement.netAmount;
    const commission = settlement.commissionAmount;

    if (settlement.status === "RELEASED") {
      const devShare = settlement.developerShare || 0;
      const adminShare = settlement.adminShare || 0;
      const affShare = settlement.affiliateShare || 0;

      // Unwind released ledger balances.
      vendorAccount.balance = Math.max(0, vendorAccount.balance - net);
      platformAccount.balance = Math.max(0, platformAccount.balance - commission);
      escrowAccount.balance = Math.max(0, escrowAccount.balance - gross);
      await vendorAccount.save({ session });
      await platformAccount.save({ session });
      await escrowAccount.save({ session });

      if (devShare > 0) {
        const devAccount = await getOrCreateLedgerAccount({ accountType: "DEVELOPER_REVENUE", session });
        devAccount.balance = Math.max(0, devAccount.balance - devShare);
        await devAccount.save({ session });
        const developerUserId = await findDefaultDeveloper(session);
        if (developerUserId) {
          await applyWalletClawback({ walletModel: DeveloperWallet, ownerField: "developerUser", ownerId: developerUserId, amount: devShare, session });
        }
      }

      if (adminShare > 0) {
        const adminAccount = await getOrCreateLedgerAccount({ accountType: "ADMIN_REVENUE", session });
        adminAccount.balance = Math.max(0, adminAccount.balance - adminShare);
        await adminAccount.save({ session });
        const targetAdminId = adminUserId || (await findDefaultAdmin(session));
        if (targetAdminId) {
          await applyWalletClawback({ walletModel: AdminWallet, ownerField: "adminUser", ownerId: targetAdminId, amount: adminShare, session });
        }
      }

      // Vendor clawback (available balance, floored; shortfall becomes debt).
      await applyWalletClawback({ walletModel: VendorWallet, ownerField: "vendor", ownerId: settlement.vendor, amount: net, session });
      // Reset pending balance in case a later request re-settles the order.
      await VendorWallet.updateOne(
        { vendor: settlement.vendor },
        { $inc: { pendingBalance: -net } },
        { session }
      );

      if (affShare > 0 && settlement.affiliateUser) {
        const affAccount = await getOrCreateLedgerAccount({ accountType: "AFFILIATE_COMMISSION", session });
        affAccount.balance = Math.max(0, affAccount.balance - affShare);
        await affAccount.save({ session });
        await applyWalletClawback({ walletModel: AffiliateWallet, ownerField: "affiliateUser", ownerId: settlement.affiliateUser, amount: affShare, session });
      }

      await markConversionRejected({ orderId, session });
    } else {
      // HELD — escrow never left the holding account.
      escrowAccount.balance = Math.max(0, escrowAccount.balance - gross);
      await escrowAccount.save({ session });

      await VendorWallet.updateOne(
        { vendor: settlement.vendor },
        { $inc: { pendingBalance: -net } },
        { session }
      );
      if ((settlement.affiliateShare || 0) > 0 && settlement.affiliateUser) {
        await AffiliateWallet.updateOne(
          { affiliateUser: settlement.affiliateUser },
          { $inc: { pendingBalance: -settlement.affiliateShare } },
          { session }
        );
      }
      await markConversionRejected({ orderId, session });
    }

    settlement.status = "REFUNDED";
    settlement.releasedAt = null;
    settlement.adminHoldReason = reason;
    await settlement.save({ session });

    await LedgerEntry.create(
      [
        {
          transactionReference: `MVEC-REFUND-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
          debitAccount: vendorAccount._id,
          creditAccount: platformAccount._id,
          amount: commission,
          entryType: reason === "REFUND" ? "ESCROW_REVERSAL" : "ESCROW_UNWIND",
          relatedOrder: orderId,
          description: `Settlement ${settlement.settlementReference} reversed (${reason}) for order ${orderId}`,
        },
      ],
      { session }
    );

    reversed += 1;
  }

  return { reversed };
};