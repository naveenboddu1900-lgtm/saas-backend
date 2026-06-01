const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const ActivityLog = require('../models/ActivityLog');
const { authenticate, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { generateToken, generateRandomToken } = require('../utils/helpers');
const { sendEmail, emailTemplates } = require('../utils/email');
const logger = require('../utils/logger');

/**
 * @route   POST /api/auth/register
 * @desc    Register new user (customer or vendor)
 * @access  Public
 */
router.post('/register', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('role').optional().isIn(['customer', 'vendor']).withMessage('Invalid role'),
  body('tenantSlug').optional().trim(),
], validate, async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, role = 'customer', tenantSlug } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.',
      });
    }

    let tenantId = null;

    // If registering as vendor, create tenant
    if (role === 'vendor') {
      const tenantName = req.body.tenantName || `${firstName}'s Store`;
      const slug = req.body.tenantSlug || tenantName.toLowerCase().replace(/\s+/g, '-');

      const existingTenant = await Tenant.findOne({ slug });
      if (existingTenant) {
        return res.status(409).json({
          success: false,
          message: 'Store slug already taken. Please choose another.',
        });
      }

      const tenant = await Tenant.create({
        name: tenantName,
        slug,
        description: req.body.tenantDescription || '',
        status: 'pending',
        plan: 'free',
        contact: { email },
      });
      tenantId = tenant._id;
    }
    // If registering as customer with tenant slug, link to tenant
    else if (tenantSlug) {
      const tenant = await Tenant.findOne({ slug: tenantSlug, status: 'active' });
      if (tenant) {
        tenantId = tenant._id;
      }
    }

    // Create user
    const user = await User.create({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName,
      role,
      tenantId,
      isEmailVerified: false,
      emailVerificationToken: generateRandomToken(),
      emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    });

    // If vendor, update tenant owner
    if (role === 'vendor' && tenantId) {
      await Tenant.findByIdAndUpdate(tenantId, { owner: user._id });
    }

    // Log activity
    await ActivityLog.create({
      userId: user._id,
      tenantId,
      action: 'user_created',
      entity: { type: 'user', id: user._id.toString(), name: user.fullName },
      details: { role, tenantId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Send verification email
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${user.emailVerificationToken}`;
    await sendEmail({
      to: user.email,
      ...emailTemplates.emailVerification({ firstName, verificationUrl }),
    });

    // Generate token
    const token = generateToken({ id: user._id, role: user.role, tenantId: user.tenantId });

    res.status(201).json({
      success: true,
      message: 'Account created successfully. Please verify your email.',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenantId: user.tenantId,
          isEmailVerified: user.isEmailVerified,
        },
        token,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
], validate, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user with password
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    // Check if account is locked
    if (user.isLocked()) {
      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked. Please try again later or reset your password.',
        lockUntil: user.lockUntil,
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      await user.incLoginAttempts();
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact support.',
      });
    }

    // Reset login attempts
    if (user.loginAttempts > 0) {
      await user.updateOne({
        $set: { loginAttempts: 0 },
        $unset: { lockUntil: 1 },
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    // Log activity
    await ActivityLog.create({
      userId: user._id,
      tenantId: user.tenantId,
      action: 'user_login',
      entity: { type: 'user', id: user._id.toString(), name: user.fullName },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Generate token
    const token = generateToken({ id: user._id, role: user.role, tenantId: user.tenantId });

    // Get tenant info if applicable
    let tenant = null;
    if (user.tenantId) {
      tenant = await Tenant.findById(user.tenantId).select('name slug status plan branding settings features');
    }

    res.json({
      success: true,
      message: 'Login successful.',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName,
          role: user.role,
          tenantId: user.tenantId,
          isEmailVerified: user.isEmailVerified,
          avatar: user.avatar,
          preferences: user.preferences,
          lastLogin: user.lastLogin,
        },
        tenant,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/auth/me
 * @desc    Get current user
 * @access  Private
 */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    let tenant = null;
    if (user.tenantId) {
      tenant = await Tenant.findById(user.tenantId).select('name slug status plan branding settings features');
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName,
          role: user.role,
          tenantId: user.tenantId,
          isEmailVerified: user.isEmailVerified,
          avatar: user.avatar,
          phone: user.phone,
          preferences: user.preferences,
          lastLogin: user.lastLogin,
        },
        tenant,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh JWT token
 * @access  Private
 */
router.post('/refresh', authenticate, async (req, res, next) => {
  try {
    const token = generateToken({ id: req.user.id, role: req.user.role, tenantId: req.user.tenantId });
    res.json({
      success: true,
      data: { token },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (client-side token removal)
 * @access  Private
 */
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await ActivityLog.create({
      userId: req.user.id,
      tenantId: req.user.tenantId,
      action: 'user_logout',
      entity: { type: 'user', id: req.user.id.toString(), name: req.user.fullName },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Send password reset email
 * @access  Public
 */
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
], validate, async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Don't reveal if user exists
      return res.json({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset link.',
      });
    }

    // Generate reset token
    const resetToken = generateRandomToken();
    user.passwordResetToken = resetToken;
    user.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save({ validateBeforeSave: false });

    // Send email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    await sendEmail({
      to: user.email,
      ...emailTemplates.passwordReset({ firstName: user.firstName, resetUrl }),
    });

    res.json({
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password with token
 * @access  Public
 */
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Token is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], validate, async (req, res, next) => {
  try {
    const { token, password } = req.body;

    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token.',
      });
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully. Please login with your new password.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/auth/verify-email
 * @desc    Verify email address
 * @access  Public
 */
router.post('/verify-email', [
  body('token').notEmpty().withMessage('Token is required'),
], validate, async (req, res, next) => {
  try {
    const { token } = req.body;

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token.',
      });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Email verified successfully.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/auth/change-password
 * @desc    Change password (authenticated)
 * @access  Private
 */
router.post('/change-password', authenticate, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
], validate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id).select('+password');

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect.',
      });
    }

    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully.',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;