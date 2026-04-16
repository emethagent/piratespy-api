const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// GET /api/bookmarks — list user's bookmarked domains
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        b.id, b.tags, b.notes, b.notify_discord, b.notify_email,
        b.created_at AS bookmarked_at, b.updated_at,
        d.id AS domain_id, d.domain, d.store_name, d.is_shopify,
        d.shopify_theme, d.main_categories, d.language
      FROM user_bookmarks b
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
  const { domain, store_name, is_shopify, shopify_theme, tags, notes } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert domain
    const { rows: [domainRow] } = await client.query(`
      INSERT INTO meta_domains (domain, store_name, is_shopify, shopify_theme)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (domain) DO UPDATE SET
        store_name = COALESCE(EXCLUDED.store_name, meta_domains.store_name),
        is_shopify = COALESCE(EXCLUDED.is_shopify, meta_domains.is_shopify),
        shopify_theme = COALESCE(EXCLUDED.shopify_theme, meta_domains.shopify_theme),
        updated_at = NOW()
      RETURNING id, domain, store_name, is_shopify
    `, [domain, store_name, is_shopify || false, shopify_theme]);

    // Add bookmark with optional tags/notes
    const { rows: [bookmarkRow] } = await client.query(`
      INSERT INTO user_bookmarks (user_id, domain_id, tags, notes)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, domain_id) DO UPDATE SET
        tags = COALESCE(EXCLUDED.tags, user_bookmarks.tags),
        notes = COALESCE(EXCLUDED.notes, user_bookmarks.notes),
        updated_at = NOW()
      RETURNING id, tags, notes, created_at
    `, [req.user.id, domainRow.id, tags || [], notes]);

    await client.query('COMMIT');
    res.json({ ok: true, bookmark: { ...bookmarkRow, ...domainRow } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Add bookmark error:', err);
    res.status(500).json({ error: 'Failed to bookmark' });
  } finally {
    client.release();
  }
});

// PATCH /api/bookmarks/:id — update tags/notes/notifications
router.patch('/:id', async (req, res) => {
  const { tags, notes, notify_discord, notify_email } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE user_bookmarks
      SET
        tags = COALESCE($1, tags),
        notes = COALESCE($2, notes),
        notify_discord = COALESCE($3, notify_discord),
        notify_email = COALESCE($4, notify_email),
        updated_at = NOW()
      WHERE id = $5 AND user_id = $6
      RETURNING *
    `, [tags, notes, notify_discord, notify_email, req.params.id, req.user.id]);

    if (rows.length === 0) return res.status(404).json({ error: 'Bookmark not found' });
    res.json({ ok: true, bookmark: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update bookmark' });
  }
});

// DELETE /api/bookmarks/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM user_bookmarks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Bookmark not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove bookmark' });
  }
});

module.exports = router;
