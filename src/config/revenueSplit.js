const TOTAL_PLATFORM_FEE_PERCENT = 5;
const DEVELOPER_PERCENT = 1;
const AFFILIATE_PERCENT = 0.5;

function computeRevenueSplit({ grossTotal, hasAffiliate, gatewayFee = 0, affiliateRatePercent = null }) {
  const totalPlatformFee = (grossTotal * TOTAL_PLATFORM_FEE_PERCENT) / 100;
  const developerShare = (grossTotal * DEVELOPER_PERCENT) / 100;
  const rate = Number.isFinite(affiliateRatePercent) ? affiliateRatePercent : AFFILIATE_PERCENT;
  // Commission is capped so the admin share never goes negative: the affiliate
  // can only ever earn what is left of the platform fee after gateway + dev.
  const maxAffiliate = Math.max(0, totalPlatformFee - gatewayFee - developerShare);
  const affiliateShare = hasAffiliate ? Math.min((grossTotal * rate) / 100, maxAffiliate) : 0;
  const adminShare = Math.max(0, totalPlatformFee - gatewayFee - developerShare - affiliateShare);
  const vendorNet = grossTotal - totalPlatformFee;

  return {
    vendorNet,
    totalPlatformFee,
    gatewayFee,
    developerShare,
    affiliateShare,
    adminShare,
  };
}

module.exports = {
  TOTAL_PLATFORM_FEE_PERCENT,
  DEVELOPER_PERCENT,
  AFFILIATE_PERCENT,
  computeRevenueSplit,
};
