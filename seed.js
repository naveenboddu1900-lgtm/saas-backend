/**
 * Database seeder for development
 * Run: npm run seed
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { ROLES } = require('../config/roles');
const logger = require('./logger');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/saas_platform');
    logger.info('Connected to MongoDB for seeding');
  } catch (error) {
    logger.error('MongoDB connection failed:', error);
    process.exit(1);
  }
};

const clearData = async () => {
  await User.deleteMany({});
  await Tenant.deleteMany({});
  await Product.deleteMany({});
  await Order.deleteMany({});
  logger.info('Database cleared');
};

const seedData = async () => {
  await connectDB();
  await clearData();

  // 1. Create Super Admin
  const superAdmin = await User.create({
    email: 'admin@saasplatform.com',
    password: 'admin123456',
    firstName: 'Super',
    lastName: 'Admin',
    role: ROLES.SUPER_ADMIN,
    isEmailVerified: true,
  });
  logger.info('Super Admin created:', superAdmin.email);

  // 2. Create Vendor with Tenant
  const vendorUser = await User.create({
    email: 'vendor@example.com',
    password: 'vendor123456',
    firstName: 'John',
    lastName: 'Vendor',
    role: ROLES.VENDOR,
    isEmailVerified: true,
  });

  const vendorTenant = await Tenant.create({
    name: 'Acme Store',
    slug: 'acme-store',
    description: 'A demo vendor store',
    status: 'active',
    plan: 'growth',
    owner: vendorUser._id,
    contact: {
      email: 'vendor@example.com',
    },
    settings: {
      currency: 'USD',
      timezone: 'America/New_York',
    },
    features: {
      analytics: true,
      apiAccess: true,
      webhooks: true,
      customDomain: true,
      teamMembers: 5,
    },
  });

  // Update vendor with tenant
  vendorUser.tenantId = vendorTenant._id;
  await vendorUser.save();
  logger.info('Vendor created:', vendorUser.email);

  // 3. Create Customer
  const customer = await User.create({
    email: 'customer@example.com',
    password: 'customer123456',
    firstName: 'Jane',
    lastName: 'Customer',
    role: ROLES.CUSTOMER,
    tenantId: vendorTenant._id,
    isEmailVerified: true,
  });
  logger.info('Customer created:', customer.email);

  // 4. Create Storefront Admin
  const storeAdmin = await User.create({
    email: 'store@example.com',
    password: 'store123456',
    firstName: 'Store',
    lastName: 'Manager',
    role: ROLES.STORE_ADMIN,
    tenantId: vendorTenant._id,
    isEmailVerified: true,
  });
  logger.info('Store Admin created:', storeAdmin.email);

  // 5. Create Products
  const products = await Product.create([
    {
      tenantId: vendorTenant._id,
      name: 'Premium Widget',
      slug: 'premium-widget',
      description: 'Our best-selling premium widget with advanced features.',
      shortDescription: 'Best-selling premium widget',
      sku: 'PW-001',
      price: 29.99,
      compareAtPrice: 39.99,
      cost: 15.00,
      inventory: { quantity: 100, trackInventory: true },
      categories: ['widgets', 'premium'],
      tags: ['bestseller', 'premium'],
      status: 'active',
      images: [{ url: 'https://via.placeholder.com/300', isPrimary: true }],
    },
    {
      tenantId: vendorTenant._id,
      name: 'Basic Gadget',
      slug: 'basic-gadget',
      description: 'Essential gadget for everyday use.',
      shortDescription: 'Essential everyday gadget',
      sku: 'BG-001',
      price: 9.99,
      cost: 4.00,
      inventory: { quantity: 50, trackInventory: true },
      categories: ['gadgets', 'basic'],
      tags: ['essential'],
      status: 'active',
      images: [{ url: 'https://via.placeholder.com/300', isPrimary: true }],
    },
    {
      tenantId: vendorTenant._id,
      name: 'Pro Service Package',
      slug: 'pro-service',
      description: 'Professional service package with priority support.',
      shortDescription: 'Professional service package',
      sku: 'PS-001',
      price: 99.99,
      cost: 50.00,
      inventory: { quantity: -1, trackInventory: false },
      categories: ['services'],
      tags: ['pro', 'service'],
      status: 'active',
      type: 'service',
      images: [{ url: 'https://via.placeholder.com/300', isPrimary: true }],
    },
  ]);
  logger.info(`${products.length} products created`);

  // 6. Create Order
  const order = await Order.create({
    tenantId: vendorTenant._id,
    customer: customer._id,
    items: [
      {
        product: products[0]._id,
        quantity: 2,
        price: products[0].price,
      },
      {
        product: products[1]._id,
        quantity: 1,
        price: products[1].price,
      },
    ],
    subtotal: 2 * products[0].price + products[1].price,
    total: 2 * products[0].price + products[1].price,
    status: 'processing',
    paymentStatus: 'paid',
  });
  logger.info('Order created:', order._id);

  await mongoose.disconnect();
  process.exit(0);
};

seedData().catch((error) => {
  logger.error('Seeding failed:', error);
  mongoose.disconnect();
  process.exit(1);
});