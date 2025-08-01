const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>
  
  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret', (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user; // Attach user data (id, email, userType)
    next();
  });
};

// GET /api/account/profile - Fetch user profile
router.get('/profile', authenticateToken, async (req, res) => {
  console.log('Received GET /api/account/profile for user:', req.user.id);
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT id, name, email, phone_number, contact_name, cashback_phone_number, 
       kra_pin, building_name, floor_number, room_number, street_name, area_name, 
       city, country 
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = result.rows[0];
    res.status(200).json({
      username: user.name,
      email: user.email,
      phone: user.phone_number,
      contact_name: user.contact_name,
      cashback_phone_number: user.cashback_phone_number,
      kra_pin: user.kra_pin,
      building_name: user.building_name,
      floor_number: user.floor_number,
      room_number: user.room_number,
      street_name: user.street_name,
      area_name: user.area_name,
      city: user.city,
      country: user.country,
    });
  } catch (err) {
    console.error('Error fetching profile:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/account/profile - Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  const {
    building_name,
    floor_number,
    room_number,
    street_name,
    area_name,
    city,
    country,
  } = req.body;
  const userId = req.user.id;

  try {
    // Validate input
    if (!building_name && !floor_number && !room_number && !street_name && !area_name && !city && !country) {
      return res.status(400).json({ message: 'At least one field must be provided for update' });
    }

    // Fetch current user data to retain non-editable fields
    const currentUser = await pool.query(
      `SELECT name, email, phone_number, contact_name, cashback_phone_number, kra_pin 
       FROM users WHERE id = $1`,
      [userId]
    );

    if (currentUser.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user with only editable fields
    const result = await pool.query(
      `UPDATE users 
       SET building_name = $1, floor_number = $2, room_number = $3, 
           street_name = $4, area_name = $5, city = $6, country = $7
       WHERE id = $8 
       RETURNING id, name, email, phone_number, contact_name, cashback_phone_number, 
                 kra_pin, building_name, floor_number, room_number, street_name, 
                 area_name, city, country`,
      [
        building_name || null,
        floor_number || null,
        room_number || null,
        street_name || null,
        area_name || null,
        city || null,
        country || null,
        userId,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const updatedUser = result.rows[0];
    res.status(200).json({
      username: updatedUser.name,
      email: updatedUser.email,
      phone: updatedUser.phone_number,
      contact_name: updatedUser.contact_name,
      cashback_phone_number: updatedUser.cashback_phone_number,
      kra_pin: updatedUser.kra_pin,
      building_name: updatedUser.building_name,
      floor_number: updatedUser.floor_number,
      room_number: updatedUser.room_number,
      street_name: updatedUser.street_name,
      area_name: updatedUser.area_name,
      city: updatedUser.city,
      country: updatedUser.country,
      message: 'Profile updated successfully',
    });
  } catch (err) {
    console.error('Error updating profile:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;