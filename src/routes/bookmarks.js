const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// GET /api/bookmarks — list user's bookmarked domains
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.id, d.domain, d.store_name, d.is_shopify, d.shopify_theme, d.main_categories,
             b.created_at as bookmarked_at
      FROM user_followed_brands b
      JOIN meta_domains d ON b.domain_id = d.id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC
    `, [req.user.id]);

    res.json({ bookmarks: rows, count: rows.length });
  } catch (err) {
    console.error('Get bookmarks error:', err);
    res.status(500).json({ error: 'Failed to fetch bookmarks' });
  }
});

// POST /api/bookmarks — add a bookmark by domain
router.post('/', async (req, res) => {
  const { domain, store_name, is_shopify } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert domain
    const { rows: [domainRow] } = await client.query(`
      INSERT INTO meta_domains (domain, store_name, is_shopify)
      VALUES ($1, $2, $3)
      ON CONFLICT (domain) DO UPDATE SET
        store_name = COALESCE(EXCLUDED.store_name, meta_domains.store_name),
        is_shopify = COALESCE(EXCLUDED.is_shopify, meta_domains.is_shopify),
        updated_at = NOW()
      RETURNING id, domain, store_name, is_shopify
    `, [domain, store_name, is_shopify || false]);

    // Add bookmark
    await client.query(`
      INSERT INTO user_followed_brands (user_id, domain_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, domain_id) DO NOTHING
    `, [req.user.id, domainRow.id]);

    await client.query('COMMIT');
    res.json({ ok: true, bookmark: domainRow });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Add bookmark error:', err);
    res.status(500).json({ error: 'Failed to bookmark' });
  } finally {
    client.release();
  }
});

// DELETE /api/bookmarks/:domainId
router.delete('/:domainId', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM user_followed_brands WHERE user_id = $1 AND domain_id = $2',
      [req.user.id, req.params.domainId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove bookmark' });
  }
});

module.exports = router;
