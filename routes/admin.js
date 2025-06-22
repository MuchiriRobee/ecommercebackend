const express = require('express')
const router = express.Router()
const { authenticateAdmin } = require('./auth')
const pool = require('../config/db')

router.use(authenticateAdmin)

router.get('/dashboard', async (req, res) => {
  try {
    const usersCount = await pool.query('SELECT COUNT(*) FROM users')
    const agentsCount = await pool.query('SELECT COUNT(*) FROM sales_agents')
    const productsCount = await pool.query('SELECT COUNT(*) FROM products')
    
    res.status(200).json({
      users: usersCount.rows[0].count,
      salesAgents: agentsCount.rows[0].count,
      products: productsCount.rows[0].count
    })
  } catch (err) {
    console.error('Admin dashboard error:', err.stack)
    res.status(500).json({ message: 'Server error' })
  }
})
router.get('/verify', authenticateAdmin, (req, res) => {
  res.status(200).json({
    userType: req.user.userType,
    message: "Admin verification successful"
  })
})
module.exports = router