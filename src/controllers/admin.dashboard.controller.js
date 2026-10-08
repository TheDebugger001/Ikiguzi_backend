const User = require("../models/User");
const Vendor = require("../models/Vendor");
const Supplier = require("../models/Supplier");
const AffiliateAccount = require("../models/AffiliateAccount");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Settlement = require("../models/Settlement");
const Dispute = require("../models/Dispute");
const Category = require("../models/Category");

const uniqueIds = (...groups) => new Set(groups.flat().filter(Boolean).map(String)).size;
const pagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || query.limit, 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
};

exports.getOverview = async (_req, res) => {
  try {
    // Dashboard "today" follows Kigali (UTC+2), independent of server timezone.
    const kigaliNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const today = new Date(Date.UTC(kigaliNow.getUTCFullYear(), kigaliNow.getUTCMonth(), kigaliNow.getUTCDate()) - 2 * 60 * 60 * 1000);
    const pendingDisputeStatuses = ["OPEN", "UNDER_REVIEW", "EVIDENCE_SUBMITTED"];

    const [
      totalUsers, totalBuyers, vendorUserIds, vendorProfileIds, supplierUserIds,
      supplierProfileIds, affiliateUserIds, affiliateProfileIds, totalProducts,
      totalOrders, ordersToday, gmvRows, commissionRows, pendingDisputes,
      pendingRefunds, pendingDeliveries, pendingVendorVerifications, categoryRows,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: "buyer" }),
      User.distinct("_id", { role: "vendor" }),
      Vendor.distinct("user"),
      User.distinct("_id", { role: "supplier" }),
      Supplier.distinct("user"),
      User.distinct("_id", { role: "affiliate" }),
      AffiliateAccount.distinct("affiliateUser"),
      Product.countDocuments({}),
      Order.countDocuments({}),
      Order.countDocuments({ createdAt: { $gte: today } }),
      Order.aggregate([
        { $match: { createdAt: { $gte: today }, paymentStatus: { $in: ["PAID", "CONFIRMED"] } } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]),
      Settlement.aggregate([
        { $match: { createdAt: { $gte: today }, status: { $nin: ["CANCELLED", "REFUNDED"] } } },
        { $group: { _id: null, total: { $sum: "$commissionAmount" } } },
      ]),
      Dispute.countDocuments({ status: { $in: pendingDisputeStatuses } }),
      Dispute.countDocuments({ status: { $in: ["UNDER_REVIEW", "EVIDENCE_SUBMITTED"] } }),
      Order.countDocuments({ orderStatus: { $in: ["SHIPPED", "OUT_FOR_DELIVERY"] } }),
      Vendor.countDocuments({ verificationStatus: "PENDING" }),
      Product.aggregate([
        { $group: { _id: "$category", products: { $sum: 1 } } },
        { $sort: { products: -1 } },
        { $limit: 6 },
      ]),
    ]);

    const categoryIds = categoryRows.map((row) => row._id).filter(Boolean);
    const categories = await Category.find({ _id: { $in: categoryIds } }).select("name").lean();
    const categoryNames = new Map(categories.map((category) => [String(category._id), category.name]));

    return res.status(200).json({
      overview: {
        totalUsers,
        totalVendors: uniqueIds(vendorUserIds, vendorProfileIds),
        totalSuppliers: uniqueIds(supplierUserIds, supplierProfileIds),
        totalAffiliates: uniqueIds(affiliateUserIds, affiliateProfileIds),
        totalBuyers,
        totalProducts,
        totalOrders,
        ordersToday,
        gmvToday: gmvRows[0]?.total || 0,
        mvecRevenueToday: commissionRows[0]?.total || 0,
        pendingDisputes,
        pendingRefunds,
        pendingDeliveries,
        pendingVendorVerifications,
        topCategories: categoryRows.map((row) => ({
          id: String(row._id),
          name: categoryNames.get(String(row._id)) || "Uncategorized",
          products: row.products,
        })),
      },
    });
  } catch (error) {
    console.error("Admin overview error:", error);
    return res.status(500).json({ message: "Could not load marketplace overview." });
  }
};

exports.getProducts = async (req, res) => {
  try {
    const { page, pageSize, skip } = pagination(req.query);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.search) filter.name = { $regex: String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    const [data, total] = await Promise.all([
      Product.find(filter).populate("vendor", "Fullname companyName email").populate("category", "name")
        .sort({ createdAt: -1 }).skip(skip).limit(pageSize),
      Product.countDocuments(filter),
    ]);
    return res.json({ data, meta: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
  } catch (error) {
    console.error("Admin products error:", error);
    return res.status(500).json({ message: "Could not load products." });
  }
};

exports.getOrders = async (req, res) => {
  try {
    const { page, pageSize, skip } = pagination(req.query);
    const [data, total] = await Promise.all([
      Order.find({}).populate("user", "Fullname email")
        .populate("items.vendor", "Fullname companyName")
        .sort({ createdAt: -1 }).skip(skip).limit(pageSize),
      Order.countDocuments({}),
    ]);
    return res.json({ data, meta: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
  } catch (error) {
    console.error("Admin orders error:", error);
    return res.status(500).json({ message: "Could not load orders." });
  }
};
