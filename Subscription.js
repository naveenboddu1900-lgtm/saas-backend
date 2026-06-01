const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  plan: {
    type: String,
    enum: ['free', 'starter', 'growth', 'enterprise', 'custom'],
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'trialing', 'past_due', 'cancelled', 'paused', 'incomplete'],
    default: 'incomplete',
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'quarterly', 'yearly', 'custom'],
    default: 'monthly',
  },
  price: {
    amount: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
  },
  stripe: {
    customerId: { type: String, default: null },
    subscriptionId: { type: String, default: null },
    priceId: { type: String, default: null },
    productId: { type: String, default: null },
  },
  currentPeriod: {
    start: { type: Date, default: null },
    end: { type: Date, default: null },
  },
  trial: {
    isActive: { type: Boolean, default: false },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    days: { type: Number, default: 14 },
  },
  cancelAtPeriodEnd: { type: Boolean, default: false },
  cancelledAt: { type: Date, default: null },
  cancellationReason: { type: String, default: null },
  invoices: [{
    stripeInvoiceId: String,
    amount: Number,
    status: String,
    paidAt: Date,
    pdfUrl: String,
    createdAt: { type: Date, default: Date.now },
  }],
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

subscriptionSchema.index({ tenantId: 1, status: 1 });
subscriptionSchema.index({ 'stripe.subscriptionId': 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);