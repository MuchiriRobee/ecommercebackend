const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const router = express.Router();
const jwt = require('jsonwebtoken');

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// Validation rules for creating an order
const validateOrder = [
  body('shippingInfo.username').trim().notEmpty().withMessage('Username is required'),
  body('shippingInfo.email').isEmail().withMessage('Valid email is required'),
  body('shippingInfo.phone').trim().notEmpty().withMessage('Phone number is required'),
  body('shippingInfo.address').trim().notEmpty().withMessage('Address is required'),
  body('shippingInfo.city').trim().notEmpty().withMessage('City is required'),
  body('shippingInfo.country').trim().notEmpty().withMessage('Country is required'),
  body('paymentMethod').isIn(['mpesa', 'card']).withMessage('Payment method must be mpesa or card'),
  body('cartItems').isArray({ min: 1 }).withMessage('At least one cart item is required'),
  body('cartItems.*.id').isInt({ min: 1 }).withMessage('Valid product ID is required'),
  body('cartItems.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('cartItems.*.unitPrice').optional().isFloat({ min: 0 }).withMessage('Unit price must be a non-negative number'),
  body('cartItems.*.cashbackPercent').optional().isFloat({ min: 0, max: 100 }).withMessage('Cashback percent must be between 0 and 100'),
  body('subtotalExclVAT').custom(value => !isNaN(parseFloat(value)) && parseFloat(value) >= 0).withMessage('Subtotal must be a non-negative number'),
  body('vatAmount').custom(value => !isNaN(parseFloat(value)) && parseFloat(value) >= 0).withMessage('VAT amount must be a non-negative number'),
  body('shippingCost').custom(value => !isNaN(parseFloat(value)) && parseFloat(value) >= 0).withMessage('Shipping cost must be a non-negative number'),
  body('total').custom(value => !isNaN(parseFloat(value)) && parseFloat(value) >= 0).withMessage('Total must be a non-negative number'),
];

// POST route to create a new order
router.post('/', verifyToken, validateOrder, async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Validation errors:', errors.array());
    return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  }

  try {
    const { shippingInfo, paymentMethod, paymentDetails, cartItems, subtotalExclVAT, vatAmount, shippingCost, total } = req.body;
    const userId = req.user.id; // From JWT token
    console.log('Received order data:', JSON.stringify(req.body, null, 2));
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Fetch and validate cart items against products table
      let calculatedSubtotalExclVAT = 0;
      const validatedItems = [];

      for (const item of cartItems) {
        const productCheck = await client.query(
          'SELECT id, product_name, selling_price1, vat, stock_units, image_url, product_code, cashback_rate, qty1_min, qty1_max, selling_price2, qty2_min, qty2_max, selling_price3, qty3_min FROM products WHERE id = $1 AND active = true',
          [item.id]
        );
        if (productCheck.rows.length === 0) {
          throw new Error(`Product ID ${item.id} not found or inactive`);
        }
        const product = productCheck.rows[0];
        if (product.stock_units < item.quantity) {
          throw new Error(`Insufficient stock for product ID ${item.id}`);
        }

        // Reconstruct tier pricing
        const tier_pricing = [
          { min_quantity: product.qty1_min || 1, max_quantity: product.qty1_max || null, price: parseFloat(product.selling_price1) || 0 },
          ...(product.selling_price2 && product.qty2_min
            ? [{ min_quantity: product.qty2_min, max_quantity: product.qty2_max || null, price: parseFloat(product.selling_price2) }]
            : []),
          ...(product.selling_price3 && product.qty3_min
            ? [{ min_quantity: product.qty3_min, max_quantity: null, price: parseFloat(product.selling_price3) }]
            : []),
        ];

        // Determine the correct price based on quantity
        const quantity = parseInt(item.quantity);
        const tier = tier_pricing.find(
          t => quantity >= t.min_quantity && (!t.max_quantity || quantity <= t.max_quantity)
        ) || tier_pricing[0];
        const unitPrice = parseFloat(item.unitPrice) || tier.price;
        const vatRate = parseFloat(item.vatRate) || product.vat || 0.16;
        const priceExclVAT = Number((unitPrice / (1 + vatRate/100)).toFixed(2)); // Fixed VAT calculation
        const subtotalItemExclVAT = priceExclVAT * quantity;
        calculatedSubtotalExclVAT += subtotalItemExclVAT;

        const cashbackPercent = parseFloat(item.cashbackPercent) || parseFloat(product.cashback_rate) || 5;
        const cashbackAmount = Number((subtotalItemExclVAT * (cashbackPercent / 100)).toFixed(2));

        validatedItems.push({
          ...item,
          product_name: product.product_name,
          image_url: product.image_url,
          product_code: product.product_code,
          unitPrice,
          vatRate,
          subtotalItemExclVAT,
          cashbackPercent,
          cashbackAmount,
        });
      }

      // Validate subtotal
      const receivedSubtotalExclVAT = parseFloat(subtotalExclVAT).toFixed(2);
      calculatedSubtotalExclVAT = parseFloat(calculatedSubtotalExclVAT).toFixed(2);
      if (receivedSubtotalExclVAT !== calculatedSubtotalExclVAT) {
        throw new Error(`Subtotal mismatch: received ${receivedSubtotalExclVAT}, calculated ${calculatedSubtotalExclVAT}`);
      }

      // Validate shipping cost
      const expectedShippingCost = 299; // As defined in CheckoutPage.jsx
      if (parseFloat(shippingCost).toFixed(2) !== parseFloat(expectedShippingCost).toFixed(2)) {
        throw new Error(`Shipping cost mismatch: received ${shippingCost}, expected ${expectedShippingCost}`);
      }

      // Validate total
      const calculatedTotal = Math.round(
        parseFloat(calculatedSubtotalExclVAT) +
        parseFloat(vatAmount) +
        parseFloat(shippingCost)
      );
      if (parseFloat(total).toFixed(2) !== parseFloat(calculatedTotal).toFixed(2)) {
        throw new Error(`Total mismatch: received ${total}, calculated ${calculatedTotal}`);
      }

      // Generate order number
      const sequenceResult = await client.query('SELECT nextval(\'order_number_seq\')');
      const sequenceNumber = sequenceResult.rows[0].nextval;
      const orderNumber = `ORD${String(sequenceNumber).padStart(6, '0')}`;

      // Insert order
      const orderResult = await client.query(
        `
        INSERT INTO orders (
          order_number, user_id, payment_method, payment_details, shipping_info,
          subtotal_excl_vat, vat_amount, shipping_cost, total_amount
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, order_number, created_at
        `,
        [
          orderNumber,
          userId,
          paymentMethod,
          paymentDetails,
          shippingInfo,
          parseFloat(subtotalExclVAT),
          parseFloat(vatAmount),
          parseFloat(shippingCost),
          parseFloat(total),
        ]
      );

      const orderId = orderResult.rows[0].id;
      const createdAt = orderResult.rows[0].created_at;

      // Insert order items with additional product details
      for (const item of validatedItems) {
        await client.query(
          `
          INSERT INTO order_items (
            order_id, product_id, product_name, image_url, product_code, quantity,
            unit_price, vat_rate, subtotal_excl_vat, cashback_amount, cashback_percent
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `,
          [
            orderId,
            item.id,
            item.product_name,
            item.image_url,
            item.product_code,
            item.quantity,
            item.unitPrice,
            item.vatRate,
            item.subtotalItemExclVAT,
            item.cashbackAmount,
            item.cashbackPercent,
          ]
        );

        // Update stock units
        await client.query(
          'UPDATE products SET stock_units = stock_units - $1 WHERE id = $2',
          [item.quantity, item.id]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({
        message: 'Order created',
        orderId,
        orderNumber,
        createdAt,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Failed to create order', error: err.message });
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// GET route to fetch all orders for a user
router.get('/user/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;

    const client = await pool.connect();
    try {
      const ordersResult = await client.query(
        `
        SELECT o.id, o.order_number, o.created_at, o.payment_method, o.shipping_info,
               o.subtotal_excl_vat, o.vat_amount, o.shipping_cost, o.total_amount, o.status
        FROM orders o
        WHERE o.user_id = $1
        ORDER BY o.created_at DESC
        `,
        [userId]
      );

      const orders = ordersResult.rows;
      const ordersWithItems = await Promise.all(orders.map(async (order) => {
        const itemsResult = await client.query(
          `
          SELECT oi.id, oi.product_id, oi.quantity, oi.unit_price, oi.vat_rate, oi.subtotal_excl_vat,
                 oi.cashback_amount, oi.product_name, oi.image_url, oi.product_code, oi.cashback_percent
          FROM order_items oi
          WHERE oi.order_id = $1
          `,
          [order.id]
        );
        return { ...order, items: itemsResult.rows };
      }));

      res.json(ordersWithItems);
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// GET route to fetch a specific order by ID
router.get('/:orderId', async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const client = await pool.connect();
    try {
      const orderResult = await client.query(
        `
        SELECT o.id, o.order_number, o.created_at, o.payment_method, o.payment_details, o.shipping_info,
               o.subtotal_excl_vat, o.vat_amount, o.shipping_cost, o.total_amount, o.status
        FROM orders o
        WHERE o.id = $1 AND (o.user_id = $2 OR $3 = 'admin')
        `,
        [orderId, req.user.id, req.user.role]
      );

      if (orderResult.rows.length === 0) {
        return res.status(404).json({ message: 'Order not found or unauthorized' });
      }

      const order = orderResult.rows[0];
      const itemsResult = await client.query(
        `
        SELECT oi.id, oi.product_id, oi.quantity, oi.unit_price, oi.vat_rate, oi.subtotal_excl_vat,
               oi.cashback_amount, oi.product_name, oi.image_url, oi.product_code, oi.cashback_percent
        FROM order_items oi
        WHERE oi.order_id = $1
        `,
        [orderId]
      );

      res.json({ ...order, items: itemsResult.rows });
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