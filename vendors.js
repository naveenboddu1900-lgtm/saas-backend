const express = require('express');
const router = express.Router();
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { authenticate, requireVendor, tenantIsolation } = require('../middleware/auth');
const { paginate } = require('../utils/helpers');

/**
 * @route   GET /api/vendors/dashboard
 * @desc    Get vendor dashboard data
 * @access  Private (Vendor)
 */
router.get('/dashboard', authenticate, requireVendor, async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;

    // Get key metrics
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));

    const [
      totalProducts,
      totalOrders,
      totalCustomers,
      monthlyOrders,
      weeklyOrders,
      recentOrders,
      lowStockProducts,
    ] = await Promise.all([
      Product.countDocuments({ tenantId, status: 'active' }),
      Order.countDocuments({ tenantId }),
      User.countDocuments({ tenantId, role: 'customer' }),
      Order.countDocuments({ tenantId, createdAt: { $gte: startOfMonth } }),
      Order.countDocuments({ tenantId, createdAt: { $gte: startOfWeek } }),
      Order.find({ tenantId }).sort('-createdAt').limit(5).populate('items.productId', 'name images'),
      Product.find({ tenantId, 'inventory.quantity': { $lte: 5 }, 'inventory.trackInventory': true })
        .select('name sku inventory')
        .limit(10),
    ]);

    // Calculate revenue
    const revenueStats = await Order.aggregate([
      { $match: { tenantId: tenantId, paymentStatus: 'paid' } },
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
    ]);

    const revenue = revenueStats[0] || { totalRevenue: 0, monthlyRevenue: 0, weeklyRevenue: 0 };

    res.json({
      success: true,
      data: {
        metrics: {
          totalProducts,
          totalOrders,
          totalCustomers,
          totalRevenue: revenue.totalRevenue,
          monthlyRevenue: revenue.monthlyRevenue,
          weeklyRevenue: revenue.weeklyRevenue,
          monthlyOrders,
          weeklyOrders,
        },
        recentOrders,
        lowStockProducts,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/vendors/customers
 * @desc    Get vendor's customers
 * @access  Private (Vendor)
 */
router.get('/customers', authenticate, requireVendor, async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const query = { tenantId: req.user.tenantId, role: 'customer' };

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
 * @route   GET /api/vendors/settings
 * @desc    Get vendor settings
 * @access  Private (Vendor)
 */
router.get('/settings', authenticate, requireVendor, async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.user.tenantId).select('settings branding features limits');

    res.json({
      success: true,
      data: { settings: tenant },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /api/vendors/settings
 * @desc    Update vendor settings
 * @access  Private (Vendor)
 */
router.put('/settings', authenticate, requireVendor, async (req, res, next) => {
  try {
    const allowedUpdates = ['settings', 'branding', 'contact'];
    const updates = {};
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const tenant = await Tenant.findByIdAndUpdate(
      req.user.tenantId,
      updates,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Settings updated successfully.',
      data: { settings: tenant },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;