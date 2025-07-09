const express = require('express');
const { query, body, validationResult } = require('express-validator');
const router = express.Router();
const pool = require('../config/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const uploadDir = path.join(__dirname, '../Uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.chmodSync(uploadDir, 0o755);
}

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
  limits: { fileSize: 5 * 1024 * 1024 },
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
    .matches(/^[A-Z]\d{9}$/)
    .withMessage('Product code must be 1 uppercase letter followed by 9 digits'),
  body('parentCatId')
    .isInt({ min: 1 })
    .withMessage('Valid parent category ID is required'),
  body('categoryId')
    .isInt({ min: 1 })
    .withMessage('Valid category ID is required'),
  body('subcategoryId')
    .isInt({ min: 1 })
    .withMessage('Valid subcategory ID is required'),
  body('uom')
    .trim()
    .notEmpty()
    .withMessage('Unit of measure is required')
    .isLength({ max: 20 })
    .withMessage('Unit of measure must be less than 20 characters'),
  body('packSize')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Pack size must be less than 50 characters'),
  body('description')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters'),
  body('longerDescription')
    .optional()
    .isLength({ max: 2000 })
    .withMessage('Longer description must be less than 2000 characters'),
  body('productBarcode')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Product barcode must be less than 50 characters'),
  body('etimsRefCode')
    .optional()
    .isLength({ max: 50 })
    .withMessage('eTIMS ref code must be less than 50 characters'),
  body('costPrice')
    .isFloat({ min: 0, max: 9999999999999.99 })
    .withMessage('Cost price must be between 0 and 9,999,999,999,999.99')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('Cost price must have exactly 2 decimal places');
      const integers = value.toString().split('.')[0].replace('-', '').length;
      if (integers > 13) throw new Error('Cost price must have at most 13 digits before decimal');
      return true;
    }),
  body('sellingPrice1')
    .isFloat({ min: 0, max: 9999999999999.99 })
    .withMessage('Selling price 1 must be between 0 and 9,999,999,999,999.99')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('Selling price 1 must have exactly 2 decimal places');
      const integers = value.toString().split('.')[0].replace('-', '').length;
      if (integers > 13) throw new Error('Selling price 1 must have at most 13 digits before decimal');
      return true;
    }),
  body('sellingPrice2')
    .optional()
    .isFloat({ min: 0, max: 9999999999999.99 })
    .withMessage('Selling price 2 must be between 0 and 9,999,999,999,999.99')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('Selling price 2 must have exactly 2 decimal places');
      const integers = value.toString().split('.')[0].replace('-', '').length;
      if (integers > 13) throw new Error('Selling price 2 must have at most 13 digits before decimal');
      return true;
    }),
  body('sellingPrice3')
    .optional()
    .isFloat({ min: 0, max: 9999999999999.99 })
    .withMessage('Selling price 3 must be between 0 and 9,999,999,999,999.99')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('Selling price 3 must have exactly 2 decimal places');
      const integers = value.toString().split('.')[0].replace('-', '').length;
      if (integers > 13) throw new Error('Selling price 3 must have at most 13 digits before decimal');
      return true;
    }),
  body('qty1Min')
    .isInt({ min: 1 })
    .withMessage('Quantity 1 min must be a positive integer'),
  body('qty1Max')
    .isInt({ min: 1 })
    .withMessage('Quantity 1 max must be a positive integer'),
  body('qty2Min')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Quantity 2 min must be a positive integer'),
  body('qty2Max')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Quantity 2 max must be a positive integer'),
  body('qty3Min')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Quantity 3 min must be a positive integer'),
  body('vat')
    .isFloat({ min: 0, max: 100 })
    .withMessage('VAT must be between 0 and 100')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('VAT must have exactly 2 decimal places');
      return true;
    }),
  body('cashbackRate')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Cashback rate must be between 0 and 100')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('Cashback rate must have exactly 2 decimal places');
      return true;
    }),
  body('preferredVendor1')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Valid supplier ID is required'),
  body('vendorItemCode')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Vendor item code must be less than 50 characters'),
  body('saCashback1stPurchase')
    .isFloat({ min: 0, max: 100 })
    .withMessage('1st purchase cashback must be between 0 and 100')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('1st purchase cashback must have exactly 2 decimal places');
      return true;
    }),
  body('saCashback2ndPurchase')
    .isFloat({ min: 0, max: 100 })
    .withMessage('2nd purchase cashback must be between 0 and 100')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('2nd purchase cashback must have exactly 2 decimal places');
      return true;
    }),
  body('saCashback3rdPurchase')
    .isFloat({ min: 0, max: 100 })
    .withMessage('3rd purchase cashback must be between 0 and 100')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('3rd purchase cashback must have exactly 2 decimal places');
      return true;
    }),
  body('saCashback4thPurchase')
    .isFloat({ min: 0, max: 100 })
    .withMessage('4th purchase cashback must be between 0 and 100')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('4th purchase cashback must have exactly 2 decimal places');
      return true;
    }),
  body('stockUnits')
    .isInt({ min: 0 })
    .withMessage('Stock units must be a non-negative integer'),
  body('reorderLevel')
    .optional({ checkFalsy: true })
    .isInt({ min: 0 })
    .withMessage('Reorder level must be a non-negative integer'),
  body('orderLevel')
    .optional({ checkFalsy: true })
    .isInt({ min: 0 })
    .withMessage('Order level must be a non-negative integer'),
  body('alertQuantity')
    .optional({ checkFalsy: true })
    .isInt({ min: 0 })
    .withMessage('Alert quantity must be a non-negative integer'),
  body('reorderActive')
    .isBoolean()
    .withMessage('Reorder active must be a boolean'),
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.get('/', [
  query('parentCatId').optional().isInt({ min: 1 }).withMessage('Valid parent category ID is required'),
  query('categoryId').optional().isInt({ min: 1 }).withMessage('Valid category ID is required'),
  query('subcategoryId').optional().isInt({ min: 1 }).withMessage('Valid subcategory ID is required'),
  query('productCode').optional().isString().withMessage('Product code must be a string'),
  query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be a non-negative integer'),
], handleValidationErrors, async (req, res, next) => {
  try {
    const { parentCatId, categoryId, subcategoryId, productCode, limit = 20, offset = 0 } = req.query;
    let query = `
      SELECT p.*,
             json_build_object(
               'id', pc.id,
               'name', pc.name,
               'parent_category_code', pc.parent_category_code
             ) as parent_category,
             json_build_object(
               'id', c.id,
               'name', c.name,
               'category_code', c.category_code
             ) as category,
             json_build_object(
               'id', s.id,
               'name', s.name,
               'subcategory_code', COALESCE(s.subcategory_code, '01')
             ) as subcategory,
             json_build_object(
               'sellingPrice1', p.selling_price1,
               'qty1Min', p.qty1_min,
               'qty1Max', p.qty1_max,
               'sellingPrice2', p.selling_price2,
               'qty2Min', p.qty2_min,
               'qty2Max', p.qty2_max,
               'sellingPrice3', p.selling_price3,
               'qty3Min', p.qty3_min
             ) as pricing_tiers,
             json_build_object(
               'id', sup.id,
               'name', sup.name,
               'code', sup.code
             ) as preferred_vendor
      FROM products p
      JOIN parent_categories pc ON p.parent_cat_id = pc.id
      JOIN categories c ON p.category_id = c.id
      JOIN subcategories s ON p.subcategory_id = s.id
      LEFT JOIN suppliers sup ON p.preferred_vendor1 = sup.id
    `;
    const params = [];
    let conditions = [];
    if (parentCatId) {
      conditions.push(`p.parent_cat_id = $${params.length + 1}`);
      params.push(parentCatId);
    }
    if (categoryId) {
      conditions.push(`p.category_id = $${params.length + 1}`);
      params.push(categoryId);
    }
    if (subcategoryId) {
      conditions.push(`p.subcategory_id = $${params.length + 1}`);
      params.push(subcategoryId);
    }
    if (productCode) {
      conditions.push(`p.product_code = $${params.length + 1}`);
      params.push(productCode);
    }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` ORDER BY p.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      `
      SELECT p.*,
             json_build_object(
               'id', pc.id,
               'name', pc.name,
               'parent_category_code', pc.parent_category_code
             ) as parent_category,
             json_build_object(
               'id', c.id,
               'name', c.name,
               'category_code', c.category_code
             ) as category,
             json_build_object(
               'id', s.id,
               'name', s.name,
               'subcategory_code', COALESCE(s.subcategory_code, '01')
             ) as subcategory,
             json_build_object(
               'sellingPrice1', p.selling_price1,
               'qty1Min', p.qty1_min,
               'qty1Max', p.qty1_max,
               'sellingPrice2', p.selling_price2,
               'qty2Min', p.qty2_min,
               'qty2Max', p.qty2_max,
               'sellingPrice3', p.selling_price3,
               'qty3Min', p.qty3_min
             ) as pricing_tiers,
             json_build_object(
               'id', sup.id,
               'name', sup.name,
               'code', sup.code
             ) as preferred_vendor
      FROM products p
      JOIN parent_categories pc ON p.parent_cat_id = pc.id
      JOIN categories c ON p.category_id = c.id
      JOIN subcategories s ON p.subcategory_id = s.id
      LEFT JOIN suppliers sup ON p.preferred_vendor1 = sup.id
      WHERE p.id = $1
      `,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    next(error);
  }
});

router.post('/', upload.single('image'), validateProduct, handleValidationErrors, async (req, res, next) => {
  try {
    const {
      productName, productCode, parentCatId, categoryId, subcategoryId, uom, packSize, description, longerDescription,
      productBarcode, etimsRefCode, expiryDate, costPrice, sellingPrice1, sellingPrice2,
      sellingPrice3, qty1Min, qty1Max, qty2Min, qty2Max, qty3Min, vat, cashbackRate,
      preferredVendor1, vendorItemCode, saCashback1stPurchase,
      saCashback2ndPurchase, saCashback3rdPurchase, saCashback4thPurchase, stockUnits,
      reorderLevel, orderLevel, alertQuantity, reorderActive
    } = req.body;

    // Validate parent category
    const parentCategoryResult = await pool.query('SELECT id FROM parent_categories WHERE id = $1', [parentCatId]);
    if (parentCategoryResult.rows.length === 0) {
      return res.status(400).json({ message: 'Parent category does not exist' });
    }

    // Validate category
    const categoryResult = await pool.query('SELECT id FROM categories WHERE id = $1 AND parent_category_id = $2', [categoryId, parentCatId]);
    if (categoryResult.rows.length === 0) {
      return res.status(400).json({ message: 'Category does not exist or does not belong to the specified parent category' });
    }

    // Validate subcategory
    const subcategoryResult = await pool.query(
      'SELECT id FROM subcategories WHERE id = $1 AND category_id = $2',
      [subcategoryId, categoryId]
    );
    if (subcategoryResult.rows.length === 0) {
      return res.status(400).json({ message: 'Subcategory does not exist or does not belong to the specified category' });
    }

    // Check for duplicate product code
    const codeCheck = await pool.query('SELECT id FROM products WHERE product_code = $1', [productCode]);
    if (codeCheck.rows.length > 0) {
      return res.status(400).json({ message: `Product code ${productCode} already exists` });
    }

    // Validate supplier
    if (preferredVendor1) {
      const supplierCheck = await pool.query('SELECT id FROM suppliers WHERE id = $1', [preferredVendor1]);
      if (supplierCheck.rows.length === 0) {
        return res.status(400).json({ message: `Invalid supplier ID: ${preferredVendor1}` });
      }
    }

    const imageUrl = req.file ? `/Uploads/${req.file.filename}` : null;

    const result = await pool.query(
      `
      INSERT INTO products (
        product_name, product_code, parent_cat_id, category_id, subcategory_id, uom, pack_size, description,
        longer_description, product_barcode, etims_ref_code, expiry_date, image_url,
        cost_price, selling_price1, selling_price2, selling_price3, qty1_min, qty1_max,
        qty2_min, qty2_max, qty3_min, vat, cashback_rate, preferred_vendor1,
        vendor_item_code, sa_cashback_1st, sa_cashback_2nd, sa_cashback_3rd,
        sa_cashback_4th, stock_units, reorder_level, order_level, alert_quantity,
        reorder_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35)
      RETURNING *
      `,
      [
        productName, productCode, parentCatId, categoryId, subcategoryId, uom, packSize || null, description || null,
        longerDescription || null, productBarcode || null, etimsRefCode || null,
        expiryDate || null, imageUrl, parseFloat(costPrice), parseFloat(sellingPrice1),
        parseFloat(sellingPrice2) || null, parseFloat(sellingPrice3) || null, qty1Min, qty1Max,
        qty2Min || null, qty2Max || null, qty3Min || null, parseFloat(vat), parseFloat(cashbackRate),
        preferredVendor1 || null, vendorItemCode || null,
        parseFloat(saCashback1stPurchase), parseFloat(saCashback2ndPurchase),
        parseFloat(saCashback3rdPurchase), parseFloat(saCashback4thPurchase),
        stockUnits, reorderLevel || null, orderLevel || null, alertQuantity || null, reorderActive
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (req.file) {
      fs.unlink(path.join(uploadDir, req.file.filename), (err) => {
        if (err) console.error('Failed to delete image:', err);
      });
    }
    if (error.code === '23505') {
      return res.status(400).json({ message: `Product code ${productCode} already exists` });
    }
    if (error.code === '23503') {
      return res.status(400).json({ message: `Invalid foreign key: check parent_cat_id, category_id, subcategory_id, or preferred_vendor1` });
    }
    if (error.code === '22003') {
      return res.status(400).json({ message: 'Numeric value out of range' });
    }
    if (error.code === '23502') {
      return res.status(400).json({ message: 'Required fields cannot be null' });
    }
    console.error('Server error:', error);
    next(error);
  }
});

router.put('/:id', upload.single('image'), validateProduct, handleValidationErrors, async (req, res, next) => {
  try {
    const {
      productName, productCode, parentCatId, categoryId, subcategoryId, uom, packSize, description, longerDescription,
      productBarcode, etimsRefCode, expiryDate, costPrice, sellingPrice1, sellingPrice2,
      sellingPrice3, qty1Min, qty1Max, qty2Min, qty2Max, qty3Min, vat, cashbackRate,
      preferredVendor1, vendorItemCode, saCashback1stPurchase,
      saCashback2ndPurchase, saCashback3rdPurchase, saCashback4thPurchase, stockUnits,
      reorderLevel, orderLevel, alertQuantity, reorderActive, imageUrl
    } = req.body;

    // Validate parent category
    const parentCategoryResult = await pool.query('SELECT id FROM parent_categories WHERE id = $1', [parentCatId]);
    if (parentCategoryResult.rows.length === 0) {
      return res.status(400).json({ message: 'Parent category does not exist' });
    }

    // Validate category
    const categoryResult = await pool.query('SELECT id FROM categories WHERE id = $1 AND parent_category_id = $2', [categoryId, parentCatId]);
    if (categoryResult.rows.length === 0) {
      return res.status(400).json({ message: 'Category does not exist or does not belong to the specified parent category' });
    }

    // Validate subcategory
    const subcategoryResult = await pool.query(
      'SELECT id FROM subcategories WHERE id = $1 AND category_id = $2',
      [subcategoryId, categoryId]
    );
    if (subcategoryResult.rows.length === 0) {
      return res.status(400).json({ message: 'Subcategory does not exist or does not belong to the specified category' });
    }

    // Check existing product
    const existing = await pool.query('SELECT image_url, product_code FROM products WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Validate product code if changed
    if (productCode !== existing.rows[0].product_code) {
      const codeCheck = await pool.query('SELECT id FROM products WHERE product_code = $1 AND id != $2', [productCode, req.params.id]);
      if (codeCheck.rows.length > 0) {
        return res.status(400).json({ message: `Product code ${productCode} already exists` });
      }
    }

    // Validate supplier
    if (preferredVendor1) {
      const supplierCheck = await pool.query('SELECT id FROM suppliers WHERE id = $1', [preferredVendor1]);
      if (supplierCheck.rows.length === 0) {
        return res.status(400).json({ message: `Invalid supplier ID: ${preferredVendor1}` });
      }
    }

    // Delete old image if new one is uploaded
    if (req.file && existing.rows[0].image_url) {
      fs.unlink(path.join(__dirname, '../', existing.rows[0].image_url), (err) => {
        if (err) console.error('Failed to delete old image:', err);
      });
    }

    const newImageUrl = req.file ? `/Uploads/${req.file.filename}` : (imageUrl || existing.rows[0].image_url);

    const result = await pool.query(
      `
      UPDATE products
      SET product_name = $1, product_code = $2, parent_cat_id = $3, category_id = $4,
          subcategory_id = $5, uom = $6, pack_size = $7, description = $8, longer_description = $9,
          product_barcode = $10, etims_ref_code = $11, expiry_date = $12, image_url = $13,
          cost_price = $14, selling_price1 = $15, selling_price2 = $16, selling_price3 = $17,
          qty1_min = $18, qty1_max = $19, qty2_min = $20, qty2_max = $21, qty3_min = $22,
          vat = $23, cashback_rate = $24, preferred_vendor1 = $25, vendor_item_code = $26,
          sa_cashback_1st = $27, sa_cashback_2nd = $28, sa_cashback_3rd = $29,
          sa_cashback_4th = $30, stock_units = $31, reorder_level = $32, order_level = $33,
          alert_quantity = $34, reorder_active = $35, updated_at = CURRENT_TIMESTAMP
      WHERE id = $36
      RETURNING *
      `,
      [
        productName, productCode, parentCatId, categoryId, subcategoryId, uom, packSize || null, description || null,
        longerDescription || null, productBarcode || null, etimsRefCode || null,
        expiryDate || null, newImageUrl, parseFloat(costPrice), parseFloat(sellingPrice1),
        parseFloat(sellingPrice2) || null, parseFloat(sellingPrice3) || null, qty1Min, qty1Max,
        qty2Min || null, qty2Max || null, qty3Min || null, parseFloat(vat), parseFloat(cashbackRate),
        preferredVendor1 || null, vendorItemCode || null,
        parseFloat(saCashback1stPurchase), parseFloat(saCashback2ndPurchase),
        parseFloat(saCashback3rdPurchase), parseFloat(saCashback4thPurchase),
        stockUnits, reorderLevel || null, orderLevel || null, alertQuantity || null, reorderActive,
        req.params.id
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    if (req.file) {
      fs.unlink(path.join(uploadDir, req.file.filename), (err) => {
        if (err) console.error('Failed to delete image:', err);
      });
    }
    if (error.code === '23505') {
      return res.status(400).json({ message: `Product code ${productCode} already exists` });
    }
    if (error.code === '23503') {
      return res.status(400).json({ message: `Invalid foreign key: check parent_cat_id, category_id, subcategory_id, or preferred_vendor1` });
    }
    if (error.code === '22003') {
      return res.status(400).json({ message: 'Numeric value out of range' });
    }
    if (error.code === '23502') {
      return res.status(400).json({ message: 'Required fields cannot be null' });
    }
    console.error('Server error:', error);
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await pool.query('SELECT image_url FROM products WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (existing.rows[0].image_url) {
      fs.unlink(path.join(__dirname, '../', existing.rows[0].image_url), (err) => {
        if (err) console.error('Failed to delete image:', err);
      });
    }

    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (error) {
    console.error('Server error:', error);
    next(error);
  }
});

module.exports = router;