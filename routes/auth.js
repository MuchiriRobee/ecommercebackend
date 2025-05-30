const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sendConfirmationEmail } = require('../utils/email');

const router = express.Router();

// Validation middleware for registration
const registerValidation = [
  body('email').isEmail().withMessage('Invalid email format'),
  body('phoneNumber').matches(/^[0-9]{9}$/).withMessage('Phone number must be 9 digits'),
  body('kraPin').matches(/^[A-Za-z0-9]{11}$/).withMessage('KRA PIN must be 11 alphanumeric characters'),
  body('name').notEmpty().withMessage('Name is required'),
  body('registrationType').isIn(['self', 'sales_agent']).withMessage('Invalid registration type'),
  body('userType').isIn(['individual', 'company']).withMessage('Invalid user type'),
  body('salesAgentId').optional().isInt().withMessage('Invalid sales agent ID').custom(async (value, { req }) => {
    if (req.body.registrationType === 'sales_agent' && !value) {
      throw new Error('Sales agent ID is required for sales agent registration');
    }
    if (value) {
      const result = await pool.query('SELECT id FROM sales_agents WHERE id = $1', [value]);
      if (result.rows.length === 0) {
        throw new Error('Invalid sales agent ID');
      }
    }
    return true;
  }),
];

// Get all sales agents
router.get('/sales-agents', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM sales_agents ORDER BY name');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Register endpoint
router.post('/register', registerValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    email,
    registrationType,
    userType,
    name,
    contactName,
    phoneNumber,
    cashbackPhoneNumber,
    kraPin,
    buildingName,
    floorNumber,
    roomNumber,
    streetName,
    areaName,
    city,
    country,
    salesAgentId,
  } = req.body;

  try {
    // Check if email already exists
    const emailCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Generate confirmation token
    const confirmationToken = crypto.randomBytes(32).toString('hex');

    // Insert user into database
    const result = await pool.query(
      `INSERT INTO users (
        email, registration_type, user_type, name, contact_name, phone_number, 
        cashback_phone_number, kra_pin, building_name, floor_number, room_number, 
        street_name, area_name, city, country, sales_agent_id, confirmation_token
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING id`,
      [
        email,
        registrationType,
        userType,
        name,
        contactName,
        phoneNumber,
        cashbackPhoneNumber,
        kraPin,
        buildingName,
        floorNumber,
        roomNumber,
        streetName,
        areaName,
        city,
        country,
        registrationType === 'sales_agent' ? salesAgentId : null,
        confirmationToken,
      ]
    );

    // Send confirmation email
    await sendConfirmationEmail(email, confirmationToken);

    res.status(201).json({ message: 'Registration successful. Please check your email to set your password.' });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Validate token endpoint
router.get('/confirm', async (req, res) => {
  const { token } = req.query;

  try {
    const result = await pool.query('SELECT * FROM users WHERE confirmation_token = $1', [token]);
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    res.status(200).json({ message: 'Token valid', email: result.rows[0].email });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Set password endpoint
router.post('/set-password', [
  body('token').notEmpty().withMessage('Token is required'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number')
    .matches(/[!@#$%^&*]/).withMessage('Password must contain at least one special character'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { token, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE confirmation_token = $1', [token]);
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    await pool.query(
      'UPDATE users SET password = $1, is_confirmed = TRUE, confirmation_token = NULL WHERE confirmation_token = $2',
      [hashedPassword, token]
    );

    res.status(200).json({ message: 'Password set successfully' });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  const { email, password, userType } = req.body;

  console.log('Received login request:', { email, userType });

  try {
    // Validate input
    if (!email || !password || !userType) {
      return res.status(400).json({ message: 'Email, password, and user type are required' });
    }

    if (userType !== 'customer') {
      return res.status(400).json({ message: 'Invalid user type for this endpoint' });
    }

    // Find user
    const userResult = await pool.query(
      'SELECT id, email, password, name, user_type FROM users WHERE email = $1 AND user_type IN ($2, $3)',
      [email, 'individual', 'company']
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = userResult.rows[0];

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, userType: 'customer' },
      process.env.JWT_SECRET || 'your_jwt_secret',
      { expiresIn: '1d' }
    );

    res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        userType: 'customer',
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ message: 'Server error during login' });
  }
});
module.exports = router;