const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Subscription = require('../models/Subscription');
const ActivityLog = require('../models/ActivityLog');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');
const { paginate } = require('../utils/helpers');

/**
 * @route   GET /api/admin/dashboard
 * @desc    Get super admin dashboard metrics
 * @access  Private (Super Admin)
 */
router.get('/dashboard', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));

    const [
      totalUsers,
      totalTenants,
      totalProducts,
      totalOrders,
      activeTenants,
      pendingTenants,
      monthlyUsers,
      monthlyTenants,
      monthlyOrders,
      revenueStats,
      recentActivity,
      planDistribution,
    ] = await Promise.all([
      User.countDocuments(),
      Tenant.countDocuments(),
      Product.countDocuments(),
      Order.countDocuments(),
      Tenant.countDocuments({ status: 'active' }),
      Tenant.countDocuments({ status: 'pending' }),
      User.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Tenant.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Order.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Order.aggregate([
        { $match: { paymentStatus: 'paid' } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$financial.total' },
            monthlyRevenue: {
              $sum: {
                $cond: [{ $gte: ['$createdAt', startOfMonth] }, '$financial.total', 0],
              },
            },
            weeklyRevenue: {
              $sum: {
                $cond: [{ $gte: ['$createdAt', startOfWeek] }, '$financial.total', 0],
              },
            },
          },
        },
      ]),
      ActivityLog.find().sort('-createdAt').limit(10).populate('userId', 'firstName lastName email'),
      Tenant.aggregate([
        { $group: { _id: '$plan', count: { $sum: 1 } } },
      ]),
    ]);

    const revenue = revenueStats[0] || { totalRevenue: 0, monthlyRevenue: 0, weeklyRevenue: 0 };

    res.json({
      success: true,
      data: {
        metrics: {
          totalUsers,
          totalTenants,
          totalProducts,
          totalOrders,
          activeTenants,
          pendingTenants,
          totalRevenue: revenue.totalRevenue,
          monthlyRevenue: revenue.monthlyRevenue,
          weeklyRevenue: revenue.weeklyRevenue,
          monthlyUsers,
          monthlyTenants,
          monthlyOrders,
        },
        planDistribution: planDistribution.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {}),
        recentActivity,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/admin/users
 * @desc    Get all users (super admin view)
 * @access  Private (Super Admin)
 */
router.get('/users', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, role, status, search } = req.query;
    
    const query = {};
    if (role) query.role = role;
    if (status) query.isActive = status === 'active';
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const result = await paginate(User, query, { page, limit, sort: '-createdAt' });

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/admin/tenants
 * @desc    Get all tenants with details
 * @access  Private (Super Admin)
 */
router.get('/tenants', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, plan, search } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (plan) query.plan = plan;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
        { 'contact.email': { $regex: search, $options: 'i' } },
      ];
    }

    const result = await paginate(Tenant, query, { page, limit, sort: '-createdAt' });

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/admin/activity-logs
 * @desc    Get all activity logs
 * @access  Private (Super Admin)
 */
router.get('/activity-logs', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { page = 1, limit = 50, action, severity, userId, tenantId, startDate, endDate } = req.query;
    
    const query = {};
    if (action) query.action = action;
    if (severity) query.severity = severity;
    if (userId) query.userId = userId;
    if (tenantId) query.tenantId = tenantId;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const result = await paginate(ActivityLog, query, { page, limit, sort: '-createdAt' });

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/admin/settings
 * @desc    Get platform settings
 * @access  Private (Super Admin)
 */
router.get('/settings', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const settings = {
      platform: {
        name: process.env.PLATFORM_NAME || 'SaaS Platform',
        version: '1.0.0',
        maintenanceMode: false,
        allowSignups: true,
        requireEmailVerification: true,
      },
      features: {
        stripeEnabled: !!process.env.STRIPE_SECRET_KEY,
        emailEnabled: !!process.env.SMTP_HOST,
        analyticsEnabled: true,
      },
      limits: {
        maxTenants: -1,
        maxUsersPerTenant: -1,
      },
    };

    res.json({
      success: true,
      data: { settings },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /api/admin/settings
 * @desc    Update platform settings
 * @access  Private (Super Admin)
 */
router.put('/settings', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    res.json({
      success: true,
      message: 'Settings updated (in production, this would persist to DB)',
      data: { settings: req.body },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;