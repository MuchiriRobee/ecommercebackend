const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const pool = require('../config/db');
const router = express.Router();

// Configure multer for handling multipart/form-data
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Middleware to parse FormData and extract JSON data
const parseFormData = (req, res, next) => {
  if (req.is('multipart/form-data')) {
    if (req.body.data) {
      try {
        req.body = JSON.parse(req.body.data);
      } catch (err) {
        return res.status(400).json({ message: 'Invalid JSON data in form', error: err.message });
      }
    } else {
      req.body = {};
    }
  }
  next();
};

// Middleware to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  }
  next();
};

// Validation rules for a single product
const validateSingleProduct = [
  body('productName').trim().notEmpty().withMessage('Product name is required'),
  body('productCode').matches(/^[A-Z]\d{9}$/).withMessage('Product code must be1 letter followed by 9 digits (e.g., E010101001)'),
  body('parentCatId').toInt().isInt({ min: 1 }).withMessage('Valid parent category ID is required'),
  body('categoryId').toInt().isInt({ min: 1 }).withMessage('Valid category ID is required'),
  body('subcategoryId').toInt().isInt({ min: 1 }).withMessage('Valid subcategory ID is required'),
  body('uom').isIn(['PC', 'PKT', 'BOX', 'SET', 'KG', 'LITERS', 'METERS', 'REAMS', 'PACKS']).withMessage('Invalid UOM'),
  body('costPrice').toFloat().isFloat({ min: 0.01 }).withMessage('Cost price must be a positive number'),
  body('sellingPrice1').toFloat().isFloat({ min: 0.01 }).withMessage('Selling price 1 must be a positive number'),
  body('vat').toFloat().isFloat({ min: 0, max: 100 }).withMessage('VAT rate must be between 0 and 100'),
  body('cashbackRate').toFloat().isFloat({ min: 0, max: 100 }).withMessage('Cashback rate must be between 0 and 100'),
  body('saCashback1stPurchase').toFloat().isFloat({ min: 0, max: 100 }).withMessage('1st purchase cashback must be between 0 and 100'),
  body('saCashback2ndPurchase').toFloat().isFloat({ min: 0, max: 100 }).withMessage('2nd purchase cashback must be between 0 and 100'),
  body('saCashback3rdPurchase').toFloat().isFloat({ min: 0, max: 100 }).withMessage('3rd purchase cashback must be between 0 and 100'),
  body('saCashback4thPurchase').toFloat().isFloat({ min: 0, max: 100 }).withMessage('4th purchase cashback must be between 0 and 100'),
  body('stockUnits').toInt().isInt({ min: 0 }).default(0).withMessage('Stock units must be a non-negative integer'),
  body('qty1Min').toInt().isInt({ min: 1 }).withMessage('Quantity 1 min must be at least 1'),
  body('qty1Max').toInt().isInt({ min: 1 }).withMessage('Quantity 1 max must be at least 1'),
  body('reorderActive').toBoolean().isBoolean().default(false).withMessage('Reorder active must be a boolean'),
  body('packSize').optional().isLength({ max: 50 }).withMessage('Pack size must be less than 50 characters'),
  body('longerDescription').optional().isLength({ max: 2000 }).withMessage('Longer description must be less than 2000 characters'),
  body('productBarcode').optional().isLength({ max: 50 }).withMessage('Product barcode must be less than 50 characters'),
  body('etimsRefCode').optional().isLength({ max: 50 }).withMessage('eTIMS ref code must be less than 50 characters'),
  body('sellingPrice2').optional().toFloat().isFloat({ min: 0.01 }).withMessage('Selling price 2 must be a positive number'),
  body('sellingPrice3').optional().toFloat().isFloat({ min: 0.01 }).withMessage('Selling price 3 must be a positive number'),
  body('qty2Min').optional().toInt().isInt({ min: 1 }).withMessage('Quantity 2 min must be at least 1'),
  body('qty2Max').optional().toInt().isInt({ min: 1 }).withMessage('Quantity 2 max must be at least 1'),
  body('qty3Min').optional().toInt().isInt({ min: 1 }).withMessage('Quantity 3 min must be at least 1'),
  body('preferredVendor1').optional().toInt().isInt({ min: 1 }).withMessage('Valid supplier ID is required'),
  body('vendorItemCode').optional().isLength({ max: 50 }).withMessage('Vendor item code must be less than 50 characters'),
  body('reorderLevel').optional().toInt().isInt({ min: 0 }).default(0).withMessage('Reorder level must be a non-negative integer'),
  body('orderLevel').optional().toInt().isInt({ min: 0 }).default(0).withMessage('Order level must be a non-negative integer'),
  body('imageUrl').optional({ nullable: true }).isString().withMessage('Image URL must be a string'),
];

// Validation for code generation
const validateCodeGeneration = [
  body('parentCatId').toInt().isInt({ min: 1 }).withMessage('Valid parent category ID is required'),
  body('categoryId').toInt().isInt({ min: 1 }).withMessage('Valid category ID is required'),
  body('subcategoryId').toInt().isInt({ min: 1 }).withMessage('Valid subcategory ID is required'),
];

// GET route to generate product code
router.post('/generate-code', validateCodeGeneration, handleValidationErrors, async (req, res, next) => {
  try {
    const { parentCatId, categoryId, subcategoryId } = req.body;
    const client = await pool.connect();
    try {
      // Validate parent category
      const parentCategoryResult = await client.query(
        'SELECT parent_category_code FROM parent_categories WHERE id = $1',
        [parentCatId]
      );
      if (parentCategoryResult.rows.length === 0) {
        return res.status(400).json({ message: `Parent category ID ${parentCatId} does not exist` });
      }
      const parentCode = parentCategoryResult.rows[0].parent_category_code;

      // Validate category
      const categoryResult = await client.query(
        'SELECT category_code FROM categories WHERE id = $1 AND parent_category_id = $2',
        [categoryId, parentCatId]
      );
      if (categoryResult.rows.length === 0) {
        return res.status(400).json({ message: `Category ID ${categoryId} does not exist or does not belong to parent category ${parentCatId}` });
      }
      const categoryCode = categoryResult.rows[0].category_code;

      // Validate subcategory
      const subcategoryResult = await client.query(
        'SELECT subcategory_code FROM subcategories WHERE id = $1 AND category_id = $2',
        [subcategoryId, categoryId]
      );
      if (subcategoryResult.rows.length === 0) {
        return res.status(400).json({ message: `Subcategory ID ${subcategoryId} does not exist or does not belong to category ${categoryId}` });
      }
      const subcategoryCode = subcategoryResult.rows[0].subcategory_code;

      // Count existing products in the subcategory to determine sequence number
      const productCountResult = await client.query(
        'SELECT COUNT(*) AS count FROM products WHERE subcategory_id = $1',
        [subcategoryId]
      );
      const sequenceNumber = parseInt(productCountResult.rows[0].count) + 1;
      const sequenceCode = sequenceNumber.toString().padStart(3, '0');

      // Generate product code
      const productCode = `${parentCode}${categoryCode}${subcategoryCode}${sequenceCode}`;

      res.json({ productCode });
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// Validation for PATCH active status
const validateActiveStatus = [
  body('active').isBoolean().withMessage('Active status must be a boolean'),
];

// POST route to create a new product
router.post('/', upload.single('image'), parseFormData, validateSingleProduct, handleValidationErrors, async (req, res, next) => {
  try {
    const formData = req.body || {};
    console.log('Received formData:', formData); // Debug log
    if (!formData || Object.keys(formData).length === 0) {
      return res.status(400).json({ message: 'Request body is empty or invalid' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Validate parent category
      if (!formData.parentCatId) {
        throw new Error('Parent category ID is required');
      }
      const parentCategoryResult = await client.query('SELECT id, parent_category_code FROM parent_categories WHERE id = $1', [formData.parentCatId]);
      if (parentCategoryResult.rows.length === 0) {
        throw new Error(`Parent category ID ${formData.parentCatId} does not exist`);
      }

      // Validate category
      if (!formData.categoryId) {
        throw new Error('Category ID is required');
      }
      const categoryResult = await client.query(
        'SELECT id, category_code FROM categories WHERE id = $1 AND parent_category_id = $2',
        [formData.categoryId, formData.parentCatId]
      );
      if (categoryResult.rows.length === 0) {
        throw new Error(`Category ID ${formData.categoryId} does not exist or does not belong to parent category ${formData.parentCatId}`);
      }

      // Validate subcategory
      if (!formData.subcategoryId) {
        throw new Error('Subcategory ID is required');
      }
      const subcategoryResult = await client.query(
        'SELECT id, subcategory_code FROM subcategories WHERE id = $1 AND category_id = $2',
        [formData.subcategoryId, formData.categoryId]
      );
      if (subcategoryResult.rows.length === 0) {
        throw new Error(`Subcategory ID ${formData.subcategoryId} does not exist or does not belong to category ${formData.categoryId}`);
      }

      // Check for duplicate product code
      if (!formData.productCode) {
        throw new Error('Product code is required');
      }
      const codeCheck = await client.query('SELECT id FROM products WHERE product_code = $1', [formData.productCode]);
      if (codeCheck.rows.length > 0) {
        throw new Error(`Product code ${formData.productCode} already exists`);
      }

      // Validate supplier and vendorItemCode
      if (formData.preferredVendor1) {
        const supplierCheck = await client.query('SELECT id, code FROM suppliers WHERE id = $1', [formData.preferredVendor1]);
        if (supplierCheck.rows.length === 0) {
          throw new Error(`Invalid supplier ID ${formData.preferredVendor1}`);
        }
        if (formData.vendorItemCode && formData.vendorItemCode !== supplierCheck.rows[0].code) {
          throw new Error(`Vendor item code ${formData.vendorItemCode} does not match supplier code ${supplierCheck.rows[0].code}`);
        }
      }

      // Validate quantity ranges
      if (formData.qty2Max && formData.qty2Max <= formData.qty1Max) {
        throw new Error('Quantity 2 max must be greater than Quantity 1 max');
      }
      if (formData.qty3Min && formData.qty2Max && formData.qty3Min <= formData.qty2Max) {
        throw new Error('Quantity 3 min must be greater than Quantity 2 max');
      }

      // Handle image
      const imageUrl = req.file ? `/Uploads/${Date.now()}_${req.file.originalname}` : (formData.imageUrl || null);

      const result = await client.query(
        `
          INSERT INTO products (
          product_name, product_code, parent_cat_id, category_id, subcategory_id, uom, pack_size,
          cost_price, selling_price1, selling_price2, selling_price3, qty1_min, qty1_max, qty2_min, 
          qty2_max, qty3_min, vat, cashback_rate, preferred_vendor1, vendor_item_code, sa_cashback_1st, 
          sa_cashback_2nd, sa_cashback_3rd, sa_cashback_4th, active, stock_units, 
          reorder_level, order_level, product_barcode, etims_ref_code, longer_description, image_url
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32
        ) RETURNING id
        `,
        [
          formData.productName,
          formData.productCode,
          formData.parentCatId,
          formData.categoryId,
          formData.subcategoryId,
          formData.uom,
          formData.packSize || null,
          formData.costPrice,
          formData.sellingPrice1,
          formData.sellingPrice2 || null,
          formData.sellingPrice3 || null,
          formData.qty1Min,
          formData.qty1Max,
          formData.qty2Min || null,
          formData.qty2Max || null,
          formData.qty3Min || null,
          formData.vat,
          formData.cashbackRate,
          formData.preferredVendor1 || null,
          formData.vendorItemCode || null,
          formData.saCashback1stPurchase,
          formData.saCashback2ndPurchase,
          formData.saCashback3rdPurchase,
          formData.saCashback4thPurchase,
          formData.active || true,
          formData.stockUnits || 0,
          formData.reorderLevel || 0,
          formData.orderLevel || 0,
          formData.productBarcode || null,
          formData.etimsRefCode || null,
          formData.longerDescription || null,
          imageUrl
        ]
      );

      // Save image to disk if present
      if (req.file) {
        const fs = require('fs').promises;
        const path = require('path');
        const uploadDir = path.join(__dirname, '../Uploads');
        await fs.mkdir(uploadDir, { recursive: true });
        await fs.writeFile(path.join(uploadDir, path.basename(imageUrl)), req.file.buffer);
      }

      await client.query('COMMIT');
      res.status(201).json({ message: 'Product created', id: result.rows[0].id });
    } catch (err) {
      console.error('Database error:', err); // Debug log
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Failed to create product', error: err.message });
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// GET route to fetch all products
router.get('/', async (req, res, next) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          p.*,
          pc.parent_category_code,
          c.category_code,
          s.subcategory_code,
          sup.code AS supplier_code,
          sup.name AS supplier_name
        FROM products p
        LEFT JOIN parent_categories pc ON p.parent_cat_id = pc.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN subcategories s ON p.subcategory_id = s.id
        LEFT JOIN suppliers sup ON p.preferred_vendor1 = sup.id
        WHERE p.active = true
        ORDER BY p.id
      `);
      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// GET route to fetch a single product by ID
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          p.*,
          pc.parent_category_code,
          c.category_code,
          s.subcategory_code,
          sup.code AS supplier_code,
          sup.name AS supplier_name
        FROM products p
        LEFT JOIN parent_categories pc ON p.parent_cat_id = pc.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN subcategories s ON p.subcategory_id = s.id
        LEFT JOIN suppliers sup ON p.preferred_vendor1 = sup.id
        WHERE p.id = $1
      `, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Product not found' });
      }

      res.json(result.rows[0]);
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// GET route to fetch products by subcategory ID
router.get('/subcategory/:subcategoryId', async (req, res, next) => {
  try {
    const { subcategoryId } = req.params;
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          p.*,
          pc.parent_category_code,
          c.category_code,
          s.subcategory_code,
          sup.code AS supplier_code,
          sup.name AS supplier_name
        FROM products p
        LEFT JOIN parent_categories pc ON p.parent_cat_id = pc.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN subcategories s ON p.subcategory_id = s.id
        LEFT JOIN suppliers sup ON p.preferred_vendor1 = sup.id
        WHERE p.subcategory_id = $1 AND p.active = true
        ORDER BY p.id
      `, [subcategoryId]);

      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});
// PUT route to update a product
router.put('/:id', upload.single('image'), parseFormData, validateSingleProduct, (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Validation errors:', errors.array(), 'Request body:', req.body); // Debug log
    return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  }
  next();
}, async (req, res, next) => {
  try {
    console.log('PUT request body:', req.body, 'File:', req.file); // Debug log
    const { id } = req.params;
    const formData = req.body || {};
    if (!formData || Object.keys(formData).length === 0) {
      return res.status(400).json({ message: 'Request body is empty or invalid' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if product exists
      const productCheck = await client.query('SELECT id FROM products WHERE id = $1', [id]);
      if (productCheck.rows.length === 0) {
        throw new Error('Product not found');
      }

      // Validate parent category
      if (!formData.parentCatId) {
        throw new Error('Parent category ID is required');
      }
      const parentCategoryResult = await client.query('SELECT id, parent_category_code FROM parent_categories WHERE id = $1', [formData.parentCatId]);
      if (parentCategoryResult.rows.length === 0) {
        throw new Error(`Parent category ID ${formData.parentCatId} does not exist`);
      }

      // Validate category
      if (!formData.categoryId) {
        throw new Error('Category ID is required');
      }
      const categoryResult = await client.query(
        'SELECT id, category_code FROM categories WHERE id = $1 AND parent_category_id = $2',
        [formData.categoryId, formData.parentCatId]
      );
      if (categoryResult.rows.length === 0) {
        throw new Error(`Category ID ${formData.categoryId} does not exist or does not belong to parent category ${formData.parentCatId}`);
      }

      // Validate subcategory
      if (!formData.subcategoryId) {
        throw new Error('Subcategory ID is required');
      }
      const subcategoryResult = await client.query(
        'SELECT id, subcategory_code FROM subcategories WHERE id = $1 AND category_id = $2',
        [formData.subcategoryId, formData.categoryId]
      );
      if (subcategoryResult.rows.length === 0) {
        throw new Error(`Subcategory ID ${formData.subcategoryId} does not exist or does not belong to category ${formData.categoryId}`);
      }

      // Check for duplicate product code (excluding current product)
      if (!formData.productCode) {
        throw new Error('Product code is required');
      }
      const codeCheck = await client.query('SELECT id FROM products WHERE product_code = $1 AND id != $2', [formData.productCode, id]);
      if (codeCheck.rows.length > 0) {
        throw new Error(`Product code ${formData.productCode} already exists`);
      }

      // Validate supplier and vendorItemCode
      if (formData.preferredVendor1) {
        const supplierCheck = await client.query('SELECT id, code FROM suppliers WHERE id = $1', [formData.preferredVendor1]);
        if (supplierCheck.rows.length === 0) {
          throw new Error(`Invalid supplier ID ${formData.preferredVendor1}`);
        }
        if (formData.vendorItemCode && formData.vendorItemCode !== supplierCheck.rows[0].code) {
          throw new Error(`Vendor item code ${formData.vendorItemCode} does not match supplier code ${supplierCheck.rows[0].code}`);
        }
      }

      // Validate quantity ranges
      if (formData.qty1Max < formData.qty1Min) {
        throw new Error('Quantity 1 max must be greater than Quantity 1 min');
      }
      if (formData.qty2Min && formData.qty2Min <= formData.qty1Max) {
        throw new Error('Quantity 2 min must be greater than Quantity 1 max');
      }
      if (formData.qty2Max && formData.qty2Max < formData.qty2Min) {
        throw new Error('Quantity 2 max must be greater than Quantity 2 min');
      }
      if (formData.qty3Min && formData.qty2Max && formData.qty3Min <= formData.qty2Max) {
        throw new Error('Quantity 3 min must be greater than Quantity 2 max');
      }

      // Handle image
      const imageUrl = req.file ? `/Uploads/${Date.now()}_${req.file.originalname}` : (formData.imageUrl || null);

      const result = await client.query(
        `
        UPDATE products SET
          product_name = $1,
          product_code = $2,
          parent_cat_id = $3,
          category_id = $4,
          subcategory_id = $5,
          uom = $6,
          pack_size = $7,
          cost_price = $8,
          selling_price1 = $9,
          selling_price2 = $10,
          selling_price3 = $11,
          qty1_min = $12,
          qty1_max = $13,
          qty2_min = $14,
          qty2_max = $15,
          qty3_min = $16,
          vat = $17,
          cashback_rate = $18,
          preferred_vendor1 = $19,
          vendor_item_code = $20,
          sa_cashback_1st = $21,
          sa_cashback_2nd = $22,
          sa_cashback_3rd = $23,
          sa_cashback_4th = $24,
          active = $25,
          stock_units = $26,
          reorder_level = $27,
          order_level = $28,
          product_barcode = $29,
          etims_ref_code = $30,
          longer_description = $31,
          image_url = $32
        WHERE id = $33
        RETURNING id
        `,
        [
          formData.productName,
          formData.productCode,
          formData.parentCatId,
          formData.categoryId,
          formData.subcategoryId,
          formData.uom,
          formData.packSize || null,
          Number(formData.costPrice),
          Number(formData.sellingPrice1),
          formData.sellingPrice2 ? Number(formData.sellingPrice2) : null,
          formData.sellingPrice3 ? Number(formData.sellingPrice3) : null,
          formData.qty1Min,
          formData.qty1Max,
          formData.qty2Min || null,
          formData.qty2Max || null,
          formData.qty3Min || null,
          Number(formData.vat),
          Number(formData.cashbackRate),
          formData.preferredVendor1 || null,
          formData.vendorItemCode || null,
          Number(formData.saCashback1stPurchase),
          Number(formData.saCashback2ndPurchase),
          Number(formData.saCashback3rdPurchase),
          Number(formData.saCashback4thPurchase),
          formData.active || true,
          formData.stockUnits || 0,
          formData.reorderLevel || 0,
          formData.orderLevel || 0,
          formData.productBarcode || null,
          formData.etimsRefCode || null,
          formData.longerDescription || null,
          imageUrl,
          id
        ]
      );

      // Save image to disk if present
      if (req.file) {
        const fs = require('fs').promises;
        const path = require('path');
        const uploadDir = path.join(__dirname, '../Uploads');
        await fs.mkdir(uploadDir, { recursive: true });
        await fs.writeFile(path.join(uploadDir, path.basename(imageUrl)), req.file.buffer);
      }

      await client.query('COMMIT');
      res.json({ message: 'Product updated', id: result.rows[0].id });
    } catch (err) {
      console.error('Database error:', err); // Debug log
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Failed to update product', error: err.message });
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// PATCH route to update product active status
router.patch('/:id/active', validateActiveStatus, handleValidationErrors, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const productCheck = await client.query('SELECT id FROM products WHERE id = $1', [id]);
      if (productCheck.rows.length === 0) {
        throw new Error('Product not found');
      }

      await client.query('UPDATE products SET active = $1 WHERE id = $2', [active, id]);
      await client.query('COMMIT');
      res.json({ message: `Product ${active ? 'activated' : 'deactivated'}` });
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Failed to update product status', error: err.message });
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// POST route for bulk product creation
router.post('/bulk', async (req, res, next) => {
  try {
    const products = Array.isArray(req.body) ? req.body : [];
    if (products.length === 0) {
      return res.status(400).json({ message: 'No products provided for bulk import' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const errors = [];
      const insertedIds = [];

      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const productErrors = [];

        // Manual validation for required fields
        if (!product.parentCatId) productErrors.push({ path: 'parentCatId', msg: 'Parent category ID is required' });
        if (!product.categoryId) productErrors.push({ path: 'categoryId', msg: 'Category ID is required' });
        if (!product.subcategoryId) productErrors.push({ path: 'subcategoryId', msg: 'Subcategory ID is required' });
        if (!product.productName) productErrors.push({ path: 'productName', msg: 'Product name is required' });
        if (!product.productCode || !/^[A-Z]\d{9}$/.test(product.productCode)) {
          productErrors.push({ path: 'productCode', msg: 'Product code must be 1 letter followed by 9 digits' });
        }
        if (!product.uom || !['PC', 'PKT', 'BOX', 'SET', 'KG', 'LITERS', 'METERS', 'REAMS', 'PACKS'].includes(product.uom)) {
          productErrors.push({ path: 'uom', msg: 'Unit of measure must be one of PC, PKT, BOX, SET, KG, LITERS, METERS, REAMS, PACKS' });
        }
        if (!product.costPrice || isNaN(product.costPrice) || product.costPrice <= 0 || product.costPrice > 9999999999999.99) {
          productErrors.push({ path: 'costPrice', msg: 'Cost price must be between 0.01 and 9,999,999,999,999.99' });
        }
        if (!product.sellingPrice1 || isNaN(product.sellingPrice1) || product.sellingPrice1 <= 0 || product.sellingPrice1 > 9999999999999.99) {
          productErrors.push({ path: 'sellingPrice1', msg: 'Selling price 1 must be between 0.01 and 9,999,999,999,999.99' });
        }
        if (!product.qty1Min || isNaN(product.qty1Min) || product.qty1Min < 1) {
          productErrors.push({ path: 'qty1Min', msg: 'Quantity 1 min must be at least 1' });
        }
        if (!product.qty1Max || isNaN(product.qty1Max) || product.qty1Max < 1) {
          productErrors.push({ path: 'qty1Max', msg: 'Quantity 1 max must be at least 1' });
        }
        if (product.vat == null || isNaN(product.vat) || product.vat < 0 || product.vat > 100) {
          productErrors.push({ path: 'vat', msg: 'VAT must be between 0 and 100' });
        }
        if (product.cashbackRate == null || isNaN(product.cashbackRate) || product.cashbackRate < 0 || product.cashbackRate > 100) {
          productErrors.push({ path: 'cashbackRate', msg: 'Cashback rate must be between 0 and 100' });
        }
        if (product.saCashback1stPurchase == null || isNaN(product.saCashback1stPurchase) || product.saCashback1stPurchase < 0 || product.saCashback1stPurchase > 100) {
          productErrors.push({ path: 'saCashback1stPurchase', msg: '1st purchase cashback must be between 0 and 100' });
        }
        if (product.saCashback2ndPurchase == null || isNaN(product.saCashback2ndPurchase) || product.saCashback2ndPurchase < 0 || product.saCashback2ndPurchase > 100) {
          productErrors.push({ path: 'saCashback2ndPurchase', msg: '2nd purchase cashback must be between 0 and 100' });
        }
        if (product.saCashback3rdPurchase == null || isNaN(product.saCashback3rdPurchase) || product.saCashback3rdPurchase < 0 || product.saCashback3rdPurchase > 100) {
          productErrors.push({ path: 'saCashback3rdPurchase', msg: '3rd purchase cashback must be between 0 and 100' });
        }
        if (product.saCashback4thPurchase == null || isNaN(product.saCashback4thPurchase) || product.saCashback4thPurchase < 0 || product.saCashback4thPurchase > 100) {
          productErrors.push({ path: 'saCashback4thPurchase', msg: '4th purchase cashback must be between 0 and 100' });
        }
        if (product.stockUnits == null || isNaN(product.stockUnits) || product.stockUnits < 0) {
          productErrors.push({ path: 'stockUnits', msg: 'Stock units must be non-negative' });
        }
        if (product.reorderActive === undefined || typeof product.reorderActive !== 'boolean') {
          productErrors.push({ path: 'reorderActive', msg: 'Reorder active must be a boolean' });
        }
        if (product.active === undefined || typeof product.active !== 'boolean') {
          productErrors.push({ path: 'active', msg: 'Active status must be a boolean' });
        }
        if (product.hasImage === undefined || typeof product.hasImage !== 'boolean') {
          productErrors.push({ path: 'hasImage', msg: 'Image status must be a boolean' });
        }

        // Validate optional fields
        if (product.sellingPrice2 && (isNaN(product.sellingPrice2) || product.sellingPrice2 <= 0 || product.sellingPrice2 > 9999999999999.99)) {
          productErrors.push({ path: 'sellingPrice2', msg: 'Selling price 2 must be between 0.01 and 9,999,999,999,999.99' });
        }
        if (product.sellingPrice3 && (isNaN(product.sellingPrice3) || product.sellingPrice3 <= 0 || product.sellingPrice3 > 9999999999999.99)) {
          productErrors.push({ path: 'sellingPrice3', msg: 'Selling price 3 must be between 0.01 and 9,999,999,999,999.99' });
        }
        if (product.qty2Min && (isNaN(product.qty2Min) || product.qty2Min < 1)) {
          productErrors.push({ path: 'qty2Min', msg: 'Quantity 2 min must be at least 1' });
        }
        if (product.qty2Max && (isNaN(product.qty2Max) || product.qty2Max < 1)) {
          productErrors.push({ path: 'qty2Max', msg: 'Quantity 2 max must be at least 1' });
        }
        if (product.qty3Min && (isNaN(product.qty3Min) || product.qty3Min < 1)) {
          productErrors.push({ path: 'qty3Min', msg: 'Quantity 3 min must be at least 1' });
        }
        if (product.longerDescription === undefined || typeof product.longerDescription !== 'boolean') {
          productErrors.push({ path: 'longerDescription', msg: 'Longer description must be a boolean (true/false)' });
        }
        if (product.productBarcode && product.productBarcode.length > 50) {
          productErrors.push({ path: 'productBarcode', msg: 'Product barcode must be less than 50 characters' });
        }
        if (product.etimsRefCode && product.etimsRefCode.length > 50) {
          productErrors.push({ path: 'etimsRefCode', msg: 'eTIMS ref code must be less than 50 characters' });
        }
        if (product.packSize && product.packSize.length > 50) {
          productErrors.push({ path: 'packSize', msg: 'Pack size must be less than 50 characters' });
        }
        if (product.vendorItemCode && product.vendorItemCode.length > 50) {
          productErrors.push({ path: 'vendorItemCode', msg: 'Vendor item code must be less than 50 characters' });
        }
        if (product.reorderLevel && (isNaN(product.reorderLevel) || product.reorderLevel < 0)) {
          productErrors.push({ path: 'reorderLevel', msg: 'Reorder level must be non-negative' });
        }
        if (product.orderLevel && (isNaN(product.orderLevel) || product.orderLevel < 0)) {
          productErrors.push({ path: 'orderLevel', msg: 'Order level must be non-negative' });
        }

        // Validate quantity ranges
        if (product.qty1Max < product.qty1Min) {
          productErrors.push({ path: 'qty1Max', msg: 'Quantity 1 max must be greater than min' });
        }
        if (product.qty2Min && product.qty2Min <= product.qty1Max) {
          productErrors.push({ path: 'qty2Min', msg: 'Quantity 2 min must be greater than Quantity 1 max' });
        }
        if (product.qty2Max && product.qty2Max < product.qty2Min) {
          productErrors.push({ path: 'qty2Max', msg: 'Quantity 2 max must be greater than min' });
        }
        if (product.qty3Min && product.qty2Max && product.qty3Min <= product.qty2Max) {
          productErrors.push({ path: 'qty3Min', msg: 'Quantity 3 min must be greater than Quantity 2 max' });
        }

        // Validate parent category
        const parentCategoryResult = await client.query('SELECT id, parent_category_code FROM parent_categories WHERE id = $1', [product.parentCatId]);
        if (parentCategoryResult.rows.length === 0) {
          productErrors.push({ path: 'parentCatId', msg: `Parent category ID ${product.parentCatId} does not exist` });
        }

        // Validate category
        const categoryResult = await client.query(
          'SELECT id, category_code FROM categories WHERE id = $1 AND parent_category_id = $2',
          [product.categoryId, product.parentCatId]
        );
        if (categoryResult.rows.length === 0) {
          productErrors.push({ path: 'categoryId', msg: `Category ID ${product.categoryId} does not exist or does not belong to parent category ${product.parentCatId}` });
        }

        // Validate subcategory
        const subcategoryResult = await client.query(
          'SELECT id, subcategory_code FROM subcategories WHERE id = $1 AND category_id = $2',
          [product.subcategoryId, product.categoryId]
        );
        if (subcategoryResult.rows.length === 0) {
          productErrors.push({ path: 'subcategoryId', msg: `Subcategory ID ${product.subcategoryId} does not exist or does not belong to category ${product.categoryId}` });
        }

        // Check for duplicate product code
        const codeCheck = await client.query('SELECT id FROM products WHERE product_code = $1', [product.productCode]);
        if (codeCheck.rows.length > 0) {
          productErrors.push({ path: 'productCode', msg: `Product code ${product.productCode} already exists` });
        }

        // Validate supplier and vendorItemCode
        if (product.preferredVendor1) {
          const supplierCheck = await client.query('SELECT id, code FROM suppliers WHERE id = $1', [product.preferredVendor1]);
          if (supplierCheck.rows.length === 0) {
            productErrors.push({ path: 'preferredVendor1', msg: `Invalid supplier ID ${product.preferredVendor1}` });
          } else if (product.vendorItemCode && product.vendorItemCode !== supplierCheck.rows[0].code) {
            productErrors.push({ path: 'vendorItemCode', msg: `Vendor item code ${product.vendorItemCode} does not match supplier code ${supplierCheck.rows[0].code}` });
          }
        }

        if (productErrors.length > 0) {
          errors.push({ index: i, errors: productErrors });
          continue;
        }

        // Insert product
        const result = await client.query(
          `
          INSERT INTO products (
            product_name, product_code, parent_cat_id, category_id, subcategory_id, uom, pack_size,
            cost_price, selling_price1, selling_price2, selling_price3, qty1_min, qty1_max, qty2_min, 
            qty2_max, qty3_min, vat, cashback_rate, preferred_vendor1, vendor_item_code, sa_cashback_1st, 
            sa_cashback_2nd, sa_cashback_3rd, sa_cashback_4th, active, stock_units, 
            reorder_level, order_level, product_barcode, etims_ref_code, longer_description, image_url
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32
          ) RETURNING id
          `,
          [
            product.productName,
            product.productCode,
            product.parentCatId,
            product.categoryId,
            product.subcategoryId,
            product.uom,
            product.packSize || null,
            Number(product.costPrice),
            Number(product.sellingPrice1),
            product.sellingPrice2 ? Number(product.sellingPrice2) : null,
            product.sellingPrice3 ? Number(product.sellingPrice3) : null,
            product.qty1Min,
            product.qty1Max,
            product.qty2Min || null,
            product.qty2Max || null,
            product.qty3Min || null,
            Number(product.vat),
            Number(product.cashbackRate),
            product.preferredVendor1 || null,
            product.vendorItemCode || null,
            Number(product.saCashback1stPurchase),
            Number(product.saCashback2ndPurchase),
            Number(product.saCashback3rdPurchase),
            Number(product.saCashback4thPurchase),
            product.active !== undefined ? product.active : true,
            product.stockUnits || 0,
            product.reorderLevel || 0,
            product.orderLevel || 0,
            product.productBarcode || null,
            product.etimsRefCode || null,
            product.longerDescription ? true : false,
            product.hasImage ? '/Uploads/placeholder.png' : null
          ]
        );

        insertedIds.push(result.rows[0].id);
      }

      if (errors.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Validation failed for some products', errors });
      }

      await client.query('COMMIT');
      res.status(201).json({ message: 'Products created', ids: insertedIds });
    } catch (err) {
      console.error('Bulk import error:', err);
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Failed to create products', error: err.message });
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});
// DELETE route to soft delete a product
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const productCheck = await client.query('SELECT id FROM products WHERE id = $1', [id]);
      if (productCheck.rows.length === 0) {
        throw new Error('Product not found');
      }

      await client.query('UPDATE products SET active = false WHERE id = $1', [id]);
      await client.query('COMMIT');
      res.json({ message: 'Product deactivated' });
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Failed to delete product', error: err.message });
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});
// Error handling middleware
router.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!', error: err.message });
});

module.exports = router;