const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Tenant = require('../models/Tenant');
const ActivityLog = require('../models/ActivityLog');
const { authenticate, authorize, tenantIsolation, requireCustomer } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { paginate } = require('../utils/helpers');
const { ROLES } = require('../config/roles');

/**
 * @route   GET /api/orders
 * @desc    Get all orders (with tenant filtering)
 * @access  Private (Vendor, Store Admin, Super Admin)
 */
router.get('/', authenticate, authorize(ROLES.VENDOR, ROLES.STORE_ADMIN, ROLES.SUPER_ADMIN), tenantIsolation(), async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status, paymentStatus, search, startDate, endDate } = req.query;
    
    const query = { tenantId: req.targetTenantId };
    
    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'customer.email': { $regex: search, $options: 'i' } },
        { 'customer.firstName': { $regex: search, $options: 'i' } },
        { 'customer.lastName': { $regex: search, $options: 'i' } },
      ];
    }

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
 * @route   GET /api/orders/:id
 * @desc    Get order by ID
 * @access  Private
 */
router.get('/:id', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const query = { _id: req.params.id };
    
    // Super admin sees all, others see only their tenant's orders
    if (req.user.role !== ROLES.SUPER_ADMIN) {
      if (req.user.role === ROLES.CUSTOMER) {
        query['customer.userId'] = req.user.id;
      } else {
        query.tenantId = req.targetTenantId;
      }
    }

    const order = await Order.findOne(query).populate('items.productId', 'name images slug');

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
 * @route   POST /api/orders
 * @desc    Create new order (Customer or Vendor)
 * @access  Private
 */
router.post('/', authenticate, [
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.productId').isMongoId(),
  body('items.*.quantity').isInt({ min: 1 }),
  body('customer.email').isEmail(),
  body('customer.firstName').trim().notEmpty(),
  body('customer.lastName').trim().notEmpty(),
  body('shippingAddress').isObject(),
  body('shippingAddress.street').trim().notEmpty(),
  body('shippingAddress.city').trim().notEmpty(),
  body('shippingAddress.state').trim().notEmpty(),
  body('shippingAddress.zip').trim().notEmpty(),
  body('shippingAddress.country').trim().notEmpty(),
], validate, async (req, res, next) => {
  try {
    const { items, customer, shippingAddress, billingAddress, notes, payment } = req.body;
    
    // Determine tenant
    let tenantId = req.user.tenantId;
    let targetTenantId = req.headers['x-target-tenant-id'];
    
    // For customer orders, they need to specify which tenant/store they're buying from
    if (req.user.role === ROLES.CUSTOMER && targetTenantId) {
      tenantId = targetTenantId;
    }

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant context is required to create an order.',
      });
    }

    // Validate products and calculate totals
    const orderItems = [];
    let subtotal = 0;

    for (const item of items) {
      const product = await Product.findOne({ _id: item.productId, tenantId, status: 'active' });
      
      if (!product) {
        return res.status(400).json({
          success: false,
          message: `Product ${item.productId} not found or unavailable.`,
        });
      }

      // Check inventory
      if (product.inventory.trackInventory && product.inventory.quantity < item.quantity && !product.inventory.allowBackorders) {
        return res.status(400).json({
          success: false,
          message: `Insufficient inventory for ${product.name}. Available: ${product.inventory.quantity}`,
        });
      }

      const totalPrice = product.price * item.quantity;
      subtotal += totalPrice;

      orderItems.push({
        productId: product._id,
        name: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice: product.price,
        totalPrice,
        variant: item.variant || null,
        image: product.images[0]?.url || null,
      });

      // Decrement inventory
      if (product.inventory.trackInventory) {
        product.inventory.quantity -= item.quantity;
        if (product.inventory.quantity <= 0) {
          product.status = 'out_of_stock';
        }
        await product.save();
      }
    }

    // Get tenant for tax calculation
    const tenant = await Tenant.findById(tenantId);
    const tax = tenant.settings.enableTax ? subtotal * (tenant.settings.taxRate / 100) : 0;
    const shipping = req.body.shipping || 0;
    const discount = req.body.discount || 0;
    const total = subtotal + tax + shipping - discount;

    const order = await Order.create({
      tenantId,
      customer: {
        userId: req.user.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone || null,
      },
      items: orderItems,
      status: 'pending',
      paymentStatus: 'pending',
      financial: {
        subtotal,
        tax,
        shipping,
        discount,
        total,
        currency: tenant.settings.currency,
      },
      shippingAddress,
      billingAddress: billingAddress || shippingAddress,
      payment: payment || { method: 'card' },
      notes: notes || {},
      timeline: [
        { status: 'pending', message: 'Order placed', timestamp: new Date() },
      ],
    });

    // Update tenant usage
    await tenant.incrementUsage('orders');

    await ActivityLog.create({
      userId: req.user.id,
      tenantId,
      action: 'order_created',
      entity: { type: 'order', id: order._id.toString(), name: order.orderNumber },
      details: { total, itemCount: items.length },
    });

    res.status(201).json({
      success: true,
      message: 'Order created successfully.',
      data: { order },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /api/orders/:id/status
 * @desc    Update order status
 * @access  Private (Vendor, Store Admin, Super Admin)
 */
router.put('/:id/status', authenticate, authorize(ROLES.VENDOR, ROLES.STORE_ADMIN, ROLES.SUPER_ADMIN), tenantIsolation(), [
  body('status').isIn(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']),
  body('message').optional().trim(),
], validate, async (req, res, next) => {
  try {
    const { status, message } = req.body;
    const tenantId = req.targetTenantId;

    const order = await Order.findOne({ _id: req.params.id, tenantId });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    // Update status
    order.status = status;
    order.timeline.push({
      status,
      message: message || `Status updated to ${status}`,
      timestamp: new Date(),
      userId: req.user.id,
    });

    // Update related statuses
    if (status === 'delivered') {
      order.fulfillmentStatus = 'fulfilled';
    } else if (status === 'cancelled') {
      order.paymentStatus = 'refunded';
      // Restore inventory
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.productId, {
          $inc: { 'inventory.quantity': item.quantity },
        });
      }
    }

    await order.save();

    await ActivityLog.create({
      userId: req.user.id,
      tenantId,
      action: 'order_updated',
      entity: { type: 'order', id: order._id.toString(), name: order.orderNumber },
      details: { status, message },
    });

    res.json({
      success: true,
      message: 'Order status updated.',
      data: { order },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /api/orders/:id/payment
 * @desc    Update payment status
 * @access  Private (Vendor, Store Admin, Super Admin)
 */
router.put('/:id/payment', authenticate, authorize(ROLES.VENDOR, ROLES.STORE_ADMIN, ROLES.SUPER_ADMIN), tenantIsolation(), [
  body('paymentStatus').isIn(['pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded']),
  body('transactionId').optional(),
], validate, async (req, res, next) => {
  try {
    const { paymentStatus, transactionId } = req.body;
    const tenantId = req.targetTenantId;

    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, tenantId },
      {
        paymentStatus,
        'payment.transactionId': transactionId || undefined,
        ...(paymentStatus === 'paid' && { 'payment.paidAt': new Date() }),
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    res.json({
      success: true,
      message: 'Payment status updated.',
      data: { order },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;