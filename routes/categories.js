const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');

const router = express.Router();

// Validation middleware
const validateCategory = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Category name is required')
    .isLength({ max: 255 })
    .withMessage('Category name must be less than 255 characters'),
  body('description')
    .trim()
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters'),
];

const validateSubcategory = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Subcategory name is required')
    .isLength({ max: 255 })
    .withMessage('Subcategory name must be less than 255 characters'),
  body('description')
    .trim()
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters'),
  body('category_id')
    .isInt({ min: 1 })
    .withMessage('Valid category ID is required'),
];

// Error handling middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Get all categories with subcategories
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT c.*,
             COALESCE((
               SELECT json_agg(
                 json_build_object(
                   'id', s.id,
                   'name', s.name,
                   'description', s.description,
                   'category_id', s.category_id
                 )
               )
               FROM subcategories s
               WHERE s.category_id = c.id
             ), '[]') as subcategories
      FROM categories c
      ORDER BY c.name
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Get single category by ID
router.get('/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT c.*,
             COALESCE((
               SELECT json_agg(
                 json_build_object(
                   'id', s.id,
                   'name', s.name,
                   'description', s.description,
                   'category_id', s.category_id
                 )
               )
               FROM subcategories s
               WHERE s.category_id = c.id
             ), '[]') as subcategories
      FROM categories c
      WHERE c.id = $1
    `, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// Create category
router.post('/', validateCategory, handleValidationErrors, async (req, res, next) => {
  const { name, description } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING *',
      [name, description || null]
    );
    const category = result.rows[0];
    category.subcategories = [];
    res.status(201).json(category);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Category name already exists' });
    }
    next(error);
  }
});

// Update category
router.put('/:id', validateCategory, handleValidationErrors, async (req, res, next) => {
  const { id } = req.params;
  const { name, description } = req.body;
  try {
    const result = await pool.query(
      'UPDATE categories SET name = $1, description = $2 WHERE id = $3 RETURNING *',
      [name, description || null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }
    const category = result.rows[0];
    const subcategories = await pool.query(
      'SELECT id, name, description, category_id FROM subcategories WHERE category_id = $1',
      [id]
    );
    category.subcategories = subcategories.rows;
    res.json(category);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Category name already exists' });
    }
    next(error);
  }
});

// Delete category
router.delete('/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM categories WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// Create subcategory
router.post('/subcategories', validateSubcategory, handleValidationErrors, async (req, res, next) => {
  const { name, description, category_id } = req.body;
  try {
    const categoryCheck = await pool.query('SELECT 1 FROM categories WHERE id = $1', [category_id]);
    if (categoryCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Parent category does not exist' });
    }
    const result = await pool.query(
      'INSERT INTO subcategories (name, description, category_id) VALUES ($1, $2, $3) RETURNING *',
      [name, description || null, category_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Subcategory name already exists under this category' });
    }
    next(error);
  }
});

// Update subcategory
router.put('/subcategories/:id', validateSubcategory, handleValidationErrors, async (req, res, next) => {
  const { id } = req.params;
  const { name, description, category_id } = req.body;
  try {
    const categoryCheck = await pool.query('SELECT 1 FROM categories WHERE id = $1', [category_id]);
    if (categoryCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Parent category does not exist' });
    }
    const result = await pool.query(
      'UPDATE subcategories SET name = $1, description = $2, category_id = $3 WHERE id = $4 RETURNING *',
      [name, description || null, category_id, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Subcategory not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Subcategory name already exists under this category' });
    }
    next(error);
  }
});

// Delete subcategory
router.delete('/subcategories/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM subcategories WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Subcategory not found' });
    }
    res.json({ message: 'Subcategory deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;