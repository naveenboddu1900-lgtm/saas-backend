const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const { authenticate, authorize, tenantIsolation } = require('../middleware/auth');
const { ROLES } = require('../config/roles');

/**
 * @route   GET /api/analytics/sales
 * @desc    Get sales analytics
 * @access  Private (Vendor, Super Admin)
 */
router.get('/sales', authenticate, authorize(ROLES.VENDOR, ROLES.SUPER_ADMIN), tenantIsolation(), async (req, res, next) => {
  try {
    const { period = '30d' } = req.query;
    const tenantId = req.targetTenantId;
    
    const now = new Date();
    let startDate;
    
    switch (period) {
      case '7d': startDate = new Date(now - 7 * 24 * 60 * 60 * 1000); break;
      case '30d': startDate = new Date(now - 30 * 24 * 60 * 60 * 1000); break;
      case '90d': startDate = new Date(now - 90 * 24 * 60 * 60 * 1000); break;
      case '1y': startDate = new Date(now - 365 * 24 * 60 * 60 * 1000); break;
      default: startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
    }

    const matchStage = { createdAt: { $gte: startDate } };
    if (tenantId) matchStage.tenantId = tenantId;

    const salesData = await Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' },
          },
          revenue: { $sum: '$financial.total' },
          orders: { $sum: 1 },
          items: { $sum: { $size: '$items' } },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]);

    const formatted = salesData.map(d => ({
      date: `${d._id.year}-${String(d._id.month).padStart(2, '0')}-${String(d._id.day).padStart(2, '0')}`,
      revenue: d.revenue,
      orders: d.orders,
      items: d.items,
    }));

    res.json({
      success: true,
      data: { sales: formatted, period },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/analytics/products
 * @desc    Get product performance analytics
 * @access  Private (Vendor, Super Admin)
 */
router.get('/products', authenticate, authorize(ROLES.VENDOR, ROLES.SUPER_ADMIN), tenantIsolation(), async (req, res, next) => {
  try {
    const { period = '30d' } = req.query;
    const tenantId = req.targetTenantId;
    
    const now = new Date();
    const startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const matchStage = { createdAt: { $gte: startDate }, status: { $nin: ['cancelled', 'refunded'] } };
    if (tenantId) matchStage.tenantId = tenantId;

    const topProducts = await Order.aggregate([
      { $match: matchStage },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          name: { $first: '$items.name' },
          totalSold: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.totalPrice' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]);

    res.json({
      success: true,
      data: { topProducts },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/analytics/customers
 * @desc    Get customer analytics
 * @access  Private (Vendor, Super Admin)
 */
router.get('/customers', authenticate, authorize(ROLES.VENDOR, ROLES.SUPER_ADMIN), tenantIsolation(), async (req, res, next) => {
  try {
    const tenantId = req.targetTenantId;
    
    const matchStage = { paymentStatus: 'paid' };
    if (tenantId) matchStage.tenantId = tenantId;

    const customerStats = await Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$customer.userId',
          email: { $first: '$customer.email' },
          name: { $first: { $concat: ['$customer.firstName', ' ', '$customer.lastName'] } },
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$financial.total' },
          lastOrder: { $max: '$createdAt' },
        },
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 20 },
    ]);

    res.json({
      success: true,
      data: { customers: customerStats },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/analytics/overview
 * @desc    Get overview metrics
 * @access  Private (Vendor, Super Admin)
 */
router.get('/overview', authenticate, authorize(ROLES.VENDOR, ROLES.SUPER_ADMIN), tenantIsolation(), async (req, res, next) => {
  try {
    const tenantId = req.targetTenantId;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const matchStage = {};
    if (tenantId) matchStage.tenantId = tenantId;

    const [
      totalRevenue,
      monthlyRevenue,
      lastMonthRevenue,
      totalOrders,
      monthlyOrders,
      lastMonthOrders,
      totalCustomers,
      newCustomers,
    ] = await Promise.all([
      Order.aggregate([{ $match: { ...matchStage, paymentStatus: 'paid' } }, { $group: { _id: null, total: { $sum: '$financial.total' } } }]),
      Order.aggregate([{ $match: { ...matchStage, paymentStatus: 'paid', createdAt: { $gte: startOfMonth } } }, { $group: { _id: null, total: { $sum: '$financial.total' } } }]),
      Order.aggregate([{ $match: { ...matchStage, paymentStatus: 'paid', createdAt: { $gte: lastMonth, $lte: endOfLastMonth } } }, { $group: { _id: null, total: { $sum: '$financial.total' } } }]),
      Order.countDocuments(matchStage),
      Order.countDocuments({ ...matchStage, createdAt: { $gte: startOfMonth } }),
      Order.countDocuments({ ...matchStage, createdAt: { $gte: lastMonth, $lte: endOfLastMonth } }),
      User.countDocuments(tenantId ? { tenantId, role: 'customer' } : { role: 'customer' }),
      User.countDocuments(tenantId ? { tenantId, role: 'customer', createdAt: { $gte: startOfMonth } } : { role: 'customer', createdAt: { $gte: startOfMonth } }),
    ]);

    const currentRevenue = monthlyRevenue[0]?.total || 0;
    const previousRevenue = lastMonthRevenue[0]?.total || 0;
    const revenueGrowth = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue * 100).toFixed(2) : 0;

    const currentOrders = monthlyOrders;
    const previousOrders = lastMonthOrders;
    const orderGrowth = previousOrders > 0 ? ((currentOrders - previousOrders) / previousOrders * 100).toFixed(2) : 0;

    res.json({
      success: true,
      data: {
        revenue: {
          total: totalRevenue[0]?.total || 0,
          monthly: currentRevenue,
          growth: parseFloat(revenueGrowth),
        },
        orders: {
          total: totalOrders,
          monthly: currentOrders,
          growth: parseFloat(orderGrowth),
        },
        customers: {
          total: totalCustomers,
          new: newCustomers,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;