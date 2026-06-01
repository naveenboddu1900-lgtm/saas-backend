const express = require('express');
const router = express.Router();
const Tenant = require('../models/Tenant');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const { optionalAuth } = require('../middleware/auth');
const { paginate } = require('../utils/helpers');

/**
 * @route   GET /api/storefront/:slug
 * @desc    Get storefront by slug (public)
 * @access  Public
 */
router.get('/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    
    const tenant = await Tenant.findOne({ slug, status: 'active' }).select(
      'name slug description branding settings contact plan'
    );

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Storefront not found.',
      });
    }

    const featuredProducts = await Product.find({
      tenantId: tenant._id,
      status: 'active',
    })
      .select('name slug price compareAtPrice images shortDescription categories')
      .sort('-createdAt')
      .limit(8);

    const categories = await Product.distinct('categories', {
      tenantId: tenant._id,
      status: 'active',
    });

    res.json({
      success: true,
      data: {
        storefront: tenant,
        featuredProducts,
        categories,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/storefront/:slug/products
 * @desc    Get storefront products (public)
 * @access  Public
 */
router.get('/:slug/products', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 12, category, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const tenant = await Tenant.findOne({ slug, status: 'active' });
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Storefront not found.',
      });
    }

    const query = { tenantId: tenant._id, status: 'active' };
    if (category) query.categories = { $in: [category] };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } },
      ];
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const result = await paginate(Product, query, { page, limit, sort });

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
 * @route   GET /api/storefront/:slug/products/:productSlug
 * @desc    Get single product in storefront (public)
 * @access  Public
 */
router.get('/:slug/products/:productSlug', async (req, res, next) => {
  try {
    const { slug, productSlug } = req.params;

    const tenant = await Tenant.findOne({ slug, status: 'active' });
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Storefront not found.',
      });
    }

    const product = await Product.findOne({
      tenantId: tenant._id,
      slug: productSlug,
      status: 'active',
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    const relatedProducts = await Product.find({
      tenantId: tenant._id,
      status: 'active',
      _id: { $ne: product._id },
      categories: { $in: product.categories },
    })
      .select('name slug price images')
      .limit(4);

    res.json({
      success: true,
      data: {
        product,
        relatedProducts,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/storefront/:slug/categories
 * @desc    Get storefront categories
 * @access  Public
 */
router.get('/:slug/categories', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const tenant = await Tenant.findOne({ slug, status: 'active' });
    
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Storefront not found.',
      });
    }

    const categories = await Product.aggregate([
      { $match: { tenantId: tenant._id, status: 'active' } },
      { $unwind: '$categories' },
      {
        $group: {
          _id: '$categories',
          productCount: { $sum: 1 },
          image: { $first: { $arrayElemAt: ['$images.url', 0] } },
        },
      },
      { $sort: { productCount: -1 } },
    ]);

    res.json({
      success: true,
      data: { categories },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/storefront/:slug/orders
 * @desc    Create order from storefront (guest or authenticated)
 * @access  Public
 */
router.post('/:slug/orders', optionalAuth, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { items, customer, shippingAddress, billingAddress, notes } = req.body;

    const tenant = await Tenant.findOne({ slug, status: 'active' });
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Storefront not found.',
      });
    }

    const orderItems = [];
    let subtotal = 0;

    for (const item of items) {
      const product = await Product.findOne({
        _id: item.productId,
        tenantId: tenant._id,
        status: 'active',
      });

      if (!product) {
        return res.status(400).json({
          success: false,
          message: `Product ${item.productId} not found or unavailable.`,
        });
      }

      if (product.inventory.trackInventory && product.inventory.quantity < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient inventory for ${product.name}.`,
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
        image: product.images[0]?.url || null,
      });

      if (product.inventory.trackInventory) {
        product.inventory.quantity -= item.quantity;
        if (product.inventory.quantity <= 0) product.status = 'out_of_stock';
        await product.save();
      }
    }

    const tax = tenant.settings.enableTax ? subtotal * (tenant.settings.taxRate / 100) : 0;
    const shipping = req.body.shipping || 0;
    const discount = req.body.discount || 0;
    const total = subtotal + tax + shipping - discount;

    const order = await Order.create({
      tenantId: tenant._id,
      customer: {
        userId: req.user?.id || null,
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
      notes: notes || {},
      timeline: [
        { status: 'pending', message: 'Order placed via storefront', timestamp: new Date() },
      ],
    });

    await tenant.incrementUsage('orders');

    res.status(201).json({
      success: true,
      message: 'Order placed successfully.',
      data: { order },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;