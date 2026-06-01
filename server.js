require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));

// Mock data (in-memory, no database needed)
const users = [];
const tenants = [];
const products = [];
const orders = [];
let nextId = 1;

// Helper: generate token
const generateToken = (user) => {
  return 'mock-jwt-token-' + user.id;
};

// ========== HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'API running (mock mode - no database)',
    timestamp: new Date().toISOString()
  });
});

// ========== AUTH ROUTES ==========

// Register
app.post('/api/auth/register', (req, res) => {
  const { email, password, firstName, lastName, role = 'customer' } = req.body;
  
  const existingUser = users.find(u => u.email === email);
  if (existingUser) {
    return res.status(409).json({ success: false, message: 'Email already exists' });
  }

  const user = {
    id: nextId++,
    email,
    firstName,
    lastName,
    role,
    tenantId: null,
    createdAt: new Date()
  };
  users.push(user);

  const token = generateToken(user);
  res.status(201).json({
    success: true,
    data: {
      user: { id: user.id, email, firstName, lastName, role },
      token
    }
  });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const token = generateToken(user);
  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.firstName + ' ' + user.lastName,
        role: user.role
      },
      token
    }
  });
});

// Get current user
app.get('/api/auth/me', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token' });
  }
  
  // Mock: return first user or demo user
  const user = users[0] || {
    id: 1,
    email: 'demo@example.com',
    firstName: 'Demo',
    lastName: 'User',
    role: 'super-admin'
  };
  
  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.firstName + ' ' + user.lastName,
        role: user.role
      }
    }
  });
});

// ========== ADMIN ROUTES ==========
app.get('/api/admin/dashboard', (req, res) => {
  res.json({
    success: true,
    data: {
      metrics: {
        totalUsers: users.length,
        totalTenants: tenants.length,
        totalProducts: products.length,
        totalOrders: orders.length,
        totalRevenue: 0
      }
    }
  });
});

// ========== VENDOR ROUTES ==========
app.get('/api/vendors/dashboard', (req, res) => {
  res.json({
    success: true,
    data: {
      metrics: {
        totalProducts: products.length,
        totalOrders: orders.length,
        totalCustomers: users.filter(u => u.role === 'customer').length,
        totalRevenue: 0
      },
      recentOrders: orders.slice(-5)
    }
  });
});

// ========== CUSTOMER ROUTES ==========
app.get('/api/customers/orders', (req, res) => {
  res.json({
    success: true,
    data: orders,
    pagination: { page: 1, limit: 10, total: orders.length }
  });
});

// ========== PRODUCT ROUTES ==========
app.get('/api/products', (req, res) => {
  res.json({
    success: true,
    data: products.length ? products : [
      { id: 1, name: 'Premium Widget', price: 29.99, status: 'active' },
      { id: 2, name: 'Basic Gadget', price: 9.99, status: 'active' }
    ],
    pagination: { page: 1, limit: 10, total: products.length || 2 }
  });
});

app.post('/api/products', (req, res) => {
  const product = {
    id: nextId++,
    ...req.body,
    createdAt: new Date()
  };
  products.push(product);
  res.status(201).json({ success: true, data: { product } });
});

// ========== ORDER ROUTES ==========
app.get('/api/orders', (req, res) => {
  res.json({
    success: true,
    data: orders,
    pagination: { page: 1, limit: 10, total: orders.length }
  });
});

app.post('/api/orders', (req, res) => {
  const order = {
    id: nextId++,
    orderNumber: 'ORD-' + Date.now(),
    ...req.body,
    status: 'pending',
    createdAt: new Date()
  };
  orders.push(order);
  res.status(201).json({ success: true, data: { order } });
});

// ========== STOREFRONT ROUTES ==========
app.get('/api/storefront/:slug', (req, res) => {
  res.json({
    success: true,
    data: {
      storefront: {
        name: 'Demo Store',
        slug: req.params.slug,
        description: 'A demo store'
      },
      products: [
        { id: 1, name: 'Premium Widget', price: 29.99 },
        { id: 2, name: 'Basic Gadget', price: 9.99 }
      ]
    }
  });
});

// ========== SUBSCRIPTION PLANS ==========
app.get('/api/subscriptions/plans', (req, res) => {
  res.json({
    success: true,
    data: {
      plans: [
        { id: 'free', name: 'Free', price: 0 },
        { id: 'starter', name: 'Starter', price: 29 },
        { id: 'growth', name: 'Growth', price: 99 }
      ]
    }
  });
});

// ========== ERROR HANDLERS ==========
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found: ' + req.originalUrl });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message });
});

// ========== START SERVER ==========
app.listen(PORT, () => {
  console.log('=================================');
  console.log('🚀 Server running on http://localhost:' + PORT);
  console.log('📊 Mock mode (no database needed)');
  console.log('=================================');
});