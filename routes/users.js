const express = require('express');
const pool = require('../config/db');
const router = express.Router();

// GET route to fetch all users (self-registered and sales agent-registered)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, email, user_code, phone_number, street_name, city, country, created_at
      FROM users
      WHERE user_type IN ('individual', 'company')
      ORDER BY name
    `);
    res.status(200).json({ users: result.rows });
  } catch (err) {
    console.error('Error fetching users:', err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Error handling middleware
router.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!', error: err.message });
});

module.exports = router;