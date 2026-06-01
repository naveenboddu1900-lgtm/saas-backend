const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  action: {
    type: String,
    required: true,
    enum: [
      'user_login', 'user_logout', 'user_created', 'user_updated', 'user_deleted',
      'tenant_created', 'tenant_updated', 'tenant_deleted', 'tenant_suspended',
      'product_created', 'product_updated', 'product_deleted',
      'order_created', 'order_updated', 'order_cancelled', 'order_refunded',
      'subscription_created', 'subscription_updated', 'subscription_cancelled',
      'settings_updated', 'billing_updated', 'api_key_generated',
      'webhook_triggered', 'email_sent', 'error_occurred',
    ],
  },
  entity: {
    type: { type: String, required: true },
    id: { type: String, required: true },
    name: { type: String, default: null },
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  ipAddress: { type: String, default: null },
  userAgent: { type: String, default: null },
  severity: {
    type: String,
    enum: ['info', 'warning', 'error', 'critical'],
    default: 'info',
  },
}, {
  timestamps: true,
});

activityLogSchema.index({ tenantId: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });
activityLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);