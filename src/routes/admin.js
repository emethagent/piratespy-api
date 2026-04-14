const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAdmin);

// POST /admin/invite — generate invite code
router.post('/invite', async (req, res) => {
  const { expires_in_days } = req.body;

  const code = 'PS-' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const expiresAt = expires_in_days ? new Date(Date.now() + expires_in_days * 86400000) : null;

  try {
    await pool.query(
      'INSERT INTO invite_codes (code, created_by, expires_at) VALUES ($1, $2, $3)',
      [code, req.user.id, expiresAt]
    );
    res.json({ code, expires_at: expiresAt });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

// GET /admin/users
router.get('/users', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, email, role, created_at FROM users ORDER BY created_at DESC');
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [ads, pages, domains, snapshots] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM meta_ads'),
      pool.query('SELECT COUNT(*) as count FROM meta_pages'),
      pool.query('SELECT COUNT(*) as count FROM meta_domains'),
      pool.query('SELECT COUNT(*) as count FROM meta_ads_snapshots'),
    ]);
    res.json({
      ads: parseInt(ads.rows[0].count),
      pages: parseInt(pages.rows[0].count),
      domains: parseInt(domains.rows[0].count),
      snapshots: parseInt(snapshots.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
