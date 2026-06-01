const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const logger = require('./logger');

const createCustomer = async (email, name, metadata = {}) => {
  try {
    const customer = await stripe.customers.create({
      email,
      name,
      metadata,
    });
    return customer;
  } catch (error) {
    logger.error('Stripe create customer error:', error);
    throw error;
  }
};

const createSubscription = async (customerId, priceId, trialDays = 0) => {
  try {
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: trialDays,
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });
    return subscription;
  } catch (error) {
    logger.error('Stripe create subscription error:', error);
    throw error;
  }
};

const cancelSubscription = async (subscriptionId) => {
  try {
    const subscription = await stripe.subscriptions.cancel(subscriptionId);
    return subscription;
  } catch (error) {
    logger.error('Stripe cancel subscription error:', error);
    throw error;
  }
};

const createPaymentIntent = async (amount, currency = 'usd', customerId = null) => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      customer: customerId,
      automatic_payment_methods: { enabled: true },
    });
    return paymentIntent;
  } catch (error) {
    logger.error('Stripe payment intent error:', error);
    throw error;
  }
};

const constructEvent = (payload, signature, secret) => {
  try {
    return stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    logger.error('Stripe webhook signature verification failed:', error.message);
    throw error;
  }
};

module.exports = {
  stripe,
  createCustomer,
  createSubscription,
  cancelSubscription,
  createPaymentIntent,
  constructEvent,
};