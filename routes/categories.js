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
    // Assume admin role check (simplified; adjust based on your auth schema)
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

// Validation middleware for categories
const categoryValidation = [
  body('name')
    .notEmpty().withMessage('Category name is required')
    .isString().withMessage('Category name must be a string')
    .trim()
    .isLength({ max: 255 }).withMessage('Category name must not exceed 255 characters'),
  body('description')
    .optional()
    .isString().withMessage('Description must be a string')
    .trim(),
];

// Validation middleware for subcategories
const subcategoryValidation = [
  body('name')
    .notEmpty().withMessage('Subcategory name is required')
    .isString().withMessage('Subcategory name must be a string')
    .trim()
    .isLength({ max: 255 }).withMessage('Subcategory name must not exceed 255 characters'),
  body('description')
    .optional()
    .isString().withMessage('Description must be a string')
    .trim(),
  body('category_id')
    .notEmpty().withMessage('Category ID is required')
    .isInt({ min: 1 }).withMessage('Category ID must be a positive integer'),
];

// ID parameter validation
const idValidation = [
  param('id')
    .isInt({ min: 1 }).withMessage('ID must be a positive integer'),
];

// Apply authentication to all routes
router.use(authenticateToken);

// Create a category
router.post('/', categoryValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { name, description } = req.body;

  try {
    const result = await pool.query(
      'INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING *',
      [name, description || null]
    );
    res.status(201).json({ message: 'Category created successfully', data: result.rows[0] });
  } catch (err) {
    console.error('Create category error:', err.message);
    if (err.code === '23505') { // Unique constraint violation
      return res.status(409).json({ message: 'Category name already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Read all categories
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY name');
    res.status(200).json({ data: result.rows });
  } catch (err) {
    console.error('Get categories error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Read a single category
router.get('/:id', idValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT c.*, 
              (SELECT COUNT(*) FROM subcategories s WHERE s.category_id = c.id) as subcategories_count 
       FROM categories c WHERE c.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.status(200).json({ data: result.rows[0] });
  } catch (err) {
    console.error('Get category error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update a category
router.put('/:id', [...idValidation, ...categoryValidation], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { id } = req.params;
  const { name, description } = req.body;

  try {
    const result = await pool.query(
      'UPDATE categories SET name = $1, description = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [name, description || null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.status(200).json({ message: 'Category updated successfully', data: result.rows[0] });
  } catch (err) {
    console.error('Update category error:', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Category name already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a category
router.delete('/:id', idValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM categories WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.status(200).json({ message: 'Category deleted successfully' });
  } catch (err) {
    console.error('Delete category error:', err.message);
    if (err.code === '23503') { // Foreign key constraint violation
      return res.status(400).json({ message: 'Cannot delete category with associated subcategories' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a subcategory
router.post('/subcategories', subcategoryValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { name, description, category_id } = req.body;

  try {
    // Verify category exists
    const categoryCheck = await pool.query('SELECT id FROM categories WHERE id = $1', [category_id]);
    if (categoryCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid category ID' });
    }

    const result = await pool.query(
      'INSERT INTO subcategories (name, description, category_id) VALUES ($1, $2, $3) RETURNING *',
      [name, description || null, category_id]
    );
    res.status(201).json({ message: 'Subcategory created successfully', data: result.rows[0] });
  } catch (err) {
    console.error('Create subcategory error:', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Subcategory name already exists in this category' });
    }
    if (err.code === '23503') {
      return res.status(400).json({ message: 'Invalid category ID' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Read all subcategories
router.get('/subcategories', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, c.name AS category_name 
       FROM subcategories s 
       JOIN categories c ON s.category_id = c.id 
       ORDER BY c.name, s.name`
    );
    res.status(200).json({ data: result.rows });
  } catch (err) {
    console.error('Get subcategories error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Read a single subcategory
router.get('/subcategories/:id', idValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT s.*, c.name AS category_name 
       FROM subcategories s 
       JOIN categories c ON s.category_id = c.id 
       WHERE s.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Subcategory not found' });
    }
    res.status(200).json({ data: result.rows[0] });
  } catch (err) {
    console.error('Get subcategory error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update a subcategory
router.put('/subcategories/:id', [...idValidation, ...subcategoryValidation], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { id } = req.params;
  const { name, description, category_id } = req.body;

  try {
    // Verify category exists
    const categoryCheck = await pool.query('SELECT id FROM categories WHERE id = $1', [category_id]);
    if (categoryCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid category ID' });
    }

    const result = await pool.query(
      'UPDATE subcategories SET name = $1, description = $2, category_id = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [name, description || null, category_id, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Subcategory not found' });
    }
    res.status(200).json({ message: 'Subcategory updated successfully', data: result.rows[0] });
  } catch (err) {
    console.error('Update subcategory error:', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Subcategory name already exists in this category' });
    }
    if (err.code === '23503') {
      return res.status(400).json({ message: 'Invalid category ID' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a subcategory
router.delete('/subcategories/:id', idValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM subcategories WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Subcategory not found' });
    }
    res.status(200).json({ message: 'Subcategory deleted successfully' });
  } catch (err) {
    console.error('Delete subcategory error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;