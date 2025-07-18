const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const pool = require('../config/db');

const validateParentCategory = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Parent category name is required')
    .isLength({ max: 255 })
    .withMessage('Parent category name must be less than 255 characters'),
  body('parent_category_code')
    .trim()
    .notEmpty()
    .withMessage('Parent category code is required')
    .matches(/^[A-Z]\d{2}$/)
    .withMessage('Parent category code must be one uppercase letter followed by two digits (e.g., M01)')
];

const validateCategory = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Category name is required')
    .isLength({ max: 255 })
    .withMessage('Category name must be less than 255 characters'),
  body('parent_category_id')
    .isInt({ min: 1 })
    .withMessage('Valid parent category ID is required'),
  body('category_code')
    .optional()
    .trim()
    .matches(/^\d{2}$/)
    .withMessage('Category code must be exactly two digits (e.g., 01)')
];

const validateSubCategory = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Subcategory name is required')
    .isLength({ max: 255 })
    .withMessage('Subcategory name must be less than 255 characters'),
  body('category_id')
    .isInt({ min: 1 })
    .withMessage('Valid category ID is required'),
  body('subcategory_code')
    .optional()
    .trim()
    .matches(/^\d{2}$/)
    .withMessage('Subcategory code must be exactly two digits (e.g., 01)')
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Parent Categories: GET all
router.get('/parent', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT pc.*, 
             json_agg(
               json_build_object(
                 'id', c.id,
                 'name', c.name,
                 'category_code', c.category_code,
                 'subcategories', (
                   SELECT json_agg(
                     json_build_object(
                       'id', s.id,
                       'name', s.name,
                       'subcategory_code', COALESCE(s.subcategory_code, '01'),
                       'category_name', c.name
                     ) ORDER BY s.name
                   )
                   FROM subcategories s
                   WHERE s.category_id = c.id
                 )
               ) ORDER BY c.name
             ) as categories
      FROM parent_categories pc
      LEFT JOIN categories c ON pc.id = c.parent_category_id
      GROUP BY pc.id
      ORDER BY pc.name
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Parent Categories: GET by ID
router.get('/parent/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      `
      SELECT pc.*, 
             json_agg(
               json_build_object(
                 'id', c.id,
                 'name', c.name,
                 'category_code', c.category_code,
                 'subcategories', (
                   SELECT json_agg(
                     json_build_object(
                       'id', s.id,
                       'name', s.name,
                       'subcategory_code', COALESCE(s.subcategory_code, '01'),
                       'category_name', c.name
                     ) ORDER BY s.name
                   )
                   FROM subcategories s
                   WHERE s.category_id = c.id
                 )
               ) ORDER BY c.name
             ) as categories
      FROM parent_categories pc
      LEFT JOIN categories c ON pc.id = c.parent_category_id
      WHERE pc.id = $1
      GROUP BY pc.id
      `,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Parent category not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// Parent Categories: POST
router.post('/parent', validateParentCategory, handleValidationErrors, async (req, res, next) => {
  try {
    const { name, parent_category_code } = req.body;
    const existingCode = await pool.query(
      'SELECT 1 FROM parent_categories WHERE parent_category_code = $1',
      [parent_category_code]
    );
    if (existingCode.rows.length > 0) {
      return res.status(400).json({ message: 'Parent category code already exists' });
    }
    const result = await pool.query(
      'INSERT INTO parent_categories (name, parent_category_code, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING *',
      [name, parent_category_code]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Parent category name or code already exists' });
    }
    next(error);
  }
});

// Parent Categories: PUT
router.put('/parent/:id', validateParentCategory, handleValidationErrors, async (req, res, next) => {
  try {
    const { name, parent_category_code } = req.body;
    const existingCode = await pool.query(
      'SELECT 1 FROM parent_categories WHERE parent_category_code = $1 AND id != $2',
      [parent_category_code, req.params.id]
    );
    if (existingCode.rows.length > 0) {
      return res.status(400).json({ message: 'Parent category code already exists' });
    }
    const result = await pool.query(
      'UPDATE parent_categories SET name = $1, parent_category_code = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
      [name, parent_category_code, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Parent category not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Parent category name or code already exists' });
    }
    next(error);
  }
});

// Parent Categories: DELETE
router.delete('/parent/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Delete associated products
    const categoryIdsResult = await client.query(
      'SELECT id FROM categories WHERE parent_category_id = $1',
      [req.params.id]
    );
    const categoryIds = categoryIdsResult.rows.map(row => row.id);
    
    if (categoryIds.length > 0) {
      // Delete products associated with subcategories
      await client.query(
        'DELETE FROM products WHERE subcategory_id IN (SELECT id FROM subcategories WHERE category_id = ANY($1))',
        [categoryIds]
      );
      // Delete products associated with categories
      await client.query(
        'DELETE FROM products WHERE category_id = ANY($1)',
        [categoryIds]
      );
      // Delete subcategories
      await client.query(
        'DELETE FROM subcategories WHERE category_id = ANY($1)',
        [categoryIds]
      );
      // Delete categories
      await client.query(
        'DELETE FROM categories WHERE parent_category_id = $1',
        [req.params.id]
      );
    }
    // Delete products associated with parent category
    await client.query(
      'DELETE FROM products WHERE parent_cat_id = $1',
      [req.params.id]
    );
    // Delete parent category
    const result = await client.query(
      'DELETE FROM parent_categories WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Parent category not found' });
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Parent category and associated data deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

// Categories: GET all (hierarchical structure for NewItemForm)
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT pc.id, pc.name, pc.parent_category_code as category_code,
             json_agg(
               json_build_object(
                 'id', c.id,
                 'name', c.name,
                 'category_code', c.category_code,
                 'parent_category_id', c.parent_category_id,
                 'subcategories', (
                   SELECT json_agg(
                     json_build_object(
                       'id', s.id,
                       'name', s.name,
                       'subcategory_code', COALESCE(s.subcategory_code, '01'),
                       'category_name', c.name,
                       'products', (
                         SELECT json_agg(
                           json_build_object(
                             'id', p.id,
                             'product_name', p.product_name,
                             'product_code', p.product_code
                           ) ORDER BY p.product_name
                         )
                         FROM products p
                         WHERE p.subcategory_id = s.id
                       )
                     ) ORDER BY s.name
                   )
                   FROM subcategories s
                   WHERE s.category_id = c.id
                 )
               ) ORDER BY c.name
             ) as categories
      FROM parent_categories pc
      LEFT JOIN categories c ON pc.id = c.parent_category_id
      GROUP BY pc.id, pc.name, pc.parent_category_code
      ORDER BY pc.name
    `);
    const data = result.rows.map(row => ({
      ...row,
      categories: row.categories.filter(cat => cat.id !== null).map(cat => ({
        ...cat,
        subcategories: cat.subcategories ? cat.subcategories.map(sub => ({
          ...sub,
          products: sub.products || []
        })) : []
      }))
    }));
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Categories: GET by ID
router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      `
      SELECT c.*, 
             pc.name as parent_category_name,
             json_agg(
               json_build_object(
                 'id', s.id,
                 'name', s.name,
                 'subcategory_code', COALESCE(s.subcategory_code, '01'),
                 'category_name', c.name
               ) ORDER BY s.name
             ) as subcategories
      FROM categories c
      LEFT JOIN parent_categories pc ON c.parent_category_id = pc.id
      LEFT JOIN subcategories s ON c.id = s.category_id
      WHERE c.id = $1
      GROUP BY c.id, pc.name
      `,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// Categories: GET subcategories
router.get('/:categoryId/subcategories', async (req, res, next) => {
  try {
    const result = await pool.query(
      `
      SELECT s.id, s.name, COALESCE(s.subcategory_code, '01') as subcategory_code, c.name as category_name
      FROM subcategories s
      JOIN categories c ON s.category_id = c.id
      WHERE s.category_id = $1
      ORDER BY s.name
      `,
      [req.params.categoryId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Categories: POST
router.post('/', validateCategory, handleValidationErrors, async (req, res, next) => {
  try {
    const { name, parent_category_id, category_code } = req.body;
    const code = category_code || (await pool.query(
      'SELECT COALESCE(MAX(CAST(category_code AS INTEGER)) + 1, 1) as seq FROM categories WHERE parent_category_id = $1',
      [parent_category_id]
    )).rows[0].seq.toString().padStart(2, '0');
    const existingCode = await pool.query(
      'SELECT 1 FROM categories WHERE category_code = $1 AND parent_category_id = $2',
      [code, parent_category_id]
    );
    if (existingCode.rows.length > 0) {
      return res.status(400).json({ message: 'Category code already exists for this parent category' });
    }
    const result = await pool.query(
      'INSERT INTO categories (name, category_code, parent_category_id) VALUES ($1, $2, $3) RETURNING *',
      [name, code, parent_category_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Category name already exists' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ message: 'Parent category does not exist' });
    }
    next(error);
  }
});

// Categories: PUT
router.put('/:id', validateCategory, handleValidationErrors, async (req, res, next) => {
  try {
    const { name, parent_category_id, category_code } = req.body;
    const code = category_code || (await pool.query(
      'SELECT category_code FROM categories WHERE id = $1',
      [req.params.id]
    )).rows[0]?.category_code;
    if (category_code) {
      const existingCode = await pool.query(
        'SELECT 1 FROM categories WHERE category_code = $1 AND parent_category_id = $2 AND id != $3',
        [category_code, parent_category_id, req.params.id]
      );
      if (existingCode.rows.length > 0) {
        return res.status(400).json({ message: 'Category code already exists for this parent category' });
      }
    }
    const result = await pool.query(
      'UPDATE categories SET name = $1, category_code = $2, parent_category_id = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *',
      [name, code, parent_category_id, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Category name already exists' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ message: 'Parent category does not exist' });
    }
    next(error);
  }
});

// Categories: DELETE
router.delete('/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Delete products associated with subcategories
    await client.query(
      'DELETE FROM products WHERE subcategory_id IN (SELECT id FROM subcategories WHERE category_id = $1)',
      [req.params.id]
    );
    // Delete products associated with category
    await client.query(
      'DELETE FROM products WHERE category_id = $1',
      [req.params.id]
    );
    // Delete subcategories
    await client.query(
      'DELETE FROM subcategories WHERE category_id = $1',
      [req.params.id]
    );
    // Delete category
    const result = await client.query(
      'DELETE FROM categories WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Category not found' });
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Category and associated data deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

// Subcategories: POST
router.post('/subcategories', validateSubCategory, handleValidationErrors, async (req, res, next) => {
  try {
    const { name, category_id, subcategory_code } = req.body;
    const code = subcategory_code || (await pool.query(
      'SELECT COALESCE(MAX(CAST(subcategory_code AS INTEGER)) + 1, 1) as seq FROM subcategories WHERE category_id = $1',
      [category_id]
    )).rows[0].seq.toString().padStart(2, '0');
    const existingCode = await pool.query(
      'SELECT 1 FROM subcategories WHERE subcategory_code = $1 AND category_id = $2',
      [code, category_id]
    );
    if (existingCode.rows.length > 0) {
      return res.status(400).json({ message: 'Subcategory code already exists for this category' });
    }
    const result = await pool.query(
      `
      INSERT INTO subcategories (name, category_id, subcategory_code) 
      VALUES ($1, $2, $3) 
      RETURNING *
      `,
      [name, category_id, code]
    );
    // Fetch category_name separately
    const categoryResult = await pool.query(
      'SELECT name AS category_name FROM categories WHERE id = $1',
      [category_id]
    );
    const responseData = {
      ...result.rows[0],
      category_name: categoryResult.rows[0]?.category_name || null
    };
    res.status(201).json(responseData);
  } catch (error) {
    console.error('Subcategory POST error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Subcategory name already exists in this category' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ message: 'Category does not exist' });
    }
    next(error);
  }
});

// Subcategories: PUT
router.put('/subcategories/:id', validateSubCategory, handleValidationErrors, async (req, res, next) => {
  try {
    const { name, category_id, subcategory_code } = req.body;
    const code = subcategory_code || (await pool.query(
      'SELECT subcategory_code FROM subcategories WHERE id = $1',
      [req.params.id]
    )).rows[0]?.subcategory_code;
    if (subcategory_code) {
      const existingCode = await pool.query(
        'SELECT 1 FROM subcategories WHERE subcategory_code = $1 AND category_id = $2 AND id != $3',
        [subcategory_code, category_id, req.params.id]
      );
      if (existingCode.rows.length > 0) {
        return res.status(400).json({ message: 'Subcategory code already exists for this category' });
      }
    }
    const result = await pool.query(
      `
      UPDATE subcategories 
      SET name = $1, category_id = $2, subcategory_code = $3, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $4 
      RETURNING *
      `,
      [name, category_id, code, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Subcategory not found' });
    }
    // Fetch category_name separately
    const categoryResult = await pool.query(
      'SELECT name AS category_name FROM categories WHERE id = $1',
      [category_id]
    );
    const responseData = {
      ...result.rows[0],
      category_name: categoryResult.rows[0]?.category_name || null
    };
    res.json(responseData);
  } catch (error) {
    console.error('Subcategory PUT error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Subcategory name already exists in this category' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ message: 'Category does not exist' });
    }
    next(error);
  }
});

// Subcategories: DELETE
router.delete('/subcategories/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Delete associated products
    await client.query(
      'DELETE FROM products WHERE subcategory_id = $1',
      [req.params.id]
    );
    // Delete subcategory
    const result = await client.query(
      'DELETE FROM subcategories WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Subcategory not found' });
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Subcategory and associated products deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;