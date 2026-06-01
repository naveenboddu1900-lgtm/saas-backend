const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ROLES, PERMISSIONS, ROLE_HIERARCHY } = require('../config/roles');
const logger = require('../utils/logger');

/**
 * Verify JWT token and attach user to request
 */
const authenticate = async (req, res, next) => {
  try {
    let token;

    // Check for token in Authorization header
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // Check for token in cookies (if using cookie-based auth)
    else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find user
    const user = await User.findById(decoded.id).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found. Token may be invalid.',
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact support.',
      });
    }

    if (user.isLocked()) {
      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked due to too many failed login attempts.',
      });
    }

    // Attach user and tenant context to request
    req.user = user;
    req.tenantId = user.tenantId;
    req.userRole = user.role;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.',
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.',
      });
    }

    logger.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error.',
    });
  }
};

/**
 * Check if user has required role
 * @param {...string} roles - Allowed roles
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Check direct role match
    if (roles.includes(req.user.role)) {
      return next();
    }

    // Check role hierarchy (e.g., vendor inherits customer permissions)
    const inheritedRoles = ROLE_HIERARCHY[req.user.role] || [];
    const hasInheritedRole = roles.some(role => inheritedRoles.includes(role));

    if (hasInheritedRole) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Access denied. Insufficient permissions.',
      required: roles,
      current: req.user.role,
    });
  };
};

/**
 * Check if user has specific permission
 * @param {...string} permissions - Required permissions
 */
const requirePermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const userPermissions = PERMISSIONS[req.user.role.toUpperCase().replace('-', '_')] || [];
    const hasAllPermissions = permissions.every(p => 
      userPermissions.includes(p) || userPermissions.includes('manage:all')
    );

    if (!hasAllPermissions) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Missing required permissions.',
        required: permissions,
      });
    }

    next();
  };
};

/**
 * Optional authentication - attaches user if token exists, doesn't fail if missing
 */
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer')
      ? req.headers.authorization.split(' ')[1]
      : null;

    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (user && user.isActive) {
      req.user = user;
      req.tenantId = user.tenantId;
      req.userRole = user.role;
    }

    next();
  } catch (error) {
    // Silently fail for optional auth
    next();
  }
};

/**
 * Tenant isolation middleware - ensures users can only access their tenant's data
 * Must be used AFTER authenticate middleware
 */
const tenantIsolation = (options = {}) => {
  const { allowSuperAdmin = true, paramName = 'tenantId' } = options;

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // Super admin can access all tenants
    if (allowSuperAdmin && req.user.role === ROLES.SUPER_ADMIN) {
      // Allow super admin to specify tenant via header or param
      req.targetTenantId = req.headers['x-target-tenant-id'] || req.params[paramName] || req.user.tenantId;
      return next();
    }

    // For non-super-admin users, enforce their tenant
    const requestedTenantId = req.params[paramName] || req.body.tenantId || req.headers['x-tenant-id'];

    if (requestedTenantId && requestedTenantId !== req.user.tenantId?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Cannot access data from another tenant.',
      });
    }

    req.targetTenantId = req.user.tenantId;
    next();
  };
};

/**
 * Role-specific middleware shortcuts
 */
const requireSuperAdmin = authorize(ROLES.SUPER_ADMIN);
const requireVendor = authorize(ROLES.VENDOR, ROLES.SUPER_ADMIN);
const requireCustomer = authorize(ROLES.CUSTOMER, ROLES.VENDOR, ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN);
const requireStoreAdmin = authorize(ROLES.STORE_ADMIN, ROLES.VENDOR, ROLES.SUPER_ADMIN);

module.exports = {
  authenticate,
  authorize,
  requirePermission,
  optionalAuth,
  tenantIsolation,
  requireSuperAdmin,
  requireVendor,
  requireCustomer,
  requireStoreAdmin,
};