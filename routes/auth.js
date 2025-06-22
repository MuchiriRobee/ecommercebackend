const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sendConfirmationEmail, sendResetEmail } = require('../utils/email');

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

// Middleware to verify JWT
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Token verification error:', err.message);
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

// Middleware to verify Admin
const authenticateAdmin = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.userType !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const admin = await pool.query('SELECT id FROM admins WHERE id = $1', [decoded.id]);
    if (admin.rows.length === 0) {
      return res.status(403).json({ message: 'Admin not found' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    console.error('Admin token verification error:', err);
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

// Get all sales agents
router.get('/sales-agents', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM sales_agents WHERE is_active = TRUE ORDER BY name');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching sales agents:', err.stack);
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
    console.error('Registration error:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Validate token endpoint
router.get('/confirm', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ message: 'Token is required' });
  }

  try {
    const result = await pool.query(
      'SELECT email FROM users WHERE confirmation_token = $1',
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    res.status(200).json({ message: 'Token valid', email: result.rows[0].email });
  } catch (err) {
    console.error('Token validation error:', err.stack);
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
    console.error('Set password error:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Forgot password endpoint
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Invalid email format'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email } = req.body;

  try {
    // Check if email exists
    const userResult = await pool.query('SELECT id, email, name FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Email not found' });
    }

    const user = userResult.rows[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry

    // Store reset token and expiry in database
    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE email = $3',
      [resetToken, resetTokenExpiry, email]
    );

    // Send reset email
    console.log('Generated reset token:', resetToken);
    await sendResetEmail(email, user.name || 'User', resetToken);

    res.status(200).json({ message: 'Password reset email sent. Please check your inbox.' });
  } catch (err) {
    console.error('Forgot password error:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Verify reset token endpoint
router.get('/verify-reset-token', async (req, res) => {
  const { token } = req.query;

  try {
    if (!token) {
      console.log('No token provided in verify-reset-token request');
      return res.status(400).json({ message: 'Token is required' });
    }

    console.log('Verifying reset token:', token);

    const result = await pool.query(
      'SELECT email, reset_token_expiry FROM users WHERE reset_token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      console.log('No user found with token:', token);
      return res.status(400).json({ message: 'Invalid token' });
    }

    const { email, reset_token_expiry } = result.rows[0];
    const now = new Date();

    if (reset_token_expiry < now) {
      console.log('Token expired for email:', email, 'Expiry:', reset_token_expiry);
      return res.status(400).json({ message: 'Token expired' });
    }

    console.log('Token valid for email:', email);
    res.status(200).json({ message: 'Token valid', email });
  } catch (err) {
    console.error('Verify reset token error:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reset password endpoint
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Token is required'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number')
    .matches(/[!@#$%^&*]/).withMessage('Password must contain at least one special character'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error('Passwords do not match');
    }
    return true;
  }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { token, password } = req.body;

  try {
    // Verify token and check expiry
    const result = await pool.query(
      'SELECT * FROM users WHERE reset_token = $1 AND reset_token_expiry > NOW()',
      [token]
    );
    if (result.rows.length === 0) {
      console.log('Invalid or expired token during reset:', token);
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Update password and clear reset token
    await pool.query(
      'UPDATE users SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE reset_token = $2',
      [hashedPassword, token]
    );

    console.log('Password reset successful for token:', token);
    res.status(200).json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Customer login endpoint
router.post('/login', [
  body('email').isEmail().withMessage('Invalid email format'),
  body('password').notEmpty().withMessage('Password is required'),
  body('userType').equals('customer').withMessage('Invalid user type'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { email, password, userType } = req.body;

  console.log('Received customer login request:', { email, userType });

  try {
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
    console.error('Customer login error:', err.message);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Sales agent login endpoint
router.post('/sales-agent-login', [
  body('email').isEmail().withMessage('Invalid email format'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { email, password } = req.body;

  console.log('Received sales agent login request:', { email });

  try {
    // Find sales agent
    const agentResult = await pool.query(
      'SELECT id, email, name, password, is_active FROM sales_agents WHERE email = $1',
      [email]
    );

    if (agentResult.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const agent = agentResult.rows[0];

    // Check if agent is active
    if (!agent.is_active) {
      return res.status(403).json({ message: 'Account is not active' });
    }

    // Compare password (plain text for now)
    if (password !== agent.password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: agent.id, email: agent.email, userType: 'sales_agent' },
      process.env.JWT_SECRET || 'your_jwt_secret',
      { expiresIn: '1d' }
    );

    res.status(200).json({
      token,
      user: {
        id: agent.id,
        email: agent.email,
        name: agent.name,
        userType: 'sales_agent',
      },
    });
  } catch (err) {
    console.error('Sales agent login error:', err.message);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Admin login endpoint
router.post('/admin-login', [
  body('email').isEmail().withMessage('Invalid email format'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg })
  }

  const { email, password } = req.body

  try {
    const adminResult = await pool.query(
      'SELECT id, email, name, password FROM admins WHERE email = $1',
      [email]
    )

    if (adminResult.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    const admin = adminResult.rows[0]

    if (password !== admin.password) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, userType: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    )

    res.status(200).json({
      token,
      user: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        userType: 'admin',
      },
    })
  } catch (err) {
    console.error('Admin login error:', err.message)
    res.status(500).json({ message: 'Server error during login' })
  }
})

// Change password endpoint
router.post('/change-password', [
  authenticateToken,
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('New password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('New password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('New password must contain at least one number')
    .matches(/[!@#$%^&*]/).withMessage('New password must contain at least one special character'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  try {
    // Fetch user
    const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect current password' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);

    console.log('Password changed successfully for user ID:', userId);
    res.status(200).json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = {
  router,
  authenticateToken,
  authenticateAdmin
};