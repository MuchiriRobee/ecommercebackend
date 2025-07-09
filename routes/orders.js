const express = require('express');
const axios = require('axios');
const pool = require('../config/db');
const { authenticateToken } = require('./auth');

const router = express.Router();

// Helper function to generate Base64-encoded Basic Auth credentials
const getBasicAuth = () => {
  const clientId = process.env.KCB_BUNI_CLIENT_ID;
  const clientSecret = process.env.KCB_BUNI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('KCB_BUNI_CLIENT_ID or KCB_BUNI_CLIENT_SECRET not set in .env');
  }
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
};

// Helper function to get KCB Buni access token
const getAccessToken = async () => {
  try {
    const response = await axios.post(
      'https://uat.buni.kcbgroup.com/token',
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${getBasicAuth()}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    console.log('Access token retrieved:', response.data.access_token);
    return response.data.access_token;
  } catch (error) {
    console.error('Error fetching access token:', error.response?.data || error.message);
    throw new Error('Failed to authenticate with KCB Buni');
  }
};

// POST /api/orders - Create order and initiate STK Push
router.post('/', authenticateToken, async (req, res) => {
  const {
    cartItems,
    shippingInfo,
    paymentMethod,
    mpesaPhone,
    orderNumber,
    total,
    shippingCost,
    vatAmount,
    totalCashback,
  } = req.body;

  // Validate request
  if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
    return res.status(400).json({ message: 'Cart items are required' });
  }
  if (!shippingInfo || !paymentMethod || !orderNumber || !total || !shippingCost || !vatAmount || !totalCashback) {
    return res.status(400).json({ message: 'Missing required order details' });
  }
  if (paymentMethod === 'mpesa' && (!mpesaPhone || !/^0[0-9]{9}$/.test(mpesaPhone))) {
    return res.status(400).json({ message: 'Invalid M-Pesa phone number' });
  }

  try {
    // Insert order into database
    const result = await pool.query(
      `INSERT INTO orders (
        user_id, order_number, cart_items, shipping_info, payment_method, mpesa_phone,
        total, shipping_cost, vat_amount, total_cashback, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        req.user.id,
        orderNumber,
        JSON.stringify(cartItems),
        JSON.stringify(shippingInfo),
        paymentMethod,
        paymentMethod === 'mpesa' ? mpesaPhone : null,
        total,
        shippingCost,
        vatAmount,
        totalCashback,
        'pending',
      ]
    );
    const orderId = result.rows[0].id;

    if (paymentMethod === 'mpesa') {
      // Initiate STK Push
      const accessToken = await getAccessToken();
      const stkPushPayload = {
        phoneNumber: mpesaPhone,
        amount: total + shippingCost,
        invoiceNumber: orderNumber,
        callbackUrl: process.env.KCB_BUNI_CALLBACK_URL || 'https://your-callback-url.com/api/orders/callback',
      };

      console.log('Sending STK Push request:', stkPushPayload);
      const stkResponse = await axios.post(
        'https://uat.buni.kcbgroup.com/mm/api/request/1.0.0/stkpush',
        stkPushPayload,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('STK Push response:', stkResponse.data);

      // Update order with STK Push details
      await pool.query(
        `UPDATE orders SET merchant_request_id = $1, checkout_request_id = $2, status = $3
        WHERE id = $4`,
        [
          stkResponse.data.merchantRequestID,
          stkResponse.data.checkoutRequestID || stkResponse.data.merchantRequestID,
          'initiated',
          orderId,
        ]
      );

      return res.status(201).json({
        message: 'Order created and STK Push initiated',
        orderId,
        merchantRequestID: stkResponse.data.merchantRequestID,
        transactionStatus: stkResponse.data.transactionStatus,
      });
    }

    // Non-M-Pesa orders
    return res.status(201).json({
      message: 'Order created successfully',
      orderId,
    });
  } catch (error) {
    console.error('Error creating order:', error.response?.data || error.message);
    return res.status(500).json({ message: 'Failed to create order' });
  }
});

// GET /api/orders/:orderId - Get order status
router.get('/:orderId', authenticateToken, async (req, res) => {
  const { orderId } = req.params;

  try {
    const result = await pool.query(
      `SELECT status FROM orders WHERE id = $1 AND user_id = $2`,
      [orderId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    return res.status(200).json({ status: result.rows[0].status });
  } catch (error) {
    console.error('Error fetching order status:', error.message);
    return res.status(500).json({ message: 'Failed to fetch order status' });
  }
});

// POST /api/orders/callback - Handle M-Pesa callback
router.post('/callback', async (req, res) => {
  const callbackData = req.body;
  console.log('M-Pesa Callback:', callbackData);

  try {
    const { merchantRequestID, resultCode, resultDesc, checkoutRequestID } = callbackData;
    if (!merchantRequestID) {
      return res.status(400).json({ message: 'Invalid callback data' });
    }

    const status = resultCode === '0' ? 'completed' : 'failed';
    await pool.query(
      `UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE merchant_request_id = $2`,
      [status, merchantRequestID]
    );

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Notification received successfully',
    });
  } catch (error) {
    console.error('Error processing callback:', error.message);
    return res.status(500).json({ message: 'Failed to process callback' });
  }
});

// GET /api/orders/callback - Handle incorrect GET requests (for debugging)
router.get('/callback', (req, res) => {
  console.log('Received GET request to /api/orders/callback:', req.query);
  return res.status(405).json({ message: 'Method Not Allowed. Use POST for M-Pesa callback.' });
});

module.exports = router;