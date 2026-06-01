const express = require('express');
const router = express.Router();
const Subscription = require('../models/Subscription');
const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const { constructEvent } = require('../utils/stripe');
const logger = require('../utils/logger');

/**
 * @route   POST /api/webhooks/stripe
 * @desc    Handle Stripe webhooks
 * @access  Public (Stripe only, verified by signature)
 */
router.post('/', async (req, res, next) => {
  try {
    const payload = req.body;
    const signature = req.headers['stripe-signature'];

    let event;
    try {
      event = constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      logger.error('Stripe webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    logger.info('Stripe webhook received:', event.type);

    switch (event.type) {
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        
        if (subscriptionId) {
          await Subscription.findOneAndUpdate(
            { 'stripe.subscriptionId': subscriptionId },
            {
              status: 'active',
              $push: {
                invoices: {
                  stripeInvoiceId: invoice.id,
                  amount: invoice.amount_paid / 100,
                  status: invoice.status,
                  paidAt: new Date(invoice.status_transitions?.paid_at * 1000 || Date.now()),
                  pdfUrl: invoice.invoice_pdf,
                },
              },
            }
          );
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        
        if (subscriptionId) {
          await Subscription.findOneAndUpdate(
            { 'stripe.subscriptionId': subscriptionId },
            { status: 'past_due' }
          );
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        
        await Subscription.findOneAndUpdate(
          { 'stripe.subscriptionId': subscription.id },
          {
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            currentPeriod: {
              start: new Date(subscription.current_period_start * 1000),
              end: new Date(subscription.current_period_end * 1000),
            },
          }
        );

        // Update tenant plan if subscription is active
        if (subscription.status === 'active') {
          const sub = await Subscription.findOne({ 'stripe.subscriptionId': subscription.id });
          if (sub) {
            await Tenant.findByIdAndUpdate(sub.tenantId, { plan: sub.plan });
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        
        await Subscription.findOneAndUpdate(
          { 'stripe.subscriptionId': subscription.id },
          { status: 'cancelled', cancelAtPeriodEnd: false }
        );

        const sub = await Subscription.findOne({ 'stripe.subscriptionId': subscription.id });
        if (sub) {
          await Tenant.findByIdAndUpdate(sub.tenantId, { plan: 'free' });
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        
        // Update order payment status if payment intent is linked to an order
        if (paymentIntent.metadata?.orderId) {
          await Order.findByIdAndUpdate(paymentIntent.metadata.orderId, {
            paymentStatus: 'paid',
            'payment.transactionId': paymentIntent.id,
            'payment.paidAt': new Date(),
          });
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        
        if (paymentIntent.metadata?.orderId) {
          await Order.findByIdAndUpdate(paymentIntent.metadata.orderId, {
            paymentStatus: 'failed',
          });
        }
        break;
      }

      default:
        logger.info(`Unhandled Stripe event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;