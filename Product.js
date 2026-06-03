const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [200, 'Product name cannot exceed 200 characters'],
  },
  slug: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  description: {
    type: String,
    maxlength: [2000, 'Description cannot exceed 2000 characters'],
  },
  shortDescription: {
    type: String,
    maxlength: [300, 'Short description cannot exceed 300 characters'],
  },
  sku: {
    type: String,
    required: true,
    trim: true,
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative'],
  },
  compareAtPrice: {
    type: Number,
    min: [0, 'Compare price cannot be negative'],
    default: null,
  },
  cost: {
    type: Number,
    min: [0, 'Cost cannot be negative'],
    default: 0,
  },
  currency: {
    type: String,
    default: 'USD',
  },
  inventory: {
    quantity: { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: 5 },
    trackInventory: { type: Boolean, default: true },
    allowBackorders: { type: Boolean, default: false },
  },
  images: [{
    url: { type: String, required: true },
    alt: { type: String, default: '' },
    isPrimary: { type: Boolean, default: false },
  }],
  categories: [{
    type: String,
    trim: true,
  }],
  tags: [{
    type: String,
    trim: true,
  }],
  status: {
    type: String,
    enum: ['draft', 'active', 'archived', 'out_of_stock'],
    default: 'draft',
  },
  type: {
    type: String,
    enum: ['physical', 'digital', 'service', 'subscription'],
    default: 'physical',
  },
  variants: [{
    name: String,
    options: [{
      name: String,
      value: String,
      priceAdjustment: { type: Number, default: 0 },
      sku: String,
      quantity: { type: Number, default: 0 },
    }],
  }],
  seo: {
    title: { type: String, default: null },
    description: { type: String, default: null },
    keywords: [{ type: String }],
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

// Compound indexes for tenant isolation
productSchema.index({ tenantId: 1, status: 1 });
productSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
productSchema.index({ tenantId: 1, categories: 1 });
productSchema.index({ tenantId: 1, 'inventory.quantity': 1 });
productSchema.index({ tenantId: 1, createdAt: -1 });

// Text search index
productSchema.index(
  { name: 'text', description: 'text', tags: 'text' },
  { weights: { name: 10, tags: 5, description: 2 } }
);

// Virtual for isInStock
productSchema.virtual('isInStock').get(function() {
  return this.inventory.quantity > 0;
});

// Virtual for profit margin
productSchema.virtual('profitMargin').get(function() {
  if (!this.cost || this.cost === 0) return 100;
  return ((this.price - this.cost) / this.price * 100).toFixed(2);
});

module.exports = mongoose.model('Product', productSchema);