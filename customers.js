const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const Tenant = require('../models/Tenant');
const { authenticate, requireCustomer } = require('../middleware/auth');
const { paginate } = require('../utils/helpers');

/**
 * @route   GET /api/customers/orders
 * @desc    Get customer's order history
 * @access  Private (Customer)
 */
router.get('/orders', authenticate, requireCustomer, async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = {
      'customer.userId': req.user.id,
    };
    
    if (status) query.status = status;

    const result = await paginate(Order, query, { page, limit, sort: '-createdAt' });

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
 * @route   GET /api/customers/orders/:id
 * @desc    Get order details
 * @access  Private (Customer)
 */
router.get('/orders/:id', authenticate, requireCustomer, async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      'customer.userId': req.user.id,
    }).populate('items.productId', 'name images slug');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    res.json({
      success: true,
      data: { order },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/customers/profile
 * @desc    Get customer profile with stats
 * @access  Private (Customer)
 */
router.get('/profile', authenticate, requireCustomer, async (req, res, next) => {
  try {
    const [orderCount, totalSpent] = await Promise.all([
      Order.countDocuments({ 'customer.userId': req.user.id, paymentStatus: 'paid' }),
      Order.aggregate([
        { $match: { 'customer.userId': req.user.id, paymentStatus: 'paid' } },
        { $group: { _id: null, total: { $sum: '$financial.total' } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        user: {
          id: req.user.id,
          email: req.user.email,
          firstName: req.user.firstName,
          lastName: req.user.lastName,
          fullName: req.user.fullName,
          avatar: req.user.avatar,
          phone: req.user.phone,
        },
        stats: {
          totalOrders: orderCount,
          totalSpent: totalSpent[0]?.total || 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;