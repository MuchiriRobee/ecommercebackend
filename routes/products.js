const express = require('express');
const { body, param, validationResult } = require('express-validator');
const pool = require('../config/db');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Middleware to verify JWT (admin-only)
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
    if (decoded.userType !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Token verification error:', err.message);
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

// Validation middleware for products
const productValidation = [
  body('name')
    .notEmpty().withMessage('Product name is required')
    .isString().withMessage('Product name must be a string')
    .trim()
    .isLength({ max: 255 }).withMessage('Product name must not exceed 255 characters'),
  body('product_code')
    .notEmpty().withMessage('Product code is required')
    .isString().withMessage('Product code must be a string')
    .trim()
    .isLength({ max: 50 }).withMessage('Product code must not exceed 50 characters'),
  body('unit_of_measurement')
    .notEmpty().withMessage('Unit of measurement is required')
    .isString().withMessage('Unit of measurement must be a string')
    .trim()
    .isLength({ max: 50 }).withMessage('Unit of measurement must not exceed 50 characters'),
  body('pack_size')
    .notEmpty().withMessage('Pack size is required')
    .isString().withMessage('Pack size must be a string')
    .trim()
    .isLength({ max: 50 }).withMessage('Pack size must not exceed 50 characters'),
  body('vat_rate')
    .isFloat({ min: 0, max: 100 }).withMessage('VAT rate must be between 0 and 100')
    .toFloat(),
  body('category_id')
    .notEmpty().withMessage('Category ID is required')
    .isInt({ min: 1 }).withMessage('Category ID must be a positive integer'),
  body('subcategory_id')
    .notEmpty().withMessage('Subcategory ID is required')
    .isInt({ min: 1 }).withMessage('Subcategory ID must be a positive integer'),
  body('vendor1')
    .optional()
    .isString().withMessage('Vendor1 must be a string')
    .trim()
    .isLength({ max: 255 }).withMessage('Vendor1 must not exceed 255 characters'),
  body('vendor2')
    .optional()
    .isString().withMessage('Vendor2 must be a string')
    .trim()
    .isLength({ max: 255 }).withMessage('Vendor2 must not exceed 255 characters'),
  body('vendor_item_code')
    .optional()
    .isString().withMessage('Vendor item code must be a string')
    .trim()
    .isLength({ max: 50 }).withMessage('Vendor item code must not exceed 50 characters'),
  body('short_description')
    .optional()
    .isString().withMessage('Short description must be a string')
    .trim(),
  body('detailed_description')
    .optional()
    .isString().withMessage('Detailed description must be a string')
    .trim(),
  body('product_image')
    .optional()
    .isString().withMessage('Product image must be a string')
    .trim(),
  body('cashback_percentage')
    .isFloat({ min: 0, max: 100 }).withMessage('Cashback percentage must be between 0 and 100')
    .toFloat(),
];

// ID parameter validation
const idValidation = [
  param('id')
    .isInt({ min: 1 }).withMessage('ID must be a positive integer'),
];

// Apply authentication to all routes
router.use(authenticateToken);

// Create a product
router.post('/', productValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const {
    name, product_code, unit_of_measurement, pack_size, vat_rate,
    category_id, subcategory_id, vendor1, vendor2, vendor_item_code,
    short_description, detailed_description, product_image, cashback_percentage
  } = req.body;

  try {
    // Verify category exists
    const categoryCheck = await pool.query('SELECT id FROM categories WHERE id = $1', [category_id]);
    if (categoryCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid category ID' });
    }

    // Verify subcategory exists and belongs to category
    const subcategoryCheck = await pool.query(
      'SELECT id FROM subcategories WHERE id = $1 AND category_id = $2',
      [subcategory_id, category_id]
    );
    if (subcategoryCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid subcategory ID or subcategory does not belong to specified category' });
    }

    const result = await pool.query(
      `INSERT INTO products (
        name, product_code, unit_of_measurement, pack_size, vat_rate,
        category_id, subcategory_id, vendor1, vendor2, vendor_item_code,
        short_description, detailed_description, product_image, cashback_percentage
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        name, product_code, unit_of_measurement, pack_size, vat_rate,
        category_id, subcategory_id, vendor1 || null, vendor2 || null, vendor_item_code || null,
        short_description || null, detailed_description || null, product_image || null, cashback_percentage
      ]
    );
    res.status(201).json({ message: 'Product created successfully', data: result.rows[0] });
  } catch (err) {
    console.error('Create product error:', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Product code already exists' });
    }
    if (err.code === '23503') {
      return res.status(400).json({ message: 'Invalid category or subcategory ID' });
    }
    if (err.code === 'P0001') {
      return res.status(400).json({ message: err.message }); // Trigger error
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Read all products
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name AS category_name, s.name AS subcategory_name
       FROM products p
       JOIN categories c ON p.category_id = c.id
       JOIN subcategories s ON p.subcategory_id = s.id
       ORDER BY p.name`
    );
    res.status(200).json({ data: result.rows });
  } catch (err) {
    console.error('Get products error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Read a single product
router.get('/:id', idValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT p.*, c.name AS category_name, s.name AS subcategory_name
       FROM products p
       JOIN categories c ON p.category_id = c.id
       JOIN subcategories s ON p.subcategory_id = s.id
       WHERE p.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json({ data: result.rows[0] });
  } catch (err) {
    console.error('Get product error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update a product
router.put('/:id', [...idValidation, ...productValidation], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { id } = req.params;
  const {
    name, product_code, unit_of_measurement, pack_size, vat_rate,
    category_id, subcategory_id, vendor1, vendor2, vendor_item_code,
    short_description, detailed_description, product_image, cashback_percentage
  } = req.body;

  try {
    // Verify category exists
    const categoryCheck = await pool.query('SELECT id FROM categories WHERE id = $1', [category_id]);
    if (categoryCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid category ID' });
    }

    // Verify subcategory exists and belongs to category
    const subcategoryCheck = await pool.query(
      'SELECT id FROM subcategories WHERE id = $1 AND category_id = $2',
      [subcategory_id, category_id]
    );
    if (subcategoryCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid subcategory ID or subcategory does not belong to specified category' });
    }

    const result = await pool.query(
      `UPDATE products
       SET name = $1, product_code = $2, unit_of_measurement = $3, pack_size = $4,
           vat_rate = $5, category_id = $6, subcategory_id = $7, vendor1 = $8,
           vendor2 = $9, vendor_item_code = $10, short_description = $11,
           detailed_description = $12, product_image = $13, cashback_percentage = $14,
           updated_at = NOW()
       WHERE id = $15
       RETURNING *`,
      [
        name, product_code, unit_of_measurement, pack_size, vat_rate,
        category_id, subcategory_id, vendor1 || null, vendor2 || null, vendor_item_code || null,
        short_description || null, detailed_description || null, product_image || null, cashback_percentage,
        id
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json({ message: 'Product updated successfully', data: result.rows[0] });
  } catch (err) {
    console.error('Update product error:', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Product code already exists' });
    }
    if (err.code === '23503') {
      return res.status(400).json({ message: 'Invalid category or subcategory ID' });
    }
    if (err.code === 'P0001') {
      return res.status(400).json({ message: err.message }); // Trigger error
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a product
router.delete('/:id', idValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Delete product error:', err.message);
    if (err.code === '23503') {
      return res.status(400).json({ message: 'Cannot delete product due to existing dependencies (e.g., orders)' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;