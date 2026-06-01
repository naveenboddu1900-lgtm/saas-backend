const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const Product = require('../models/Product');
const Tenant = require('../models/Tenant');
const ActivityLog = require('../models/ActivityLog');
const { authenticate, authorize, tenantIsolation, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { paginate, generateSlug } = require('../utils/helpers');
const { ROLES } = require('../config/roles');

/**
 * @route   GET /api/products
 * @desc    Get all products (with tenant filtering)
 * @access  Public (with optional auth) / Private
 */
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { page = 1, limit = 12, search, category, status = 'active', minPrice, maxPrice, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    
    const query = {};
    
    // Tenant filtering
    if (req.user?.tenantId) {
      query.tenantId = req.user.tenantId;
    } else if (req.headers['x-tenant-id']) {
      query.tenantId = req.headers['x-tenant-id'];
    } else if (req.query.tenantSlug) {
      const tenant = await Tenant.findOne({ slug: req.query.tenantSlug, status: 'active' });
      if (tenant) query.tenantId = tenant._id;
    }

    // If no tenant context and not super admin, return empty
    if (!query.tenantId && req.user?.role !== ROLES.SUPER_ADMIN) {
      return res.json({
        success: true,
        data: [],
        pagination: { page: 1, limit, total: 0, pages: 0, hasNext: false, hasPrev: false },
      });
    }

    // Filters
    if (status) query.status = status;
    if (category) query.categories = { $in: [category] };
    if (search) {
      query.$text = { $search: search };
    }
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = parseFloat(minPrice);
      if (maxPrice) query.price.$lte = parseFloat(maxPrice);
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
 * @route   GET /api/products/:id
 * @desc    Get single product
 * @access  Public (with optional auth)
 */
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const query = { _id: req.params.id };
    
    // For non-super-admin, enforce tenant visibility
    if (!req.user || req.user.role !== ROLES.SUPER_ADMIN) {
      if (req.user?.tenantId) {
        query.tenantId = req.user.tenantId;
      } else if (req.headers['x-tenant-id']) {
        query.tenantId = req.headers['x-tenant-id'];
      } else {
        return res.status(400).json({
          success: false,
          message: 'Tenant context required.',
        });
      }
    }

    const product = await Product.findOne(query);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    res.json({
      success: true,
      data: { product },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/products
 * @desc    Create product
 * @access  Private (Vendor, Store Admin, Super Admin)
 */
router.post('/', authenticate, authorize(ROLES.VENDOR, ROLES.STORE_ADMIN, ROLES.SUPER_ADMIN), tenantIsolation(), [
  body('name').trim().notEmpty().withMessage('Product name is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('sku').trim().notEmpty().withMessage('SKU is required'),
  body('description').optional().trim(),
], validate, async (req, res, next) => {
  try {
    const tenantId = req.targetTenantId || req.user.tenantId;
    
    // Check tenant product limit
    const tenant = await Tenant.findById(tenantId);
    if (tenant.hasExceededLimit('products')) {
      return res.status(403).json({
        success: false,
        message: 'Product limit reached. Please upgrade your plan.',
        limit: tenant.limits.products,
        usage: tenant.usage.products,
      });
    }

    // Check SKU uniqueness within tenant
    const existingSku = await Product.findOne({ tenantId, sku: req.body.sku });
    if (existingSku) {
      return res.status(409).json({
        success: false,
        message: 'SKU already exists in this store.',
      });
    }

    const slug = generateSlug(req.body.name);
    const existingSlug = await Product.findOne({ tenantId, slug });
    
    const product = await Product.create({
      tenantId,
      name: req.body.name,
      slug: existingSlug ? `${slug}-${Date.now()}` : slug,
      description: req.body.description,
      shortDescription: req.body.shortDescription,
      sku: req.body.sku,
      price: req.body.price,
      compareAtPrice: req.body.compareAtPrice,
      cost: req.body.cost,
      currency: req.body.currency || tenant.settings.currency,
      inventory: req.body.inventory || { quantity: 0, trackInventory: true },
      images: req.body.images || [],
      categories: req.body.categories || [],
      tags: req.body.tags || [],
      status: req.body.status || 'draft',
      type: req.body.type || 'physical',
      variants: req.body.variants || [],
      seo: req.body.seo || {},
      metadata: req.body.metadata || {},
    });

    // Update tenant usage
    await tenant.incrementUsage('products');

    await ActivityLog.create({
      userId: req.user.id,
      tenantId,
      action: 'product_created',
      entity: { type: 'product', id: product._id.toString(), name: product.name },
      details: { sku: product.sku, price: product.price },
    });

    res.status(201).json({
      success: true,
      message: 'Product created successfully.',
      data: { product },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /api/products/:id
 * @desc    Update product
 * @access  Private (Vendor, Store Admin, Super Admin)
 */
router.put('/:id', authenticate, authorize(ROLES.VENDOR, ROLES.STORE_ADMIN, ROLES.SUPER_ADMIN), tenantIsolation(), [
  body('name').optional().trim().notEmpty(),
  body('price').optional().isFloat({ min: 0 }),
  body('status').optional().isIn(['draft', 'active', 'archived', 'out_of_stock']),
], validate, async (req, res, next) => {
  try {
    const tenantId = req.targetTenantId || req.user.tenantId;
    const query = { _id: req.params.id, tenantId };

    const updates = {};
    const allowedFields = [
      'name', 'description', 'shortDescription', 'price', 'compareAtPrice',
      'cost', 'currency', 'inventory', 'images', 'categories', 'tags',
      'status', 'type', 'variants', 'seo', 'metadata'
    ];
    
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    if (updates.name) {
      updates.slug = generateSlug(updates.name);
    }

    const product = await Product.findOneAndUpdate(
      query,
      updates,
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    await ActivityLog.create({
      userId: req.user.id,
      tenantId,
      action: 'product_updated',
      entity: { type: 'product', id: product._id.toString(), name: product.name },
      details: updates,
    });

    res.json({
      success: true,
      message: 'Product updated successfully.',
      data: { product },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   DELETE /api/products/:id
 * @desc    Delete product (archive)
 * @access  Private (Vendor, Store Admin, Super Admin)
 */
router.delete('/:id', authenticate, authorize(ROLES.VENDOR, ROLES.STORE_ADMIN, ROLES.SUPER_ADMIN), tenantIsolation(), async (req, res, next) => {
  try {
    const tenantId = req.targetTenantId || req.user.tenantId;
    const query = { _id: req.params.id, tenantId };

    const product = await Product.findOneAndUpdate(
      query,
      { status: 'archived' },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    await ActivityLog.create({
      userId: req.user.id,
      tenantId,
      action: 'product_deleted',
      entity: { type: 'product', id: product._id.toString(), name: product.name },
    });

    res.json({
      success: true,
      message: 'Product archived successfully.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/products/:id/duplicate
 * @desc    Duplicate product
 * @access  Private (Vendor, Store Admin, Super Admin)
 */
router.post('/:id/duplicate', authenticate, authorize(ROLES.VENDOR, ROLES.STORE_ADMIN, ROLES.SUPER_ADMIN), tenantIsolation(), async (req, res, next) => {
  try {
    const tenantId = req.targetTenantId || req.user.tenantId;
    const original = await Product.findOne({ _id: req.params.id, tenantId });

    if (!original) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    // Check limit
    const tenant = await Tenant.findById(tenantId);
    if (tenant.hasExceededLimit('products')) {
      return res.status(403).json({
        success: false,
        message: 'Product limit reached.',
      });
    }

    const duplicate = await Product.create({
      ...original.toObject(),
      _id: undefined,
      name: `${original.name} (Copy)`,
      slug: `${original.slug}-copy-${Date.now()}`,
      sku: `${original.sku}-COPY`,
      status: 'draft',
      createdAt: undefined,
      updatedAt: undefined,
    });

    await tenant.incrementUsage('products');

    res.status(201).json({
      success: true,
      message: 'Product duplicated successfully.',
      data: { product: duplicate },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;