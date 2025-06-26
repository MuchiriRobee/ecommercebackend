const express = require('express');
const { query, body, param, validationResult } = require('express-validator');
const router = express.Router();
const pool = require('../config/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../Uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.chmodSync(uploadDir, 0o755);
}
// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log(`Saving image to: ${uploadDir}`);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    console.log(`Image filename: ${filename}`);
    cb(null, filename);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only JPG/PNG images allowed'));
  },
});

// Validation middleware
const validateProduct = [
  body('productName')
    .trim()
    .notEmpty()
    .withMessage('Product name is required')
    .isLength({ max: 255 })
    .withMessage('Product name must be less than 255 characters'),
  body('productCode')
    .trim()
    .notEmpty()
    .withMessage('Product code is required')
    .isLength({ max: 50 })
    .withMessage('Product code must be less than 50 characters'),
  body('uom')
    .trim()
    .notEmpty()
    .withMessage('Unit of measure is required')
    .isLength({ max: 20 })
    .withMessage('Unit of measure must be less than 20 characters'),
  body('categoryId')
    .isInt({ min: 1 })
    .withMessage('Valid category ID is required'),
  body('subcategoryId')
    .isInt({ min: 1 })
    .withMessage('Valid subcategory ID is required'),
  body('description')
    .trim()
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters'),
  body('longerDescription')
    .trim()
    .optional()
    .isLength({ max: 2000 })
    .withMessage('Longer description must be less than 2000 characters'),
  body('sellingPrice1')
    .isFloat({ min: 0, max: 9999999999999.99 })
    .withMessage('Selling price 1 must be a positive number up to 9999999999999.99'),
  body('sellingPrice2')
    .optional()
    .isFloat({ min: 0, max: 9999999999999.99 })
    .withMessage('Selling price 2 must be a positive number up to 9999999999999.99'),
  body('sellingPrice3')
    .optional()
    .isFloat({ min: 0, max: 9999999999999.99 })
    .withMessage('Selling price 3 must be a positive number up to 9999999999999.99'),
  body('costPrice')
    .isFloat({ min: 0, max: 9999999999999.99 })
    .withMessage('Cost price must be a positive number up to 9999999999999.99'),
  body('vat')
    .optional()
    .isFloat({ min: 0, max: 9999999999999.99 })
    .withMessage('VAT must be a positive number up to 9999999999999.99'),
  body('cashbackRate')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Cashback rate must be between 0 and 100'),
  body('stockUnits')
    .isInt({ min: 0 })
    .withMessage('Stock units must be a non-negative integer'),
  body('qty1Min')
    .isInt({ min: 1 })
    .withMessage('Minimum quantity 1 must be a positive integer'),
  body('qty1Max')
    .isInt({ min: 1 })
    .withMessage('Maximum quantity 1 must be a positive integer'),
  body('qty2Min')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Minimum quantity 2 must be a positive integer'),
  body('qty2Max')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Maximum quantity 2 must be a positive integer'),
  body('qty3Min')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Minimum quantity 3 must be a positive integer'),
];

const validateQueryParams = [
  query('categoryId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Valid category ID is required'),
  query('subcategoryId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Valid subcategory ID is required'),
];

const validateId = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Valid product ID is required'),
];

// Error handling middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Get all products or filter by categoryId and subcategoryId
router.get('/', validateQueryParams, handleValidationErrors, async (req, res, next) => {
  try {
    const { categoryId, subcategoryId } = req.query;
    let query = `
      SELECT p.*,
             json_build_object('id', c.id, 'name', c.name) as category,
             json_build_object('id', s.id, 'name', s.name) as subcategory,
             json_build_array(
               json_build_object('min_quantity', p.qty1_min, 'max_quantity', p.qty1_max, 'price', p.selling_price1),
               json_build_object('min_quantity', p.qty2_min, 'max_quantity', p.qty2_max, 'price', p.selling_price2),
               json_build_object('min_quantity', p.qty3_min, 'max_quantity', NULL, 'price', p.selling_price3)
             ) as tier_pricing
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN subcategories s ON p.subcategory_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (categoryId) {
      query += ' AND p.category_id = $' + (params.length + 1);
      params.push(parseInt(categoryId));
    }
    if (subcategoryId) {
      query += ' AND p.subcategory_id = $' + (params.length + 1);
      params.push(parseInt(subcategoryId));
    }

    query += ' ORDER BY p.product_name';

    const result = await pool.query(query, params);
    const products = result.rows.map(product => ({
      ...product,
      image_url: product.image_url ? product.image_url.toLowerCase() : null,
      tier_pricing: product.tier_pricing.filter(tier => tier.price != null),
    }));
    console.log('Fetched products:', products.map(p => ({ id: p.id, image_url: p.image_url, selling_price1: p.selling_price1 })));
    res.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    next(error);
  }
});

// Get single product by ID
router.get('/:id', validateId, handleValidationErrors, async (req, res, next) => {
  try {
    const result = await pool.query(
      `
      SELECT p.*,
             json_build_object('id', c.id, 'name', c.name) as category,
             json_build_object('id', s.id, 'name', s.name) as subcategory,
             json_build_array(
               json_build_object('min_quantity', p.qty1_min, 'max_quantity', p.qty1_max, 'price', p.selling_price1),
               json_build_object('min_quantity', p.qty2_min, 'max_quantity', p.qty2_max, 'price', p.selling_price2),
               json_build_object('min_quantity', p.qty3_min, 'max_quantity', NULL, 'price', p.selling_price3)
             ) as tier_pricing
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN subcategories s ON p.subcategory_id = s.id
      WHERE p.id = $1
    `,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    const product = result.rows[0];
    product.image_url = product.image_url ? product.image_url.toLowerCase() : null;
    product.tier_pricing = product.tier_pricing.filter(tier => tier.price != null);
    console.log('Fetched product:', { id: product.id, image_url: product.image_url, selling_price1: product.selling_price1 });
    res.json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
    next(error);
  }
});

// Create product
router.post('/', upload.single('image'), validateProduct, handleValidationErrors, async (req, res, next) => {
  try {
    const {
      productName, productCode, uom, packSize, categoryId, subcategoryId, description,
      longerDescription, productBarcode, etimsRefCode, expiryDate, costPrice,
      sellingPrice1, sellingPrice2, sellingPrice3, qty1Min, qty1Max, qty2Min, qty2Max,
      qty3Min, vat, cashbackRate, preferredVendor1, preferredVendor2, vendorItemCode,
      saCashback1stPurchase, saCashback2ndPurchase, saCashback3rdPurchase, saCashback4thPurchase,
      stockUnits, alertQuantity, reorderLevel, orderLevel, reorderActive,
    } = req.body;

    // Validate category and subcategory
    const categoryCheck = await pool.query('SELECT name FROM categories WHERE id = $1', [parseInt(categoryId)]);
    if (categoryCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Category does not exist' });
    }
    const subcategoryCheck = await pool.query(
      'SELECT id, name FROM subcategories WHERE id = $1 AND category_id = $2',
      [parseInt(subcategoryId), parseInt(categoryId)]
    );
    if (subcategoryCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Subcategory does not exist or does not belong to the specified category' });
    }

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
    console.log(`Image uploaded: ${imageUrl}`);

    const query = `
      INSERT INTO products (
        product_name, product_code, uom, pack_size, category_id, subcategory_id,
        description, longer_description, product_barcode, etims_ref_code, expiry_date,
        image_url, cost_price, selling_price1, selling_price2, selling_price3,
        qty1_min, qty1_max, qty2_min, qty2_max, qty3_min, vat, cashback_rate,
        preferred_vendor1, preferred_vendor2, vendor_item_code, sa_cashback_1st,
        sa_cashback_2nd, sa_cashback_3rd, sa_cashback_4th, stock_units, alert_quantity, 
        reorder_level, order_level, reorder_active
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35
      ) RETURNING *
    `;
    const values = [
      productName, productCode, uom, packSize, parseInt(categoryId), parseInt(subcategoryId),
      description, longerDescription, productBarcode, etimsRefCode, expiryDate || null,
      imageUrl, parseFloat(costPrice), parseFloat(sellingPrice1), parseFloat(sellingPrice2) || null,
      parseFloat(sellingPrice3) || null, parseInt(qty1Min), parseInt(qty1Max), parseInt(qty2Min) || null,
      parseInt(qty2Max) || null, parseInt(qty3Min) || null, parseFloat(vat),
      parseFloat(cashbackRate) || 0, preferredVendor1, preferredVendor2, vendorItemCode,
      parseFloat(saCashback1stPurchase) || 6, parseFloat(saCashback2ndPurchase) || 4,
      parseFloat(saCashback3rdPurchase) || 3, parseFloat(saCashback4thPurchase) || 2,
      parseInt(stockUnits), parseInt(alertQuantity), parseInt(reorderLevel) || null, parseInt(orderLevel) || null,
      reorderActive === 'true',
    ];

    const result = await pool.query(query, values);
    const product = result.rows[0];
    product.category = { id: parseInt(categoryId), name: categoryCheck.rows[0].name };
    product.subcategory = { id: parseInt(subcategoryId), name: subcategoryCheck.rows[0].name };
    product.tier_pricing = [
      { min_quantity: product.qty1_min, max_quantity: product.qty1_max, price: product.selling_price1 },
      { min_quantity: product.qty2_min, max_quantity: product.qty2_max, price: product.selling_price2 },
      { min_quantity: product.qty3_min, max_quantity: null, price: product.selling_price3 },
    ].filter(tier => tier.price != null);
    console.log('Created product:', { id: product.id, image_url: product.image_url, selling_price1: product.selling_price1 });
    res.status(201).json(product);
  } catch (error) {
    console.error('Error creating product:', error);
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Product code already exists' });
    }
    if (error.code === '22003') {
      return res.status(400).json({ message: 'Price value too large, must be less than 9999999999999.99' });
    }
    next(error);
  }
});

// Update product
router.put('/:id', upload.single('image'), validateProduct, validateId, handleValidationErrors, async (req, res, next) => {
  try {
    const {
      productName, productCode, uom, packSize, categoryId, subcategoryId, description,
      longerDescription, productBarcode, etimsRefCode, expiryDate, costPrice,
      sellingPrice1, sellingPrice2, sellingPrice3, qty1Min, qty1Max, qty2Min, qty2Max,
      qty3Min, vat, cashbackRate, preferredVendor1, preferredVendor2, vendorItemCode,
      saCashback1stPurchase, saCashback2ndPurchase, saCashback3rdPurchase, saCashback4thPurchase,
      stockUnits, alertQuantity, reorderLevel, orderLevel, reorderActive,
    } = req.body;

    // Validate category and subcategory
    const categoryCheck = await pool.query('SELECT name FROM categories WHERE id = $1', [parseInt(categoryId)]);
    if (categoryCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Category does not exist' });
    }
    const subcategoryCheck = await pool.query(
      'SELECT id, name FROM subcategories WHERE id = $1 AND category_id = $2',
      [parseInt(subcategoryId), parseInt(categoryId)]
    );
    if (subcategoryCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Subcategory does not exist or does not belong to the specified category' });
    }

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : req.body.imageUrl;
    console.log(`Updated image: ${imageUrl}`);

    const query = `
      UPDATE products SET
        product_name = $1, product_code = $2, uom = $3, pack_size = $4, category_id = $5,
        subcategory_id = $6, description = $7, longer_description = $8, product_barcode = $9,
        etims_ref_code = $10, expiry_date = $11, image_url = $12, cost_price = $13,
        selling_price1 = $14, selling_price2 = $15, selling_price3 = $16, qty1_min = $17,
        qty1_max = $18, qty2_min = $19, qty2_max = $20, qty3_min = $21, vat = $22,
        cashback_rate = $23, preferred_vendor1 = $24, preferred_vendor2 = $25,
        vendor_item_code = $26, sa_cashback_1st = $27, sa_cashback_2nd = $28,
        sa_cashback_3rd = $29, sa_cashback_4th = $30, stock_units = $31, alert_quantity = $32, 
        reorder_level = $33, order_level = $34, reorder_active = $35,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $36
      RETURNING *
    `;
    const values = [
      productName, productCode, uom, packSize, parseInt(categoryId), parseInt(subcategoryId),
      description, longerDescription, productBarcode, etimsRefCode, expiryDate || null,
      imageUrl, parseFloat(costPrice), parseFloat(sellingPrice1), parseFloat(sellingPrice2) || null,
      parseFloat(sellingPrice3) || null, parseInt(qty1Min), parseInt(qty1Max), parseInt(qty2Min) || null,
      parseInt(qty2Max) || null, parseInt(qty3Min) || null, parseFloat(vat),
      parseFloat(cashbackRate) || 0, preferredVendor1, preferredVendor2, vendorItemCode,
      parseFloat(saCashback1stPurchase) || 6, parseFloat(saCashback2ndPurchase) || 4,
      parseFloat(saCashback3rdPurchase) || 3, parseFloat(saCashback4thPurchase) || 2,
      parseInt(stockUnits), parseInt(alertQuantity), parseInt(reorderLevel) || null, parseInt(orderLevel) || null,
      reorderActive === 'true', parseInt(req.params.id),
    ];

    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Product not found' });
    }
    const product = result.rows[0];
    product.category = { id: parseInt(categoryId), name: categoryCheck.rows[0].name };
    product.subcategory = { id: parseInt(subcategoryId), name: subcategoryCheck.rows[0].name };
    product.tier_pricing = [
      { min_quantity: product.qty1_min, max_quantity: product.qty1_max, price: product.selling_price1 },
      { min_quantity: product.qty2_min, max_quantity: product.qty2_max, price: product.selling_price2 },
      { min_quantity: product.qty3_min, max_quantity: null, price: product.selling_price3 },
    ].filter(tier => tier.price != null);
    console.log('Updated product:', { id: product.id, image_url: product.image_url, selling_price1: product.selling_price1 });
    res.json(product);
  } catch (error) {
    console.error('Error updating product:', error);
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Product code already exists' });
    }
    if (error.code === '22003') {
      return res.status(400).json({ message: 'Price value too large, must be less than 9999999999999.99' });
    }
    next(error);
  }
});

// Delete product
router.delete('/:id', validateId, handleValidationErrors, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    next(error);
  }
});

module.exports = router;