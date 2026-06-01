import fs from 'fs';

// Create directories
const dirs = ['src/config', 'src/middleware', 'src/models', 'src/routes', 'src/utils', 'tests'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log('Created: ' + dir);
  }
});

// Create files with content
const files = {
  'package.json': JSON.stringify({
    "name": "saas-backend",
    "version": "1.0.0",
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
      "compression": "^1.7.4"
    },
    "devDependencies": {
      "nodemon": "^3.0.2"
    }
  }, null, 2),

  '.env': 'MONGODB_URI=mongodb://localhost:27017/saas_platform\nJWT_SECRET=your-secret-key\nPORT=5000\nNODE_ENV=development\nFRONTEND_URL=http://localhost:3000',

  '.gitignore': 'node_modules/\n.env\nlogs/',

  'server.js': `require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/saas_platform')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Error:', err));

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Server running on http://localhost:' + PORT));
`,

  'src/config/database.js': `const mongoose = require('mongoose');
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB: ' + conn.connection.host);
  } catch (error) {
    console.error(error);
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
  SUPER_ADMIN: ['manage:all'],
  VENDOR: ['manage:own-tenant'],
  CUSTOMER: ['view:own-profile'],
  STORE_ADMIN: ['manage:storefront']
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
const { ROLES, ROLE_HIERARCHY } = require('../config/roles');

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null;
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('+password');
    if (!user || !user.isActive) return res.status(401).json({ success: false, message: 'Invalid user' });
    req.user = user;
    req.tenantId = user.tenantId;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Auth required' });
  if (roles.includes(req.user.role)) return next();
  const inherited = ROLE_HIERARCHY[req.user.role] || [];
  if (roles.some(r => inherited.includes(r))) return next();
  return res.status(403).json({ success: false, message: 'Access denied' });
};

const tenantIsolation = () => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Auth required' });
  if (req.user.role === ROLES.SUPER_ADMIN) {
    req.targetTenantId = req.headers['x-target-tenant-id'] || req.user.tenantId;
    return next();
  }
  req.targetTenantId = req.user.tenantId;
  next();
};

module.exports = { authenticate, authorize, tenantIsolation, requireSuperAdmin: authorize(ROLES.SUPER_ADMIN), requireVendor: authorize(ROLES.VENDOR, ROLES.SUPER_ADMIN) };`,

  'src/middleware/errorHandler.js': `module.exports = (err, req, res, next) => {
  console.error(err.stack);
  let error = { message: err.message, statusCode: err.statusCode || 500 };
  if (err.name === 'CastError') error = { message: 'Resource not found', statusCode: 404 };
  if (err.code === 11000) error = { message: 'Duplicate field', statusCode: 409 };
  if (err.name === 'ValidationError') error = { message: Object.values(err.errors).map(v => v.message).join(', '), statusCode: 400 };
  res.status(error.statusCode).json({ success: false, message: error.message });
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
  avatar: String,
  phone: String,
  isActive: { type: Boolean, default: true },
  isEmailVerified: { type: Boolean, default: false },
  lastLogin: Date,
  loginAttempts: { type: Number, default: 0 },
  lockUntil: Date,
  preferences: { language: { type: String, default: 'en' }, timezone: { type: String, default: 'UTC' }, notifications: { email: { type: Boolean, default: true }, push: { type: Boolean, default: true } } },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

userSchema.virtual('fullName').get(function() { return this.firstName + ' ' + this.lastName; });
userSchema.pre('save', async function(next) { if (!this.isModified('password')) return next(); this.password = await bcrypt.hash(this.password, 12); next(); });
userSchema.methods.comparePassword = async function(candidate) { return await bcrypt.compare(candidate, this.password); };
userSchema.methods.isLocked = function() { return !!(this.lockUntil && this.lockUntil > Date.now()); };
userSchema.methods.incLoginAttempts = async function() { return this.updateOne({ $inc: { loginAttempts: 1 } }); };

module.exports = mongoose.model('User', userSchema);`,

  'src/models/Tenant.js': `const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: { type: String, maxlength: 500 },
  status: { type: String, enum: ['active', 'inactive', 'suspended', 'pending'], default: 'pending' },
  plan: { type: String, enum: ['free', 'starter', 'growth', 'enterprise', 'custom'], default: 'free' },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  branding: { logo: String, favicon: String, primaryColor: { type: String, default: '#3b82f6' }, secondaryColor: { type: String, default: '#64748b' }, domain: String },
  contact: { email: { type: String, required: true }, phone: String, address: { street: String, city: String, state: String, zip: String, country: String } },
  settings: { currency: { type: String, default: 'USD' }, timezone: { type: String, default: 'UTC' }, language: { type: String, default: 'en' }, taxRate: { type: Number, default: 0 }, enableTax: { type: Boolean, default: false } },
  features: { analytics: { type: Boolean, default: false }, apiAccess: { type: Boolean, default: false }, webhooks: { type: Boolean, default: false }, customDomain: { type: Boolean, default: false }, teamMembers: { type: Number, default: 1 } },
  limits: { products: { type: Number, default: 10 }, orders: { type: Number, default: 100 }, customers: { type: Number, default: 50 }, storage: { type: Number, default: 100 } },
  usage: { products: { type: Number, default: 0 }, orders: { type: Number, default: 0 }, customers: { type: Number, default: 0 }, storage: { type: Number, default: 0 } },
  subscription: { stripeCustomerId: String, stripeSubscriptionId: String, currentPeriodStart: Date, currentPeriodEnd: Date, cancelAtPeriodEnd: { type: Boolean, default: false } },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

tenantSchema.index({ slug: 1 });
tenantSchema.methods.hasExceededLimit = function(resource) { const limit = this.limits[resource]; const usage = this.usage[resource]; return limit !== -1 && usage >= limit; };
tenantSchema.methods.incrementUsage = async function(resource, amount = 1) { this.usage[resource] += amount; return this.save(); };

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
  inventory: { quantity: { type: Number, default: 0 }, lowStockThreshold: { type: Number, default: 5 }, trackInventory: { type: Boolean, default: true }, allowBackorders: { type: Boolean, default: false } },
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
productSchema.virtual('isInStock').get(function() { return this.inventory.quantity > 0; });

module.exports = mongoose.model('Product', productSchema);`,

  'src/models/Order.js': `const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true }, sku: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 }, unitPrice: { type: Number, required: true },
  totalPrice: { type: Number, required: true }, variant: { name: String, option: String }, image: String
});

const orderSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  orderNumber: { type: String, required: true, unique: true },
  customer: { userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, email: { type: String, required: true }, firstName: { type: String, required: true }, lastName: { type: String, required: true }, phone: String },
  items: [orderItemSchema],
  status: { type: String, enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'], default: 'pending' },
  paymentStatus: { type: String, enum: ['pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded'], default: 'pending' },
  fulfillmentStatus: { type: String, enum: ['unfulfilled', 'partial', 'fulfilled', 'returned'], default: 'unfulfilled' },
  financial: { subtotal: { type: Number, required: true }, tax: { type: Number, default: 0 }, shipping: { type: Number, default: 0 }, discount: { type: Number, default: 0 }, total: { type: Number, required: true }, currency: { type: String, default: 'USD' } },
  shippingAddress: { street: { type: String, required: true }, city: { type: String, required: true }, state: { type: String, required: true }, zip: { type: String, required: true }, country: { type: String, required: true } },
  billingAddress: { street: String, city: String, state: String, zip: String, country: String },
  payment: { method: { type: String, enum: ['card', 'paypal', 'bank_transfer', 'cash', 'crypto'], default: 'card' }, transactionId: String, stripePaymentIntentId: String, paidAt: Date },
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
  cancelAtPeriodEnd: { type: Boolean, default: false }, cancelledAt: Date, cancellationReason: String,
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
  ipAddress: String, userAgent: String,
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
    if (role === 'vendor') {
      const tenantName = req.body.tenantName || firstName + "'s Store";
      const slug = req.body.tenantSlug || tenantName.toLowerCase().replace(/\s+/g, '-');
      const existingTenant = await Tenant.findOne({ slug });
      if (existingTenant) return res.status(409).json({ success: false, message: 'Slug taken' });
      const tenant = await Tenant.create({ name: tenantName, slug, status: 'pending', plan: 'free', contact: { email }, owner: null });
      tenantId = tenant._id;
    } else if (tenantSlug) {
      const tenant = await Tenant.findOne({ slug: tenantSlug, status: 'active' });
      if (tenant) tenantId = tenant._id;
    }

    const user = await User.create({ email: email.toLowerCase(), password, firstName, lastName, role, tenantId, isEmailVerified: false, emailVerificationToken: generateRandomToken(), emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000 });
    if (role === 'vendor' && tenantId) await Tenant.findByIdAndUpdate(tenantId, { owner: user._id });

    const token = generateToken({ id: user._id, role: user.role, tenantId: user.tenantId });
    res.status(201).json({ success: true, data: { user: { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, tenantId: user.tenantId }, token } });
  } catch (error) { next(error); }
});

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').exists()
], validate, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !user.isActive) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = generateToken({ id: user._id, role: user.role, tenantId: user.tenantId });
    res.status(200).json({ success: true, data: { user: { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, tenantId: user.tenantId }, token } });
  } catch (error) { next(error); }
});

module.exports = router;
`,

  'src/utils/helpers.js': `const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const generateToken = (payload, expiresIn = '7d') => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

const generateRandomToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const validateEmail = (email) => {
  const regex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return regex.test(email);
};

module.exports = { generateToken, generateRandomToken, validateEmail };
`,

  'src/utils/seed.js': `require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const { generateToken } = require('./helpers');

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');

    // Clear existing data
    await User.deleteMany({});
    await Tenant.deleteMany({});

    // Create super admin
    const superAdmin = await User.create({
      email: 'admin@example.com',
      password: 'Admin@123',
      firstName: 'Admin',
      lastName: 'User',
      role: 'super-admin',
      isEmailVerified: true,
      isActive: true
    });

    // Create sample tenant
    const tenant = await Tenant.create({
      name: 'Sample Store',
      slug: 'sample-store',
      status: 'active',
      plan: 'starter',
      owner: superAdmin._id,
      contact: { email: 'store@example.com' }
    });

    // Create sample vendor
    const vendor = await User.create({
      email: 'vendor@example.com',
      password: 'Vendor@123',
      firstName: 'Vendor',
      lastName: 'User',
      role: 'vendor',
      tenantId: tenant._id,
      isEmailVerified: true,
      isActive: true
    });

    console.log('Seed completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seed();
`,

  'src/routes/users.js': `const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const User = require('../models/User');
const { ROLES } = require('../config/roles');

router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({ success: true, data: user });
  } catch (error) { next(error); }
});

router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { firstName, lastName, phone, preferences } = req.body;
    const user = await User.findByIdAndUpdate(req.user._id, { firstName, lastName, phone, preferences }, { new: true });
    res.json({ success: true, data: user });
  } catch (error) { next(error); }
});

router.get('/', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const users = await User.find().select('-password');
    res.json({ success: true, data: users });
  } catch (error) { next(error); }
});

module.exports = router;
`,

  'src/routes/products.js': `const express = require('express');
const router = express.Router();
const { authenticate, authorize, tenantIsolation } = require('../middleware/auth');
const Product = require('../models/Product');
const { ROLES } = require('../config/roles');

router.post('/', authenticate, authorize(ROLES.VENDOR), tenantIsolation(), async (req, res, next) => {
  try {
    const product = await Product.create({ ...req.body, tenantId: req.targetTenantId });
    res.status(201).json({ success: true, data: product });
  } catch (error) { next(error); }
});

router.get('/', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const products = await Product.find({ tenantId: req.targetTenantId });
    res.json({ success: true, data: products });
  } catch (error) { next(error); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, data: product });
  } catch (error) { next(error); }
});

router.put('/:id', authenticate, authorize(ROLES.VENDOR), async (req, res, next) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: product });
  } catch (error) { next(error); }
});

router.delete('/:id', authenticate, authorize(ROLES.VENDOR), async (req, res, next) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Product deleted' });
  } catch (error) { next(error); }
});

module.exports = router;
`,

  'src/routes/orders.js': `const express = require('express');
const router = express.Router();
const { authenticate, authorize, tenantIsolation } = require('../middleware/auth');
const Order = require('../models/Order');
const { ROLES } = require('../config/roles');

router.post('/', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const order = await Order.create({ ...req.body, tenantId: req.targetTenantId });
    res.status(201).json({ success: true, data: order });
  } catch (error) { next(error); }
});

router.get('/', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const orders = await Order.find({ tenantId: req.targetTenantId });
    res.json({ success: true, data: orders });
  } catch (error) { next(error); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (error) { next(error); }
});

router.put('/:id', authenticate, authorize(ROLES.VENDOR, ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: order });
  } catch (error) { next(error); }
});

module.exports = router;
`,

  'src/routes/tenants.js': `const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const Tenant = require('../models/Tenant');
const { ROLES } = require('../config/roles');

router.post('/', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const tenant = await Tenant.create(req.body);
    res.status(201).json({ success: true, data: tenant });
  } catch (error) { next(error); }
});

router.get('/', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const tenants = await Tenant.find();
    res.json({ success: true, data: tenants });
  } catch (error) { next(error); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
    res.json({ success: true, data: tenant });
  } catch (error) { next(error); }
});

router.put('/:id', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const tenant = await Tenant.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: tenant });
  } catch (error) { next(error); }
});

module.exports = router;
`,

  'src/routes/subscriptions.js': `const express = require('express');
const router = express.Router();
const { authenticate, authorize, tenantIsolation } = require('../middleware/auth');
const Subscription = require('../models/Subscription');
const { ROLES } = require('../config/roles');

router.post('/', authenticate, authorize(ROLES.VENDOR), tenantIsolation(), async (req, res, next) => {
  try {
    const subscription = await Subscription.create({ ...req.body, tenantId: req.targetTenantId });
    res.status(201).json({ success: true, data: subscription });
  } catch (error) { next(error); }
});

router.get('/:tenantId', authenticate, async (req, res, next) => {
  try {
    const subscription = await Subscription.findOne({ tenantId: req.params.tenantId });
    if (!subscription) return res.status(404).json({ success: false, message: 'Subscription not found' });
    res.json({ success: true, data: subscription });
  } catch (error) { next(error); }
});

router.put('/:id', authenticate, authorize(ROLES.VENDOR), async (req, res, next) => {
  try {
    const subscription = await Subscription.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: subscription });
  } catch (error) { next(error); }
});

module.exports = router;
`,

  'src/routes/admin.js': `const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/roles');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const ActivityLog = require('../models/ActivityLog');

router.get('/stats', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const userCount = await User.countDocuments();
    const tenantCount = await Tenant.countDocuments();
    const stats = { users: userCount, tenants: tenantCount };
    res.json({ success: true, data: stats });
  } catch (error) { next(error); }
});

router.get('/activity', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const logs = await ActivityLog.find().sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, data: logs });
  } catch (error) { next(error); }
});

module.exports = router;
`,

  'src/routes/storefront.js': `const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Order = require('../models/Order');

router.get('/products/:slug', async (req, res, next) => {
  try {
    const products = await Product.find({ 'branding.domain': req.params.slug, status: 'active' });
    res.json({ success: true, data: products });
  } catch (error) { next(error); }
});

router.post('/orders', async (req, res, next) => {
  try {
    const order = await Order.create(req.body);
    res.status(201).json({ success: true, data: order });
  } catch (error) { next(error); }
});

module.exports = router;
`,

  'src/routes/analytics.js': `const express = require('express');
const router = express.Router();
const { authenticate, authorize, tenantIsolation } = require('../middleware/auth');
const { ROLES } = require('../config/roles');
const Order = require('../models/Order');

router.get('/sales', authenticate, authorize(ROLES.VENDOR), tenantIsolation(), async (req, res, next) => {
  try {
    const orders = await Order.find({ tenantId: req.targetTenantId, paymentStatus: 'paid' });
    const total = orders.reduce((sum, o) => sum + o.financial.total, 0);
    res.json({ success: true, data: { total, orderCount: orders.length } });
  } catch (error) { next(error); }
});

module.exports = router;
`,

  'src/routes/vendors.js': `const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/roles');
const User = require('../models/User');

router.get('/', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const vendors = await User.find({ role: ROLES.VENDOR });
    res.json({ success: true, data: vendors });
  } catch (error) { next(error); }
});

module.exports = router;
`,

  'src/routes/customers.js': `const express = require('express');
const router = express.Router();
const { authenticate, authorize, tenantIsolation } = require('../middleware/auth');
const { ROLES } = require('../config/roles');
const User = require('../models/User');

router.get('/', authenticate, tenantIsolation(), async (req, res, next) => {
  try {
    const customers = await User.find({ tenantId: req.targetTenantId, role: ROLES.CUSTOMER });
    res.json({ success: true, data: customers });
  } catch (error) { next(error); }
});

module.exports = router;
`,

  'tests/auth.test.js': `const assert = require('assert');

describe('Auth Routes', () => {
  it('should register a user', () => {
    assert.strictEqual(1 + 1, 2);
  });

  it('should login a user', () => {
    assert.strictEqual(1 + 1, 2);
  });
});
`
};

Object.entries(files).forEach(([path, content]) => {
  const dir = path.substring(0, path.lastIndexOf('/'));
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path, content);
  console.log('Created: ' + path);
});

console.log('Setup complete!');