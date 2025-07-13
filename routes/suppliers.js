const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// Generate supplier code based on name and sequence
const generateSupplierCode = async (name) => {
  const firstLetter = name.trim().charAt(0).toUpperCase();
  const { rows } = await pool.query(
    'SELECT code FROM suppliers WHERE code LIKE $1 ORDER BY code DESC LIMIT 1',
    [`${firstLetter}%`]
  );
  
  let sequence = 1;
  if (rows.length > 0) {
    const lastCode = rows[0].code;
    const lastSequence = parseInt(lastCode.slice(1)) || 0;
    sequence = lastSequence + 1;
  }
  return `${firstLetter}${sequence.toString().padStart(2, '0')}`;
};

// Get all suppliers (sorted alphabetically by name)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM suppliers ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a new supplier
router.post('/', async (req, res) => {
  const { 
    name, 
    email, 
    telephone, 
    telephone2, 
    contact_name, 
    contact_name2, 
    office, 
    floor, 
    building_name, 
    street_name, 
    city, 
    postal_address 
  } = req.body;
  
  if (!name || !email || !telephone || !contact_name || !office || !street_name || !city || !postal_address) {
    return res.status(400).json({ message: 'Required fields are missing' });
  }

  try {
    const code = await generateSupplierCode(name);
    const { rows } = await pool.query(
      'INSERT INTO suppliers (name, code, email, telephone, telephone2, contact_name, contact_name2, office, floor, building_name, street_name, city, postal_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *',
      [name, code, email, telephone, telephone2, contact_name, contact_name2, office, floor, building_name, street_name, city, postal_address]
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
  const { 
    name, 
    email, 
    telephone, 
    telephone2, 
    contact_name, 
    contact_name2, 
    office, 
    floor, 
    building_name, 
    street_name, 
    city, 
    postal_address 
  } = req.body;

  if (!name || !email || !telephone || !contact_name || !office || !street_name || !city || !postal_address) {
    return res.status(400).json({ message: 'Required fields are missing' });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE suppliers SET name = $1, email = $2, telephone = $3, telephone2 = $4, contact_name = $5, contact_name2 = $6, office = $7, floor = $8, building_name = $9, street_name = $10, city = $11, postal_address = $12, updated_at = CURRENT_TIMESTAMP WHERE id = $13 RETURNING *',
      [name, email, telephone, telephone2, contact_name, contact_name2, office, floor, building_name, street_name, city, postal_address, id]
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