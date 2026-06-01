const express = require('express');
const router = express.Router();
const Subscription = require('../models/Subscription');
const Tenant = require('../models/Tenant');
const { authenticate, requireSuperAdmin, tenantIsolation } = require('../middleware/auth');
const { createCustomer, createSubscription, cancelSubscription } = require('../utils/stripe');

/**
 * @route   GET /api/subscriptions/plans
 * @desc    Get available subscription plans
 * @access  Public
 */
router.get('/plans', async (req, res, next) => {
  try {
    const plans = [
      {
        id: 'free',
        name: 'Free',
        price: 0,
        description: 'Perfect for getting started',
        features: ['Up to 10 products', 'Up to 50 customers', 'Basic analytics', 'Email support'],
        limits: { products: 10, customers: 50, orders: 100, storage: 100 },
      },
      {
        id: 'starter',
        name: 'Starter',
        price: 29,
        billingCycle: 'monthly',
        description: 'For small businesses',
        features: ['Up to 100 products', 'Up to 500 customers', 'Advanced analytics', 'Priority support', 'Custom domain'],
        limits: { products: 100, customers: 500, orders: 1000, storage: 1000 },
      },
      {
        id: 'growth',
        name: 'Growth',
        price: 99,
        billingCycle: 'monthly',
        description: 'For growing businesses',
        features: ['Unlimited products', 'Unlimited customers', 'Full analytics', 'API access', 'Webhooks', 'Team members (5)'],
        limits: { products: -1, customers: -1, orders: -1, storage: 10000 },
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        price: 299,
        billingCycle: 'monthly',
        description: 'For large organizations',
        features: ['Everything in Growth', 'White-label', 'Dedicated support', 'Custom integrations', 'Unlimited team members', 'SLA'],
        limits: { products: -1, customers: -1, orders: -1, storage: -1 },
      },
    ];

    res.json({
      success: true,
      data: { plans },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/subscriptions
 * @desc    Get current subscription
 * @access  Private
 */
router.get('/', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const tenantId = req.targetTenantId || req.user.tenantId;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'No tenant associated with this account.',
      });
    }

    const subscription = await Subscription.findOne({ tenantId }).sort('-createdAt');
    const tenant = await Tenant.findById(tenantId).select('plan status subscription');

    res.json({
      success: true,
      data: {
        subscription,
        tenant: {
          plan: tenant.plan,
          status: tenant.status,
          stripeCustomerId: tenant.subscription?.stripeCustomerId,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/subscriptions
 * @desc    Create new subscription
 * @access  Private (Vendor)
 */
router.post('/', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const { plan, billingCycle = 'monthly' } = req.body;
    const tenantId = req.targetTenantId || req.user.tenantId;

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found.',
      });
    }

    // Create Stripe customer if not exists
    let stripeCustomerId = tenant.subscription?.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await createCustomer(tenant.contact.email, tenant.name, {
        tenantId: tenantId.toString(),
        plan,
      });
      stripeCustomerId = customer.id;
      tenant.subscription.stripeCustomerId = stripeCustomerId;
      await tenant.save();
    }

    // Map plan to Stripe price ID (you'd configure these in your Stripe dashboard)
    const priceIds = {
      starter: 'price_starter_monthly',
      growth: 'price_growth_monthly',
      enterprise: 'price_enterprise_monthly',
    };

    const stripeSubscription = await createSubscription(
      stripeCustomerId,
      priceIds[plan],
      plan === 'growth' ? 14 : 0 // 14-day trial for growth
    );

    const subscription = await Subscription.create({
      tenantId,
      plan,
      status: 'trialing',
      billingCycle,
      price: {
        amount: getPlanPrice(plan),
        currency: 'USD',
      },
      stripe: {
        customerId: stripeCustomerId,
        subscriptionId: stripeSubscription.id,
        priceId: priceIds[plan],
      },
      currentPeriod: {
        start: new Date(stripeSubscription.current_period_start * 1000),
        end: new Date(stripeSubscription.current_period_end * 1000),
      },
      trial: {
        isActive: stripeSubscription.trial_end !== null,
        startDate: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000) : null,
        endDate: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
      },
    });

    // Update tenant plan
    tenant.plan = plan;
    await tenant.save();

    res.status(201).json({
      success: true,
      message: 'Subscription created successfully.',
      data: { subscription, clientSecret: stripeSubscription.latest_invoice?.payment_intent?.client_secret },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/subscriptions/cancel
 * @desc    Cancel subscription
 * @access  Private (Vendor)
 */
router.post('/cancel', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const { reason } = req.body;
    const tenantId = req.targetTenantId || req.user.tenantId;

    const subscription = await Subscription.findOne({ tenantId, status: { $in: ['active', 'trialing'] } });
    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'No active subscription found.',
      });
    }

    // Cancel in Stripe
    if (subscription.stripe.subscriptionId) {
      await cancelSubscription(subscription.stripe.subscriptionId);
    }

    subscription.status = 'cancelled';
    subscription.cancelAtPeriodEnd = true;
    subscription.cancellationReason = reason;
    subscription.cancelledAt = new Date();
    await subscription.save();

    // Update tenant
    await Tenant.findByIdAndUpdate(tenantId, { plan: 'free' });

    res.json({
      success: true,
      message: 'Subscription cancelled successfully.',
      data: { subscription },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/subscriptions/invoices
 * @desc    Get subscription invoices
 * @access  Private (Vendor)
 */
router.get('/invoices', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const tenantId = req.targetTenantId || req.user.tenantId;
    const subscription = await Subscription.findOne({ tenantId }).select('invoices');

    res.json({
      success: true,
      data: { invoices: subscription?.invoices || [] },
    });
  } catch (error) {
    next(error);
  }
});

function getPlanPrice(plan) {
  const prices = { free: 0, starter: 29, growth: 99, enterprise: 299 };
  return prices[plan] || 0;
}

module.exports = router;