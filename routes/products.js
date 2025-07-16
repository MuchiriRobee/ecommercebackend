const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const pool = require('../config/db');

const validateBulkProduct = [
  body('*.productName')
    .trim()
    .notEmpty()
    .withMessage('Product name is required')
    .isLength({ max: 255 })
    .withMessage('Product name must be less than 255 characters'),
  body('*.productCode')
    .trim()
    .notEmpty()
    .withMessage('Product code is required')
    .matches(/^[A-Z]\d{9}$/)
    .withMessage('Product code must be 1 uppercase letter followed by 9 digits'),
  body('*.parentCatId')
    .isInt({ min: 1 })
    .withMessage('Valid parent category ID is required'),
  body('*.categoryId')
    .isInt({ min: 1 })
    .withMessage('Valid category ID is required'),
  body('*.subcategoryId')
    .isInt({ min: 1 })
    .withMessage('Valid subcategory ID is required'),
  body('*.uom')
    .trim()
    .notEmpty()
    .withMessage('Unit of measure is required')
    .isLength({ max: 20 })
    .withMessage('Unit of measure must be less than 20 characters'),
  body('*.packSize')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 50 })
    .withMessage('Pack size must be less than 50 characters'),
  body('*.description')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters'),
  body('*.longerDescription')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Longer description must be less than 2000 characters'),
  body('*.productBarcode')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 50 })
    .withMessage('Product barcode must be less than 50 characters'),
  body('*.etimsRefCode')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 50 })
    .withMessage('eTIMS ref code must be less than 50 characters'),
  body('*.expiryDate')
    .optional({ nullable: true, checkFalsy: true })
    .isDate()
    .withMessage('Expiry date must be a valid date'),
  body('*.costPrice')
    .isFloat({ min: 0, max: 9999999999999.99 })
    .withMessage('Cost price must be between 0 and 9,999,999,999,999.99')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('Cost price must have at most 2 decimal places');
      return true;
    }),
  body('*.sellingPrice1')
    .isFloat({ min: 0, max: 9999999999999.99 })
    .withMessage('Selling price 1 must be between 0 and 9,999,999,999,999.99')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('Selling price 1 must have at most 2 decimal places');
      return true;
    }),
  body('*.sellingPrice2')
    .optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: 0, max: 9999999999999.99 })
    .withMessage('Selling price 2 must be between 0 and 9,999,999,999,999.99')
    .custom((value) => {
      if (value === null) return true;
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('Selling price 2 must have at most 2 decimal places');
      return true;
    }),
  body('*.sellingPrice3')
    .optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: 0, max: 9999999999999.99 })
    .withMessage('Selling price 3 must be between 0 and 9,999,999,999,999.99')
    .custom((value) => {
      if (value === null) return true;
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('Selling price 3 must have at most 2 decimal places');
      return true;
    }),
  body('*.qty1Min')
    .isInt({ min: 1 })
    .withMessage('Quantity 1 min must be a positive integer'),
  body('*.qty1Max')
    .isInt({ min: 1 })
    .withMessage('Quantity 1 max must be a positive integer'),
  body('*.qty2Min')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 1 })
    .withMessage('Quantity 2 min must be a positive integer'),
  body('*.qty2Max')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 1 })
    .withMessage('Quantity 2 max must be a positive integer'),
  body('*.qty3Min')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 1 })
    .withMessage('Quantity 3 min must be a positive integer'),
  body('*.vat')
    .isFloat({ min: 0, max: 100 })
    .withMessage('VAT must be between 0 and 100')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('VAT must have at most 2 decimal places');
      return true;
    }),
  body('*.cashbackRate')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Cashback rate must be between 0 and 100')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('Cashback rate must have at most 2 decimal places');
      return true;
    }),
  body('*.preferredVendor1')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 1 })
    .withMessage('Valid supplier ID is required'),
  body('*.vendorItemCode')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 50 })
    .withMessage('Vendor item code must be less than 50 characters'),
  body('*.saCashback1stPurchase')
    .isFloat({ min: 0, max: 100 })
    .withMessage('1st purchase cashback must be between 0 and 100')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('1st purchase cashback must have at most 2 decimal places');
      return true;
    }),
  body('*.saCashback2ndPurchase')
    .isFloat({ min: 0, max: 100 })
    .withMessage('2nd purchase cashback must be between 0 and 100')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('2nd purchase cashback must have at most 2 decimal places');
      return true;
    }),
  body('*.saCashback3rdPurchase')
    .isFloat({ min: 0, max: 100 })
    .withMessage('3rd purchase cashback must be between 0 and 100')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('3rd purchase cashback must have at most 2 decimal places');
      return true;
    }),
  body('*.saCashback4thPurchase')
    .isFloat({ min: 0, max: 100 })
    .withMessage('4th purchase cashback must be between 0 and 100')
    .custom((value) => {
      const decimals = (value.toString().split('.')[1] || '').length;
      if (decimals > 2) throw new Error('4th purchase cashback must have at most 2 decimal places');
      return true;
    }),
  body('*.stockUnits')
    .isInt({ min: 0 })
    .withMessage('Stock units must be a non-negative integer'),
  body('*.reorderLevel')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 0 })
    .withMessage('Reorder level must be a non-negative integer'),
  body('*.orderLevel')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 0 })
    .withMessage('Order level must be a non-negative integer'),
  body('*.alertQuantity')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 0 })
    .withMessage('Alert quantity must be a non-negative integer'),
  body('*.reorderActive')
    .isBoolean()
    .withMessage('Reorder active must be a boolean'),
  body('*.publishOnWebsite')
    .isBoolean()
    .withMessage('Publish on website must be a boolean'),
  body('*.active')
    .isBoolean()
    .withMessage('Active status must be a boolean')
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().reduce((acc, err) => {
      const row = parseInt(err.path.match(/\d+/)[0]) + 2;
      if (!acc[row]) acc[row] = {};
      acc[row][err.param.replace(/$$ \d+ $$\./, '')] = err.msg;
      return acc;
    }, {});
    return res.status(400).json({ message: 'Validation errors in bulk import', errors: Object.entries(formattedErrors).map(([row, errors]) => ({ row: parseInt(row), errors })) });
  }
  next();
};

router.post('/bulk', validateBulkProduct, async (req, res, next) => {
  try {
    const products = req.body;
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'Request body must be a non-empty array of products' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insertedProducts = [];
      const errors = [];

      for (let i = 0; i < products.length; i++) {
        const product = products[i];

        try {
          // Validate parent category
          const parentCategoryResult = await client.query('SELECT id FROM parent_categories WHERE id = $1', [product.parentCatId]);
          if (parentCategoryResult.rows.length === 0) {
            throw new Error(`Parent category ID ${product.parentCatId} does not exist`);
          }

          // Validate category
          const categoryResult = await client.query(
            'SELECT id FROM categories WHERE id = $1 AND parent_category_id = $2',
            [product.categoryId, product.parentCatId]
          );
          if (categoryResult.rows.length === 0) {
            throw new Error(`Category ID ${product.categoryId} does not exist or does not belong to parent category ${product.parentCatId}`);
          }

          // Validate subcategory
          const subcategoryResult = await client.query(
            'SELECT id FROM subcategories WHERE id = $1 AND category_id = $2',
            [product.subcategoryId, product.categoryId]
          );
          if (subcategoryResult.rows.length === 0) {
            throw new Error(`Subcategory ID ${product.subcategoryId} does not exist or does not belong to category ${product.categoryId}`);
          }

          // Check for duplicate product code
          const codeCheck = await client.query('SELECT id FROM products WHERE product_code = $1', [product.productCode]);
          if (codeCheck.rows.length > 0) {
            throw new Error(`Product code ${product.productCode} already exists`);
          }

          // Validate supplier and vendorItemCode
          if (product.preferredVendor1) {
            const supplierCheck = await client.query('SELECT id, code FROM suppliers WHERE id = $1', [product.preferredVendor1]);
            if (supplierCheck.rows.length === 0) {
              throw new Error(`Invalid supplier ID ${product.preferredVendor1}`);
            }
            if (product.vendorItemCode && product.vendorItemCode !== supplierCheck.rows[0].code) {
              throw new Error(`Vendor item code ${product.vendorItemCode} does not match supplier code ${supplierCheck.rows[0].code}`);
            }
          }

          // Validate quantity ranges
          if (product.qty2Max && product.qty2Max <= product.qty1Max) {
            throw new Error('Quantity 2 max must be greater than Quantity 1 max');
          }
          if (product.qty3Min && product.qty2Max && product.qty3Min <= product.qty2Max) {
            throw new Error('Quantity 3 min must be greater than Quantity 2 max');
          }

          const result = await client.query(
            `
            INSERT INTO products (
              product_name, product_code, parent_cat_id, category_id, subcategory_id, uom, pack_size, description,
              longer_description, product_barcode, etims_ref_code, expiry_date, cost_price, selling_price1,
              selling_price2, selling_price3, qty1_min, qty1_max, qty2_min, qty2_max, qty3_min, vat,
              cashback_rate, preferred_vendor1, vendor_item_code, sa_cashback_1st, sa_cashback_2nd,
              sa_cashback_3rd, sa_cashback_4th, stock_units, reorder_level, order_level, alert_quantity,
              reorder_active, publ_on_wsite, active
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
              $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36
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
              product.description || null,
              product.longerDescription || null,
              product.productBarcode || null,
              product.etimsRefCode || null,
              product.expiryDate || null,
              product.costPrice,
              product.sellingPrice1,
              product.sellingPrice2 || null,
              product.sellingPrice3 || null,
              product.qty1Min,
              product.qty1Max,
              product.qty2Min || null,
              product.qty2Max || null,
              product.qty3Min || null,
              product.vat,
              product.cashbackRate,
              product.preferredVendor1 || null,
              product.vendorItemCode || null,
              product.saCashback1stPurchase,
              product.saCashback2ndPurchase,
              product.saCashback3rdPurchase,
              product.saCashback4thPurchase,
              product.stockUnits,
              product.reorderLevel || null,
              product.orderLevel || null,
              product.alertQuantity || null,
              product.reorderActive,
              product.publishOnWebsite,
              product.active
            ]
          );

          insertedProducts.push({ id: result.rows[0].id, productCode: product.productCode });
        } catch (err) {
          errors.push({ row: i + 2, errors: { general: err.message } });
        }
      }

      if (errors.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Some products failed to import', errors });
      }

      await client.query('COMMIT');
      res.status(201).json({ message: 'Products imported successfully', insertedProducts });
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: 'Server error', error: err.message });
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// Fetch all products
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM products');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Fetch a single product
router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Create a product
router.post('/', async (req, res, next) => {
  try {
    const formData = req.body;
    // Assume formData is processed similarly to bulk endpoint, but for a single product
    // Validation and insertion logic here (omitted for brevity as not modified)
    res.status(201).json({ message: 'Product created' });
  } catch (err) {
    next(err);
  }
});

// Update a product
router.put('/:id', async (req, res, next) => {
  try {
    const formData = req.body;
    // Assume formData is processed similarly to bulk endpoint, but for updating
    // Validation and update logic here (omitted for brevity as not modified)
    res.json({ message: 'Product updated' });
  } catch (err) {
    next(err);
  }
});

// Delete a product
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json({ message: 'Product deleted' });
  } catch (err) {
    next(err);
  }
});

// Toggle product active status
router.patch('/:id/active', async (req, res, next) => {
  try {
    const { active } = req.body;
    if (typeof active !== 'boolean') {
      return res.status(400).json({ message: 'Active status must be a boolean' });
    }
    const result = await pool.query(
      'UPDATE products SET active = $1 WHERE id = $2 RETURNING id, active',
      [active, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json({ message: 'Product status updated', active: result.rows[0].active });
  } catch (err) {
    next(err);
  }
});

module.exports = router;