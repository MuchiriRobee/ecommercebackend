const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `profile-${req.user.id}-${uniqueSuffix}${path.extname(file.originalname)}`);
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
    cb(new Error('Only JPEG and PNG images are allowed'));
  },
});

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
      'SELECT id, name, email, phone_number, area_name, city, profile_picture FROM users WHERE id = $1',
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
      address: user.area_name && user.city ? `${user.area_name}, ${user.city}` : '',
      profilePicture: user.profile_picture ? `/uploads/${user.profile_picture}` : null,
    });
  } catch (err) {
    console.error('Error fetching profile:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/account/profile - Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  const { username, email, phone, address } = req.body;
  const userId = req.user.id;

  try {
    // Validate input
    if (!username || !email || !phone) {
      return res.status(400).json({ message: 'Username, email, and phone are required' });
    }

    // Split address into area_name and city (assuming format: "Area, City")
    let area_name = null;
    let city = null;
    if (address) {
      const [area, cityPart] = address.split(',').map(s => s.trim());
      area_name = area || null;
      city = cityPart || null;
    }

    // Check if email is already used by another user
    const emailCheck = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [email, userId]
    );
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Email is already in use' });
    }

    // Update user
    const result = await pool.query(
      `UPDATE users 
       SET name = $1, email = $2, phone_number = $3, area_name = $4, city = $5 
       WHERE id = $6 
       RETURNING id, name, email, phone_number, area_name, city`,
      [username, email, phone, area_name, city, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const updatedUser = result.rows[0];
    res.status(200).json({
      username: updatedUser.name,
      email: updatedUser.email,
      phone: updatedUser.phone_number,
      address: updatedUser.area_name && updatedUser.city ? `${updatedUser.area_name}, ${updatedUser.city}` : '',
      message: 'Profile updated successfully',
    });
  } catch (err) {
    console.error('Error updating profile:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/account/profile/picture - Upload profile picture
router.post('/profile/picture', authenticateToken, upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const userId = req.user.id;
    const profilePicturePath = req.file.filename;

    // Delete old profile picture if exists
    const oldPicture = await pool.query(
      'SELECT profile_picture FROM users WHERE id = $1',
      [userId]
    );
    if (oldPicture.rows[0]?.profile_picture) {
      const oldPath = path.join(uploadDir, oldPicture.rows[0].profile_picture);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // Update profile picture
    await pool.query(
      'UPDATE users SET profile_picture = $1 WHERE id = $2',
      [profilePicturePath, userId]
    );

    res.status(200).json({
      profilePicture: `/uploads/${profilePicturePath}`,
      message: 'Profile picture updated successfully',
    });
  } catch (err) {
    console.error('Error uploading profile picture:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/account/profile/picture - Remove profile picture
router.delete('/profile/picture', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get current profile picture
    const result = await pool.query(
      'SELECT profile_picture FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const profilePicture = result.rows[0].profile_picture;
    if (profilePicture) {
      // Delete file from server
      const filePath = path.join(uploadDir, profilePicture);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Update database
      await pool.query(
        'UPDATE users SET profile_picture = NULL WHERE id = $1',
        [userId]
      );
    }

    res.status(200).json({ message: 'Profile picture removed successfully' });
  } catch (err) {
    console.error('Error removing profile picture:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;