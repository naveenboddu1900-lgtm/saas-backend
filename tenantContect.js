/**
 * Tenant context middleware
 * Extracts tenant information from subdomain, header, or path
 * and attaches it to the request for downstream use
 */
const Tenant = require('../models/Tenant');
const logger = require('../utils/logger');

const resolveTenant = async (req, res, next) => {
  try {
    let tenantId = null;
    let tenantSlug = null;

    // 1. Check header (for API requests)
    if (req.headers['x-tenant-id']) {
      tenantId = req.headers['x-tenant-id'];
    }
    // 2. Check subdomain (for storefront requests)
    else if (req.headers.host) {
      const host = req.headers.host;
      const subdomain = host.split('.')[0];
      
      // Skip if it's www or main domain
      if (subdomain && !['www', 'localhost', 'api'].includes(subdomain)) {
        tenantSlug = subdomain;
      }
    }
    // 3. Check path parameter
    else if (req.params.tenantSlug) {
      tenantSlug = req.params.tenantSlug;
    }

    // Resolve tenant
    let tenant = null;
    if (tenantId) {
      tenant = await Tenant.findById(tenantId);
    } else if (tenantSlug) {
      tenant = await Tenant.findOne({ slug: tenantSlug, status: 'active' });
    }

    if (tenant) {
      req.tenantContext = {
        id: tenant._id,
        slug: tenant.slug,
        name: tenant.name,
        plan: tenant.plan,
        settings: tenant.settings,
        features: tenant.features,
        branding: tenant.branding,
      };
      req.tenantId = tenant._id;
    }

    next();
  } catch (error) {
    logger.error('Tenant context resolution error:', error);
    // Don't fail the request, just proceed without tenant context
    next();
  }
};

module.exports = { resolveTenant };