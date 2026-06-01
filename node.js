const fs = require('fs');
const path = require('path');

const files = {
  'package.json': JSON.stringify({
    "name": "saas-platform-backend",
    "version": "1.0.0",
    "description": "Multi-tenant SaaS Platform Backend",
    "main": "server.js",
    "scripts": {
      "start": "node server.js",
      "dev": "nodemon server.js",
      "seed": "node src/utils/seed.js"
    },
    "dependencies": {
      "express": "^4.18.2",
      "mongoose": "^8.0.0",
      "cors": "^2.8.5",
      "helmet": "^7.1.0",
      "morgan": "^1.10.0",
      "dotenv": "^16.3.1",
      "bcryptjs": "^2.4.3",
      "jsonwebtoken": "^9.0.2",
      "express-validator": "^7.0.1",
      "express-rate-limit": "^7.1.5",
      "compression": "^1.7.4",
      "winston": "^3.11.0",
      "stripe": "^14.5.0",
      "nodemailer": "^6.9.7"
    },
    "devDependencies": {
      "nodemon": "^3.0.2"
    }
  }, null, 2),

  '.env': `MONGODB_URI=mongodb://localhost:27017/saas_platform
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000`,

  '.gitignore': `node_modules/
.env
logs/
*.log`,

  'server.js': `require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const connectDB = require('./src/config/database');

const app = express();
const PORT = process.env.PORT || 5000;

connectDB();

app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'API running', timestamp: new Date().toISOString() });
});

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/tenants', require('./src/routes/tenants'));
app.use('/api/vendors', require('./src/routes/vendors'));
app.use('/api/customers', require('./src/routes/customers'));
app.use('/api/products', require('./src/routes/products'));
app.use('/api/orders', require('./src/routes/orders'));
app.use('/api/subscriptions', require('./src/routes/subscriptions'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/storefront', require('./src/routes/storefront'));
app.use('/api/analytics', require('./src/routes/analytics'));

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message });
});

app.listen(PORT, () => console.log('Server running on http://localhost:' + PORT));

process.on('unhandledRejection', (err) => { console.error(err); process.exit(1); });`,

  'src/config/database.js': `const mongoose = require('mongoose');
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/saas_platform');
    console.log('MongoDB Connected: ' + conn.connection.host);
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  }
};
module.exports = connectDB;`,

  'src/config/roles.js': `const ROLES = {
  SUPER_ADMIN: 'super-admin',
  VENDOR: 'vendor',
  CUSTOMER: 'customer',
  STORE_ADMIN: 'storefront'
};

const PERMISSIONS = {
  SUPER_ADMIN: ['manage:all', 'manage:tenants', 'manage:users', 'view:analytics'],
  VENDOR: ['manage:own-tenant', 'manage:products', 'manage:orders', 'view:analytics'],
  CUSTOMER: ['view:own-profile', 'manage:own-orders', 'view:products'],
  STORE_ADMIN: ['manage:storefront', 'manage:store-products', 'view:store-analytics']
};

const ROLE_HIERARCHY = {
  [ROLES.SUPER_ADMIN]: [],
  [ROLES.VENDOR]: [ROLES.CUSTOMER],
  [ROLES.STORE_ADMIN]: [ROLES.CUSTOMER],
  [ROLES.CUSTOMER]: []
};

module.exports = { ROLES, PERMISSIONS, ROLE_HIERARCHY };`,

  'src/middleware/auth.js': `const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ROLES, PERMISSIONS, ROLE_HIERARCHY } = require('../config/roles');

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null;
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('+password');
    if (!user || !user.isActive) return res.status(401).json({ success: false, message: 'User not found or inactive' });
    
    req.user = user;
    req.tenantId = user.tenantId;
    req.userRole = user.role;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
  if (roles.includes(req.user.role)) return next();
  const inherited = ROLE_HIERARCHY[req.user.role] || [];
  if (roles.some(r => inherited.includes(r))) return next();
  return res.status(403).json({ success: false, message: 'Access denied' });
};

const tenantIsolation = (options = {}) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
  if (req.user.role === ROLES.SUPER_ADMIN) {
    req.targetTenantId = req.headers['x-target-tenant-id'] || req.user.tenantId;
    return next();
  }
  req.targetTenantId = req.user.tenantId;
  next();
};

module.exports = {
  authenticate,
  authorize,
  tenantIsolation,
  requireSuperAdmin: authorize(ROLES.SUPER_ADMIN),
  requireVendor: authorize(ROLES.VENDOR, ROLES.SUPER_ADMIN),
  requireCustomer: authorize(ROLES.CUSTOMER, ROLES.VENDOR, ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN),
  requireStoreAdmin: authorize(ROLES.STORE_ADMIN, ROLES.VENDOR, ROLES.SUPER_ADMIN)
};`,

  'src/middleware/errorHandler.js': `module.exports = (err, req, res, next) => {
  console.error(err.stack);
  let error = { ...err };
  error.message = err.message;
  
  if (err.name === 'CastError') error = { message: 'Resource not found: ' + err.value, statusCode: 404 };
  if (err.code === 11000) error = { message: 'Duplicate field value', statusCode: 409 };
  if (err.name === 'ValidationError') error = { message: Object.values(err.errors).map(v => v.message).join(', '), statusCode: 400 };
  if (err.name === 'JsonWebTokenError') error = { message: 'Invalid token', statusCode: 401 };
  
  res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server Error' });
};`,

  'src/middleware/validate.js': `const { validationResult } = require('express-validator');

module.exports = (validations) => async (req, res, next) => {
  await Promise.all(validations.map(v => v.run(req)));
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
};`,

  'src/models/User.js': `const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../config/roles');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 8, select: false },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  role: { type: String, enum: Object.values(ROLES), default: ROLES.CUSTOMER },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null },
  avatar: { type: String, default: null },
  phone: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  isEmailVerified: { type: Boolean, default: false },
  lastLogin: { type: Date, default: null },
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date, default: null },
  preferences: {
    language: { type: String, default: 'en' },
    timezone: { type: String, default: 'UTC' },
    notifications: { email: { type: Boolean, default: true }, push: { type: Boolean, default: true } }
  },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, toJSON: { virtuals: true } });

userSchema.virtual('fullName').get(function() {
  return this.firstName + ' ' + this.lastName;
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidate) {
  return await bcrypt.compare(candidate, this.password);
};

userSchema.methods.isLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

userSchema.methods.incLoginAttempts = async function() {
  return this.updateOne({ $inc: { loginAttempts: 1 } });
};

module.exports = mongoose.model('User', userSchema);`,

  'src/models/Tenant.js': `const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: { type: String, maxlength: 500 },
  status: { type: String, enum: ['active', 'inactive', 'suspended', 'pending'], default: 'pending' },
  plan: { type: String, enum: ['free', 'starter', 'growth', 'enterprise', 'custom'], default: 'free' },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  branding: {
    logo: String,
    favicon: String,
    primaryColor: { type: String, default: '#3b82f6' },
    secondaryColor: { type: String, default: '#64748b' },
    domain: String
  },
  contact: {
    email: { type: String, required: true },
    phone: String,
    address: { street: String, city: String, state: String, zip: String, country: String }
  },
  settings: {
    currency: { type: String, default: 'USD' },
    timezone: { type: String, default: 'UTC' },
    language: { type: String, default: 'en' },
    taxRate: { type: Number, default: 0 },
    enableTax: { type: Boolean, default: false }
  },
  features: {
    analytics: { type: Boolean, default: false },
    apiAccess: { type: Boolean, default: false },
    webhooks: { type: Boolean, default: false },
    customDomain: { type: Boolean, default: false },
    teamMembers: { type: Number, default: 1 }
  },
  limits: {
    products: { type: Number, default: 10 },
    orders: { type: Number, default: 100 },
    customers: { type: Number, default: 50 },
    storage: { type: Number, default: 100 }
  },
  usage: {
    products: { type: Number, default: 0 },
    orders: { type: Number, default: 0 },
    customers: { type: Number, default: 0 },
    storage: { type: Number, default: 0 }
  },
  subscription: {
    stripeCustomerId: String,
    stripeSubscriptionId: String,
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: { type: Boolean, default: false }
  },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

tenantSchema.index({ slug: 1 });
tenantSchema.index({ status: 1 });
tenantSchema.index({ plan: 1 });

tenantSchema.methods.hasExceededLimit = function(resource) {
  const limit = this.limits[resource];
  const usage = this.usage[resource];
  return limit !== -1 && usage >= limit;
};

tenantSchema.methods.incrementUsage = async function(resource, amount = 1) {
  this.usage[resource] += amount;
  return this.save();
};

module.exports = mongoose.model('Tenant', tenantSchema);`,

  'src/models/Product.js': `const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  slug: { type: String, required: true, lowercase: true, trim: true },
  description: { type: String, maxlength: 2000 },
  shortDescription: { type: String, maxlength: 300 },
  sku: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  compareAtPrice: { type: Number, min: 0, default: null },
  cost: { type: Number, min: 0, default: 0 },
  currency: { type: String, default: 'USD' },
  inventory: {
    quantity: { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: 5 },
    trackInventory: { type: Boolean, default: true },
    allowBackorders: { type: Boolean, default: false }
  },
  images: [{ url: { type: String, required: true }, alt: { type: String, default: '' }, isPrimary: { type: Boolean, default: false } }],
  categories: [{ type: String, trim: true }],
  tags: [{ type: String, trim: true }],
  status: { type: String, enum: ['draft', 'active', 'archived', 'out_of_stock'], default: 'draft' },
  type: { type: String, enum: ['physical', 'digital', 'service', 'subscription'], default: 'physical' },
  variants: [{ name: String, options: [{ name: String, value: String, priceAdjustment: { type: Number, default: 0 }, sku: String, quantity: { type: Number, default: 0 } }] }],
  seo: { title: String, description: String, keywords: [{ type: String }] },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

productSchema.index({ tenantId: 1, status: 1 });
productSchema.index({ tenantId: 1, slug: 1 }, { unique: true });

productSchema.virtual('isInStock').get(function() {
  return this.inventory.quantity > 0;
});

module.exports = mongoose.model('Product', productSchema);`,

  'src/models/Order.js': `const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  sku: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true },
  totalPrice: { type: Number, required: true },
  variant: { name: String, option: String },
  image: String
});

const orderSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  orderNumber: { type: String, required: true, unique: true },
  customer: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    email: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phone: String
  },
  items: [orderItemSchema],
  status: { type: String, enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'], default: 'pending' },
  paymentStatus: { type: String, enum: ['pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded'], default: 'pending' },
  fulfillmentStatus: { type: String, enum: ['unfulfilled', 'partial', 'fulfilled', 'returned'], default: 'unfulfilled' },
  financial: {
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    total: { type: Number, required: true },
    currency: { type: String, default: 'USD' }
  },
  shippingAddress: {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zip: { type: String, required: true },
    country: { type: String, required: true }
  },
  billingAddress: {
    street: String,
    city: String,
    state: String,
    zip: String,
    country: String
  },
  payment: {
    method: { type: String, enum: ['card', 'paypal', 'bank_transfer', 'cash', 'crypto'], default: 'card' },
    transactionId: String,
    stripePaymentIntentId: String,
    paidAt: Date
  },
  notes: { customer: String, internal: String },
  timeline: [{ status: { type: String, required: true }, message: { type: String, required: true }, timestamp: { type: Date, default: Date.now }, userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

orderSchema.index({ tenantId: 1, orderNumber: 1 }, { unique: true });

orderSchema.pre('save', async function(next) {
  if (!this.orderNumber) {
    const count = await mongoose.model('Order').countDocuments({ tenantId: this.tenantId });
    this.orderNumber = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + String(count + 1).padStart(4, '0');
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);`,

  'src/models/Subscription.js': `const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  plan: { type: String, enum: ['free', 'starter', 'growth', 'enterprise', 'custom'], required: true },
  status: { type: String, enum: ['active', 'trialing', 'past_due', 'cancelled', 'paused', 'incomplete'], default: 'incomplete' },
  billingCycle: { type: String, enum: ['monthly', 'quarterly', 'yearly', 'custom'], default: 'monthly' },
  price: { amount: { type: Number, required: true }, currency: { type: String, default: 'USD' } },
  stripe: { customerId: String, subscriptionId: String, priceId: String, productId: String },
  currentPeriod: { start: Date, end: Date },
  trial: { isActive: { type: Boolean, default: false }, startDate: Date, endDate: Date, days: { type: Number, default: 14 } },
  cancelAtPeriodEnd: { type: Boolean, default: false },
  cancelledAt: Date,
  cancellationReason: String,
  invoices: [{ stripeInvoiceId: String, amount: Number, status: String, paidAt: Date, pdfUrl: String, createdAt: { type: Date, default: Date.now } }],
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);`,

  'src/models/ActivityLog.js': `const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  action: { type: String, required: true },
  entity: { type: { type: String, required: true }, id: { type: String, required: true }, name: String },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: String,
  userAgent: String,
  severity: { type: String, enum: ['info', 'warning', 'error', 'critical'], default: 'info' }
}, { timestamps: true });

module.exports = mongoose.model('ActivityLog', activityLogSchema);`,

  'src/routes/auth.js': `const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { generateToken, generateRandomToken } = require('../utils/helpers');

router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('firstName').trim().notEmpty(),
  body('lastName').trim().notEmpty(),
  body('role').optional().isIn(['customer', 'vendor']),
], validate, async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, role = 'customer', tenantSlug } = req.body;
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) return res.status(409).json({ success: false, message: 'Email already exists' });

    let tenantId = null;
    if (tenantSlug) {
      const tenant = await Tenant.findOne({ slug: tenantSlug });
      if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
      tenantId = tenant._id;
    }

    const user = new User({ email: email.toLowerCase(), password, firstName, lastName, role, tenantId });
    await user.save();
    const token = generateToken(user);
    res.status(201).json({ success: true, message: 'User registered successfully', token, user: { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role } });
  } catch (error) {
    next(error);
  }
});

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], validate, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !await user.comparePassword(password)) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    if (!user.isActive) return res.status(403).json({ success: false, message: 'Account is inactive' });
    
    user.lastLogin = new Date();
    user.loginAttempts = 0;
    await user.save();
    
    const token = generateToken(user);
    res.json({ success: true, message: 'Login successful', token, user: { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role } });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', authenticate, (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

router.post('/refresh-token', authenticate, (req, res) => {
  const token = generateToken(req.user);
  res.json({ success: true, message: 'Token refreshed', token });
});

module.exports = router;`,

  'src/utils/helpers.js': `const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const generateToken = (user) => {
  return jwt.sign({ id: user._id, email: user.email, role: user.role, tenantId: user.tenantId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const generateRandomToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

const formatCurrency = (amount, currency = 'USD') => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
};

const calculateDiscount = (originalPrice, discountedPrice) => {
  return ((originalPrice - discountedPrice) / originalPrice * 100).toFixed(2);
};

const validateEmail = (email) => {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
};

const slugify = (text) => {
  return text.toLowerCase().trim().replace(/\\s+/g, '-').replace(/[^\\w-]/g, '');
};

const isPaginationValid = (page, limit) => {
  return page > 0 && limit > 0 && limit <= 100;
};

const buildPaginationQuery = (page, limit) => {
  return { skip: (page - 1) * limit, limit };
};

module.exports = {
  generateToken,
  generateRandomToken,
  formatCurrency,
  calculateDiscount,
  validateEmail,
  slugify,
  isPaginationValid,
  buildPaginationQuery
};`,

  'src/routes/users.js': `const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const User = require('../models/User');
const { authenticate, authorize, tenantIsolation } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ROLES } = require('../config/roles');

router.get('/', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const { page = 1, limit = 10, role } = req.query;
    const query = { tenantId: req.targetTenantId };
    if (role) query.role = role;
    const skip = (page - 1) * limit;
    const users = await User.find(query).skip(skip).limit(parseInt(limit));
    const total = await User.countDocuments(query);
    res.json({ success: true, data: users, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticate, tenantIsolation(), [
  param('id').isMongoId()
], validate, async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, tenantId: req.targetTenantId });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authenticate, tenantIsolation(), [
  param('id').isMongoId(),
  body('firstName').optional().trim(),
  body('lastName').optional().trim(),
  body('phone').optional().trim(),
  body('preferences').optional().isObject()
], validate, async (req, res, next) => {
  try {
    const user = await User.findOneAndUpdate({ _id: req.params.id, tenantId: req.targetTenantId }, req.body, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, message: 'User updated successfully', data: user });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authenticate, authorize(ROLES.SUPER_ADMIN), [
  param('id').isMongoId()
], validate, async (req, res, next) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;`,

  'src/routes/products.js': `const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const Product = require('../models/Product');
const { authenticate, tenantIsolation } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status = 'active', search } = req.query;
    const filters = { status };
    if (search) filters.name = new RegExp(search, 'i');
    const skip = (page - 1) * limit;
    const products = await Product.find(filters).skip(skip).limit(parseInt(limit));
    const total = await Product.countDocuments(filters);
    res.json({ success: true, data: products, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', [param('id').isMongoId()], validate, async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, tenantIsolation(), [
  body('name').trim().notEmpty(),
  body('sku').trim().notEmpty(),
  body('price').isFloat({ min: 0 })
], validate, async (req, res, next) => {
  try {
    const product = new Product({ ...req.body, tenantId: req.targetTenantId });
    await product.save();
    res.status(201).json({ success: true, message: 'Product created', data: product });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authenticate, tenantIsolation(), [
  param('id').isMongoId(),
  body('name').optional().trim(),
  body('price').optional().isFloat({ min: 0 })
], validate, async (req, res, next) => {
  try {
    const product = await Product.findOneAndUpdate({ _id: req.params.id, tenantId: req.targetTenantId }, req.body, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, message: 'Product updated', data: product });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authenticate, tenantIsolation(), [
  param('id').isMongoId()
], validate, async (req, res, next) => {
  try {
    const product = await Product.findOneAndDelete({ _id: req.params.id, tenantId: req.targetTenantId });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;`,

  'src/routes/orders.js': `const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const Order = require('../models/Order');
const { authenticate, tenantIsolation } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.get('/', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = { tenantId: req.targetTenantId };
    if (status) query.status = status;
    const skip = (page - 1) * limit;
    const orders = await Order.find(query).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 });
    const total = await Order.countDocuments(query);
    res.json({ success: true, data: orders, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticate, tenantIsolation(), [param('id').isMongoId()], validate, async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.targetTenantId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, tenantIsolation(), [
  body('customer.email').isEmail(),
  body('items').isArray({ min: 1 }),
  body('financial.total').isFloat({ min: 0 })
], validate, async (req, res, next) => {
  try {
    const order = new Order({ ...req.body, tenantId: req.targetTenantId });
    await order.save();
    res.status(201).json({ success: true, message: 'Order created', data: order });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authenticate, tenantIsolation(), [
  param('id').isMongoId(),
  body('status').optional().isIn(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'])
], validate, async (req, res, next) => {
  try {
    const order = await Order.findOneAndUpdate({ _id: req.params.id, tenantId: req.targetTenantId }, req.body, { new: true, runValidators: true });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, message: 'Order updated', data: order });
  } catch (error) {
    next(error);
  }
});

module.exports = router;`,

  'src/routes/tenants.js': `const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const Tenant = require('../models/Tenant');
const { authenticate, authorize, tenantIsolation } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ROLES } = require('../config/roles');

router.get('/', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = {};
    if (status) query.status = status;
    const skip = (page - 1) * limit;
    const tenants = await Tenant.find(query).skip(skip).limit(parseInt(limit));
    const total = await Tenant.countDocuments(query);
    res.json({ success: true, data: tenants, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticate, tenantIsolation(), [param('id').isMongoId()], validate, async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
    res.json({ success: true, data: tenant });
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, authorize(ROLES.VENDOR, ROLES.SUPER_ADMIN), [
  body('name').trim().notEmpty(),
  body('slug').trim().notEmpty().toLowerCase(),
  body('contact.email').isEmail()
], validate, async (req, res, next) => {
  try {
    const tenant = new Tenant({ ...req.body, owner: req.user._id });
    await tenant.save();
    res.status(201).json({ success: true, message: 'Tenant created', data: tenant });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authenticate, tenantIsolation(), [
  param('id').isMongoId(),
  body('name').optional().trim(),
  body('status').optional().isIn(['active', 'inactive', 'suspended', 'pending'])
], validate, async (req, res, next) => {
  try {
    const tenant = await Tenant.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
    res.json({ success: true, message: 'Tenant updated', data: tenant });
  } catch (error) {
    next(error);
  }
});

module.exports = router;`,

  'src/routes/analytics.js': `const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const { authenticate, tenantIsolation } = require('../middleware/auth');

router.get('/overview', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const query = { tenantId: req.targetTenantId };
    if (startDate && endDate) query.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
    
    const totalOrders = await Order.countDocuments(query);
    const revenue = await Order.aggregate([{ $match: query }, { $group: { _id: null, total: { $sum: '\$financial.total' } } }]);
    const totalProducts = await Product.countDocuments({ tenantId: req.targetTenantId });
    
    res.json({ success: true, data: { totalOrders, revenue: revenue[0]?.total || 0, totalProducts } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;`,

  'src/routes/admin.js': `const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const { authenticate, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/roles');

router.get('/users', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const users = await User.find().select('-password');
    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
});

router.get('/tenants', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const tenants = await Tenant.find();
    res.json({ success: true, data: tenants });
  } catch (error) {
    next(error);
  }
});

router.post('/tenants/:id/status', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { status } = req.body;
    const tenant = await Tenant.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
    res.json({ success: true, message: 'Tenant status updated', data: tenant });
  } catch (error) {
    next(error);
  }
});

module.exports = router;`,

  'src/routes/storefront.js': `const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Order = require('../models/Order');

router.get('/products', async (req, res, next) => {
  try {
    const products = await Product.find({ status: 'active' });
    res.json({ success: true, data: products });
  } catch (error) {
    next(error);
  }
});

router.post('/orders', async (req, res, next) => {
  try {
    const order = new Order(req.body);
    await order.save();
    res.status(201).json({ success: true, message: 'Order placed', data: order });
  } catch (error) {
    next(error);
  }
});

module.exports = router;`,

  'src/routes/vendors.js': `const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.get('/', async (req, res, next) => {
  try {
    const vendors = await User.find({ role: 'vendor' });
    res.json({ success: true, data: vendors });
  } catch (error) {
    next(error);
  }
});

module.exports = router;`,

  'src/routes/customers.js': `const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.get('/', async (req, res, next) => {
  try {
    const customers = await User.find({ role: 'customer' });
    res.json({ success: true, data: customers });
  } catch (error) {
    next(error);
  }
});

module.exports = router;`,

  'src/routes/subscriptions.js': `const express = require('express');
const router = express.Router();
const Subscription = require('../models/Subscription');
const { authenticate, tenantIsolation } = require('../middleware/auth');

router.get('/', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const subscription = await Subscription.findOne({ tenantId: req.targetTenantId });
    res.json({ success: true, data: subscription });
  } catch (error) {
    next(error);
  }
});

module.exports = router;`
};

fs.mkdirSync('src/config', { recursive: true });
fs.mkdirSync('src/middleware', { recursive: true });
fs.mkdirSync('src/models', { recursive: true });
fs.mkdirSync('src/routes', { recursive: true });
fs.mkdirSync('src/utils', { recursive: true });

Object.entries(files).forEach(([file, content]) => {
  fs.writeFileSync(file, content, 'utf8');
  console.log('Created: ' + file);
});

console.log('✅ SaaS Platform Backend setup complete!');
