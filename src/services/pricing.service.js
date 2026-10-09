const CommissionRule = require("../models/CommissionRule");
const PricingSnapshot = require("../models/PricingSnapshot");
const { computeRevenueSplit, TOTAL_PLATFORM_FEE_PERCENT } = require("../config/revenueSplit");

async function getApplicableCommissionRule({ productId, vendorId, categoryId }) {
  const activeRules = await CommissionRule.find({
    isActive: true,
    $or: [
      { ruleType: "PRODUCT", targetProduct: productId },
      { ruleType: "VENDOR", targetVendor: vendorId },
      { ruleType: "CATEGORY", targetCategory: categoryId },
      { ruleType: "GLOBAL" },
    ],
  }).sort({ priority: -1, createdAt: -1 });

  if (!activeRules.length) {
    return {
      _id: null,
      rateType: "PERCENTAGE",
      rateValue: TOTAL_PLATFORM_FEE_PERCENT,
    };
  }

  return activeRules[0];
}

exports.createItemPricingSnapshot = async ({ orderId, item, session, hasAffiliate = false, gatewayFee = 0, affiliateRatePercent = null }) => {
  const { product, vendor, category, price, quantity } = item;
  const unitPrice = price;
  const grossTotal = unitPrice * quantity;

  const rule = await getApplicableCommissionRule({
    productId: product._id || product,
    vendorId: vendor._id || vendor,
    categoryId: category,
  });

  let commissionAmount = 0;
  if (rule.rateType === "PERCENTAGE") {
    commissionAmount = (grossTotal * rule.rateValue) / 100;
  } else if (rule.rateType === "FIXED") {
    commissionAmount = rule.rateValue * quantity;
  }

  commissionAmount = Math.min(commissionAmount, grossTotal);

  const split = computeRevenueSplit({ grossTotal, hasAffiliate, gatewayFee, affiliateRatePercent });

  const snapshot = await PricingSnapshot.create(
    [
      {
        order: orderId,
        product: product._id || product,
        vendor: vendor._id || vendor,
        unitPrice,
        quantity,
        grossTotal,
        commissionRuleApplied: rule._id,
        commissionRateType: rule.rateType,
        commissionRateValue: rule.rateValue,
        commissionAmount: split.totalPlatformFee,
        vendorNetEarnings: split.vendorNet,
        developerShare: split.developerShare,
        adminShare: split.adminShare,
        affiliateShare: split.affiliateShare,
        gatewayFee: split.gatewayFee,
        hasAffiliate,
      },
    ],
    { session }
  );

  return snapshot[0];
};

exports.computeRevenueSplit = computeRevenueSplit;
