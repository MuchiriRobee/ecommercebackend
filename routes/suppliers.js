const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// Get all suppliers
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM suppliers');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a new supplier
router.post('/', async (req, res) => {
  const { name, code, email, telephone } = req.body;
  if (!name || !code || !email || !telephone) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  try {
    const { rows: existing } = await pool.query('SELECT * FROM suppliers WHERE code = $1', [code]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Supplier code must be unique' });
    }
    const { rows } = await pool.query(
      'INSERT INTO suppliers (name, code, email, telephone) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, code, email, telephone]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating supplier:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update a supplier
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, code, email, telephone } = req.body;
  if (!name || !code || !email || !telephone) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  try {
    const { rows: existing } = await pool.query('SELECT * FROM suppliers WHERE code = $1 AND id != $2', [code, id]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Supplier code must be unique' });
    }
    const { rows } = await pool.query(
      'UPDATE suppliers SET name = $1, code = $2, email = $3, telephone = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
      [name, code, email, telephone, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating supplier:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a supplier
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM suppliers WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    res.json({ message: 'Supplier deleted successfully' });
  } catch (error) {
    console.error('Error deleting supplier:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;