const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sendConfirmationEmail, sendAgentConfirmationEmail, sendResetEmail } = require('../utils/email');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'Uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit for all files
  },
  fileFilter: (req, file, cb) => {
    const fileTypes = {
      agentPhoto: /jpeg|png/,
      idPhotoFront: /jpeg|png/,
      idPhotoBack: /jpeg|png/,
      kraCertificate: /pdf/,
    };
    const allowedType = fileTypes[file.fieldname];
    const extname = allowedType.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedType.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error(`Invalid file type for ${file.fieldname}. Allowed types: ${allowedType}`));
  },
});

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

// Generate agent code
const generateAgentCode = async (firstName, lastName) => {
  const firstInitial = firstName.charAt(0).toUpperCase();
  const lastInitial = lastName.charAt(0).toUpperCase();
  const result = await pool.query('SELECT COUNT(*) FROM sales_agents');
  const sequence = String(Number(result.rows[0].count) + 1).padStart(3, '0');
  return `${firstInitial}${lastInitial}${sequence}`;
};

// Get all sales agents
router.get('/sales-agents', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, first_name || \' \' || last_name AS name FROM sales_agents WHERE is_active = TRUE ORDER BY name');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching sales agents:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /auth/sales-agents - Register new sales agent
router.post(
  '/sales-agents',
  upload.fields([
    { name: 'agentPhoto', maxCount: 1 },
    { name: 'idPhotoFront', maxCount: 1 },
    { name: 'idPhotoBack', maxCount: 1 },
    { name: 'kraCertificate', maxCount: 1 },
  ]),
  async (req, res) => {
    const {
      first_name,
      last_name,
      email,
      phone_number,
      id_number,
      kra_pin,
      is_active = true,
    } = req.body;

    // Validate required fields
    if (!first_name || !last_name || !email || !phone_number || !id_number || !kra_pin) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    // Validate email format
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate phone number (starts with 07, 10 digits)
    if (!/^07\d{8}$/.test(phone_number)) {
      return res.status(400).json({ message: 'Phone number must start with 07 and be 10 digits' });
    }

    // Validate ID number (10 digits)
    if (!/^\d{8}$/.test(id_number)) {
      return res.status(400).json({ message: 'ID number must be exactly 10 digits' });
    }

    // Validate KRA PIN (10-11 alphanumeric characters)
    if (!/^[A-Za-z0-9]{10,11}$/.test(kra_pin)) {
      return res.status(400).json({ message: 'KRA PIN must be 10-11 alphanumeric characters' });
    }

    try {
      // Check for duplicate email or agent code
      const emailCheck = await pool.query('SELECT * FROM sales_agents WHERE email = $1', [email]);
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ message: 'Email already exists' });
      }

      const agent_code = await generateAgentCode(first_name, last_name);
      const agentCodeCheck = await pool.query('SELECT * FROM sales_agents WHERE agent_code = $1', [agent_code]);
      if (agentCodeCheck.rows.length > 0) {
        return res.status(400).json({ message: 'Agent code already exists' });
      }

      // Handle file uploads
      const agentPhoto = req.files['agentPhoto'] ? req.files['agentPhoto'][0].path : null;
      const idPhotoFront = req.files['idPhotoFront'] ? req.files['idPhotoFront'][0].path : null;
      const idPhotoBack = req.files['idPhotoBack'] ? req.files['idPhotoBack'][0].path : null;
      const kraCertificate = req.files['kraCertificate'] ? req.files['kraCertificate'][0].path : null;

      // Generate confirmation token
      const confirmation_token = uuidv4();

      // Insert into database
      const result = await pool.query(
        `INSERT INTO sales_agents (
          first_name, last_name, agent_code, email, phone_number, id_number, kra_pin,
          agent_photo, id_photo_front, id_photo_back, kra_certificate, is_active,
          confirmation_token, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
        RETURNING *`,
        [
          first_name,
          last_name,
          agent_code,
          email,
          phone_number,
          id_number,
          kra_pin,
          agentPhoto,
          idPhotoFront,
          idPhotoBack,
          kraCertificate,
          is_active,
          confirmation_token,
        ]
      );

      const agent = result.rows[0];

      // Send confirmation email
      await sendAgentConfirmationEmail(email, `${first_name} ${last_name}`, confirmation_token);

      res.status(201).json({ agent, message: 'Sales agent registered successfully' });
    } catch (error) {
      console.error('Error registering sales agent:', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// PUT /auth/sales-agents/:id - Update sales agent
router.put(
  '/sales-agents/:id',
  upload.fields([
    { name: 'agentPhoto', maxCount: 1 },
    { name: 'idPhotoFront', maxCount: 1 },
    { name: 'idPhotoBack', maxCount: 1 },
    { name: 'kraCertificate', maxCount: 1 },
  ]),
  async (req, res) => {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      email,
      phone_number,
      id_number,
      kra_pin,
      is_active,
    } = req.body;

    // Validate required fields
    if (!first_name || !last_name || !email || !phone_number || !id_number || !kra_pin) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    // Validate email format
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate phone number (starts with 07, 10 digits)
    if (!/^07\d{8}$/.test(phone_number)) {
      return res.status(400).json({ message: 'Phone number must start with 07 and be 10 digits' });
    }

    // Validate ID number (10 digits)
    if (!/^\d{8}$/.test(id_number)) {
      return res.status(400).json({ message: 'ID number must be exactly 10 digits' });
    }

    // Validate KRA PIN (10-11 alphanumeric characters)
    if (!/^[A-Za-z0-9]{10,11}$/.test(kra_pin)) {
      return res.status(400).json({ message: 'KRA PIN must be 10-11 alphanumeric characters' });
    }

    try {
      // Check if agent exists
      const agentCheck = await pool.query('SELECT * FROM sales_agents WHERE id = $1', [id]);
      if (agentCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Sales agent not found' });
      }

      // Check for duplicate email (excluding current agent)
      const emailCheck = await pool.query('SELECT * FROM sales_agents WHERE email = $1 AND id != $2', [email, id]);
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ message: 'Email already exists' });
      }

      // Handle file uploads
      const agentPhoto = req.files['agentPhoto'] ? req.files['agentPhoto'][0].path : agentCheck.rows[0].agent_photo;
      const idPhotoFront = req.files['idPhotoFront'] ? req.files['idPhotoFront'][0].path : agentCheck.rows[0].id_photo_front;
      const idPhotoBack = req.files['idPhotoBack'] ? req.files['idPhotoBack'][0].path : agentCheck.rows[0].id_photo_back;
      const kraCertificate = req.files['kraCertificate'] ? req.files['kraCertificate'][0].path : agentCheck.rows[0].kra_certificate;

      // Update agent in database
      const result = await pool.query(
        `UPDATE sales_agents SET
          first_name = $1,
          last_name = $2,
          email = $3,
          phone_number = $4,
          id_number = $5,
          kra_pin = $6,
          agent_photo = $7,
          id_photo_front = $8,
          id_photo_back = $9,
          kra_certificate = $10,
          is_active = $11,
          updated_at = NOW()
        WHERE id = $12
        RETURNING *`,
        [
          first_name,
          last_name,
          email,
          phone_number,
          id_number,
          kra_pin,
          agentPhoto,
          idPhotoFront,
          idPhotoBack,
          kraCertificate,
          is_active,
          id,
        ]
      );

      const agent = result.rows[0];
      res.status(200).json({ agent, message: 'Sales agent updated successfully' });
    } catch (error) {
      console.error('Error updating sales agent:', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// DELETE /auth/sales-agents/:id - Delete a sales agent
router.delete('/sales-agents/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Check if agent exists
    const agentCheck = await pool.query('SELECT * FROM sales_agents WHERE id = $1', [id]);
    if (agentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Sales agent not found' });
    }

    // Delete agent
    await pool.query('DELETE FROM sales_agents WHERE id = $1', [id]);
    res.status(200).json({ message: 'Sales agent deleted successfully' });
  } catch (error) {
    console.error('Error deleting sales agent:', error);
    res.status(500).json({ message: 'Server error' });
  }
});
// Fetch user details
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT email, name, phone_number, street_name, city, country, cashback_phone_number FROM users WHERE id = $1 AND user_type IN ($2, $3)',
      [req.user.id, 'individual', 'company']
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Fetch user error:', err.stack);
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
    const userResult = await pool.query(
      'SELECT email FROM users WHERE confirmation_token = $1',
      [token]
    );
    const agentResult = await pool.query(
      'SELECT email FROM sales_agents WHERE confirmation_token = $1',
      [token]
    );

    if (userResult.rows.length === 0 && agentResult.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const email = userResult.rows[0]?.email || agentResult.rows[0]?.email;
    res.status(200).json({ message: 'Token valid', email });
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
    const userResult = await pool.query('SELECT * FROM users WHERE confirmation_token = $1', [token]);
    const agentResult = await pool.query('SELECT * FROM sales_agents WHERE confirmation_token = $1', [token]);

    if (userResult.rows.length === 0 && agentResult.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    if (userResult.rows.length > 0) {
      await pool.query(
        'UPDATE users SET password = $1, is_confirmed = TRUE, confirmation_token = NULL WHERE confirmation_token = $2',
        [hashedPassword, token]
      );
    } else {
      await pool.query(
        'UPDATE sales_agents SET password = $1, is_confirmed = TRUE, confirmation_token = NULL WHERE confirmation_token = $2',
        [hashedPassword, token]
      );
    }

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
    const agentResult = await pool.query('SELECT id, email, first_name || \' \' || last_name AS name FROM sales_agents WHERE email = $1', [email]);

    if (userResult.rows.length === 0 && agentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Email not found' });
    }

    const user = userResult.rows[0] || agentResult.rows[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry

    // Store reset token and expiry in database
    if (userResult.rows.length > 0) {
      await pool.query(
        'UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE email = $3',
        [resetToken, resetTokenExpiry, email]
      );
    } else {
      await pool.query(
        'UPDATE sales_agents SET reset_token = $1, reset_token_expiry = $2 WHERE email = $3',
        [resetToken, resetTokenExpiry, email]
      );
    }

    // Send reset email
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

    const userResult = await pool.query(
      'SELECT email, reset_token_expiry FROM users WHERE reset_token = $1',
      [token]
    );
    const agentResult = await pool.query(
      'SELECT email, reset_token_expiry FROM sales_agents WHERE reset_token = $1',
      [token]
    );

    if (userResult.rows.length === 0 && agentResult.rows.length === 0) {
      console.log('No user or agent found with token:', token);
      return res.status(400).json({ message: 'Invalid token' });
    }

    const { email, reset_token_expiry } = userResult.rows[0] || agentResult.rows[0];
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
    const userResult = await pool.query(
      'SELECT * FROM users WHERE reset_token = $1 AND reset_token_expiry > NOW()',
      [token]
    );
    const agentResult = await pool.query(
      'SELECT * FROM sales_agents WHERE reset_token = $1 AND reset_token_expiry > NOW()',
      [token]
    );

    if (userResult.rows.length === 0 && agentResult.rows.length === 0) {
      console.log('Invalid or expired token during reset:', token);
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Update password and clear reset token
    if (userResult.rows.length > 0) {
      await pool.query(
        'UPDATE users SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE reset_token = $2',
        [hashedPassword, token]
      );
    } else {
      await pool.query(
        'UPDATE sales_agents SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE reset_token = $2',
        [hashedPassword, token]
      );
    }

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
      'SELECT id, email, first_name || \' \' || last_name AS name, password, is_active, is_confirmed FROM sales_agents WHERE email = $1',
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

    // Check if agent is confirmed
    if (!agent.is_confirmed) {
      return res.status(403).json({ message: 'Account is not confirmed. Please set your password.' });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) {
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
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { email, password } = req.body;

  try {
    const adminResult = await pool.query(
      'SELECT id, email, name, password FROM admins WHERE email = $1',
      [email]
    );

    if (adminResult.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const admin = adminResult.rows[0];

    const token = jwt.sign(
      { id: admin.id, email: admin.email, userType: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(200).json({
      token,
      user: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        userType: 'admin',
      },
    });
  } catch (err) {
    console.error('Admin login error:', err.message);
    res.status(500).json({ message: 'Server error during login' });
  }
});

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
    // Check if user is a regular user or sales agent
    let userResult = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
    let userType = 'user';
    if (userResult.rows.length === 0) {
      userResult = await pool.query('SELECT password FROM sales_agents WHERE id = $1', [userId]);
      userType = 'sales_agent';
    }

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
    if (userType === 'user') {
      await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);
    } else {
      await pool.query('UPDATE sales_agents SET password = $1 WHERE id = $2', [hashedPassword, userId]);
    }

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