const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Tenant name is required'],
    trim: true,
    maxlength: [100, 'Tenant name cannot exceed 100 characters'],
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'],
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters'],
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'pending'],
    default: 'pending',
  },
  plan: {
    type: String,
    enum: ['free', 'starter', 'growth', 'enterprise', 'custom'],
    default: 'free',
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // Branding
  branding: {
    logo: { type: String, default: null },
    favicon: { type: String, default: null },
    primaryColor: { type: String, default: '#3b82f6' },
    secondaryColor: { type: String, default: '#64748b' },
    customCss: { type: String, default: null },
    domain: { type: String, default: null },
  },
  // Contact info
  contact: {
    email: { type: String, required: true },
    phone: { type: String, default: null },
    address: {
      street: String,
      city: String,
      state: String,
      zip: String,
      country: String,
    },
  },
  // Settings
  settings: {
    currency: { type: String, default: 'USD' },
    timezone: { type: String, default: 'UTC' },
    language: { type: String, default: 'en' },
    taxRate: { type: Number, default: 0 },
    enableTax: { type: Boolean, default: false },
    allowGuestCheckout: { type: Boolean, default: true },
    requireEmailVerification: { type: Boolean, default: false },
    maintenanceMode: { type: Boolean, default: false },
  },
  // Feature flags (plan-based)
  features: {
    analytics: { type: Boolean, default: false },
    apiAccess: { type: Boolean, default: false },
    webhooks: { type: Boolean, default: false },
    customDomain: { type: Boolean, default: false },
    whiteLabel: { type: Boolean, default: false },
    prioritySupport: { type: Boolean, default: false },
    advancedReports: { type: Boolean, default: false },
    teamMembers: { type: Number, default: 1 },
  },
  // Limits
  limits: {
    products: { type: Number, default: 10 },
    orders: { type: Number, default: 100 },
    customers: { type: Number, default: 50 },
    storage: { type: Number, default: 100 },
  },
  // Usage tracking
  usage: {
    products: { type: Number, default: 0 },
    orders: { type: Number, default: 0 },
    customers: { type: Number, default: 0 },
    storage: { type: Number, default: 0 },
  },
  // Subscription
  subscription: {
    stripeCustomerId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    cancelAtPeriodEnd: { type: Boolean, default: false },
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

// Indexes
tenantSchema.index({ slug: 1 });
tenantSchema.index({ status: 1 });
tenantSchema.index({ plan: 1 });
tenantSchema.index({ owner: 1 });
tenantSchema.index({ 'subscription.stripeCustomerId': 1 });

// Virtual for isActive
tenantSchema.virtual('isActive').get(function() {
  return this.status === 'active';
});

// Check if tenant has exceeded limits
tenantSchema.methods.hasExceededLimit = function(resource) {
  const limit = this.limits[resource];
  const usage = this.usage[resource];
  return limit !== -1 && usage >= limit;
};

// Increment usage
tenantSchema.methods.incrementUsage = async function(resource, amount = 1) {
  this.usage[resource] += amount;
  return this.save();
};

module.exports = mongoose.model('Tenant', tenantSchema);