/**
 * Role-based access control configuration
 * Matches frontend roles: super-admin, vendor, customer, storefront
 */
const ROLES = {
  SUPER_ADMIN: 'super-admin',
  VENDOR: 'vendor',
  CUSTOMER: 'customer',
  STORE_ADMIN: 'storefront', // Tenant storefront admin
};

const PERMISSIONS = {
  // Super Admin permissions
  SUPER_ADMIN: [
    'manage:all',
    'manage:tenants',
    'manage:users',
    'manage:subscriptions',
    'manage:settings',
    'view:analytics',
    'view:logs',
  ],
  // Vendor permissions
  VENDOR: [
    'manage:own-tenant',
    'manage:products',
    'manage:orders',
    'manage:customers',
    'view:analytics',
    'manage:settings',
  ],
  // Customer permissions
  CUSTOMER: [
    'view:own-profile',
    'manage:own-orders',
    'view:products',
    'purchase:products',
  ],
  // Storefront admin permissions
  STORE_ADMIN: [
    'manage:storefront',
    'manage:store-products',
    'manage:store-orders',
    'view:store-analytics',
    'manage:store-settings',
  ],
};

// Role hierarchy for permission inheritance
const ROLE_HIERARCHY = {
  [ROLES.SUPER_ADMIN]: [],
  [ROLES.VENDOR]: [ROLES.CUSTOMER],
  [ROLES.STORE_ADMIN]: [ROLES.CUSTOMER],
  [ROLES.CUSTOMER]: [],
};

module.exports = {
  ROLES,
  PERMISSIONS,
  ROLE_HIERARCHY,
};