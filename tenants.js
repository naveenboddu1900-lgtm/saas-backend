const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const { authenticate, requireSuperAdmin, tenantIsolation } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { paginate } = require('../utils/helpers');
const { ROLES } = require('../config/roles');

/**
 * @route   GET /api/tenants
 * @desc    Get all tenants (Super Admin) or current tenant
 * @access  Private
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    // Super admin sees all tenants
    if (req.user.role === ROLES.SUPER_ADMIN) {
      const { page = 1, limit = 10, status, plan, search } = req.query;
      
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

      return res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    }

    // Other users see their tenant
    if (!req.user.tenantId) {
      return res.status(400).json({
        success: false,
        message: 'No tenant associated with this account.',
      });
    }

    const tenant = await Tenant.findById(req.user.tenantId);
    res.json({
      success: true,
      data: { tenant },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/tenants/:id
 * @desc    Get tenant by ID
 * @access  Private (Super Admin, Tenant Owner)
 */
router.get('/:id', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found.',
      });
    }

    res.json({
      success: true,
      data: { tenant },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /api/tenants/:id
 * @desc    Update tenant
 * @access  Private (Super Admin, Tenant Owner)
 */
router.put('/:id', authenticate, tenantIsolation(), [
  body('name').optional().trim().notEmpty(),
  body('description').optional().trim(),
  body('contact').optional().isObject(),
  body('settings').optional().isObject(),
  body('branding').optional().isObject(),
], validate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;

    const query = { _id: id };
    if (!isSuperAdmin) {
      query._id = req.user.tenantId;
    }

    const updates = {};
    const allowedFields = ['name', 'description', 'contact', 'settings', 'branding'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    // Only super admin can update plan, status, limits, features
    if (isSuperAdmin) {
      if (req.body.plan) updates.plan = req.body.plan;
      if (req.body.status) updates.status = req.body.status;
      if (req.body.limits) updates.limits = req.body.limits;
      if (req.body.features) updates.features = req.body.features;
    }

    const tenant = await Tenant.findOneAndUpdate(
      query,
      updates,
      { new: true, runValidators: true }
    );

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found.',
      });
    }

    await ActivityLog.create({
      userId: req.user.id,
      tenantId: tenant._id,
      action: 'tenant_updated',
      entity: { type: 'tenant', id: tenant._id.toString(), name: tenant.name },
      details: updates,
    });

    res.json({
      success: true,
      message: 'Tenant updated successfully.',
      data: { tenant },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/tenants/:id/approve
 * @desc    Approve pending tenant (Super Admin only)
 * @access  Private (Super Admin)
 */
router.post('/:id/approve', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const tenant = await Tenant.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { status: 'active' },
      { new: true }
    );

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found or already approved.',
      });
    }

    await ActivityLog.create({
      userId: req.user.id,
      tenantId: tenant._id,
      action: 'tenant_updated',
      entity: { type: 'tenant', id: tenant._id.toString(), name: tenant.name },
      details: { status: 'active', approvedBy: req.user.id },
    });

    res.json({
      success: true,
      message: 'Tenant approved successfully.',
      data: { tenant },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/tenants/:id/suspend
 * @desc    Suspend tenant (Super Admin only)
 * @access  Private (Super Admin)
 */
router.post('/:id/suspend', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { reason } = req.body;

    const tenant = await Tenant.findOneAndUpdate(
      { _id: req.params.id, status: { $ne: 'suspended' } },
      { status: 'suspended' },
      { new: true }
    );

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found or already suspended.',
      });
    }

    // Deactivate all users in tenant
    await User.updateMany(
      { tenantId: tenant._id },
      { isActive: false }
    );

    await ActivityLog.create({
      userId: req.user.id,
      tenantId: tenant._id,
      action: 'tenant_suspended',
      entity: { type: 'tenant', id: tenant._id.toString(), name: tenant.name },
      details: { reason, suspendedBy: req.user.id },
      severity: 'warning',
    });

    res.json({
      success: true,
      message: 'Tenant suspended successfully.',
      data: { tenant },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/tenants/:id/stats
 * @desc    Get tenant statistics
 * @access  Private (Tenant Owner, Super Admin)
 */
router.get('/:id/stats', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenant = await Tenant.findById(id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found.',
      });
    }

    // Get counts
    const [userCount, productCount, orderCount, customerCount] = await Promise.all([
      User.countDocuments({ tenantId: id }),
      require('../models/Product').countDocuments({ tenantId: id }),
      require('../models/Order').countDocuments({ tenantId: id }),
      User.countDocuments({ tenantId: id, role: ROLES.CUSTOMER }),
    ]);

    res.json({
      success: true,
      data: {
        tenant: {
          id: tenant._id,
          name: tenant.name,
          slug: tenant.slug,
          plan: tenant.plan,
          status: tenant.status,
        },
        stats: {
          users: userCount,
          products: productCount,
          orders: orderCount,
          customers: customerCount,
          usage: tenant.usage,
          limits: tenant.limits,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;