const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// POST /api/apps/data — enrich detected apps with our DB
router.post('/data', async (req, res) => {
  const { apps } = req.body;

  if (!apps || !Array.isArray(apps)) {
    return res.status(400).json({ success: false, error: 'apps array required' });
  }

  try {
    const enriched = [];

    for (const app of apps) {
      const name = app.name || app.app_name || '';
      if (!name) {
        enriched.push({ ...app, enriched: false });
        continue;
      }

      const normalized = normalize(name);

      // Search by normalized name match
      const { rows } = await pool.query(`
        SELECT app_name, app_url, review_count, review_rating, description,
               prices, categories, logo_url, developer_name, developer_mail
        FROM shopify_apps
        WHERE LOWER(REGEXP_REPLACE(app_name, '[^a-zA-Z0-9]', '', 'g')) LIKE $1
        ORDER BY
          CASE WHEN LOWER(REGEXP_REPLACE(app_name, '[^a-zA-Z0-9]', '', 'g')) = $2 THEN 0 ELSE 1 END,
          CASE WHEN review_count IS NOT NULL AND review_count != '' THEN CAST(review_count AS INTEGER) ELSE 0 END DESC
        LIMIT 1
      `, [`%${normalized}%`, normalized]);

      if (rows.length > 0) {
        const data = rows[0];
        enriched.push({
          ...app,
          enriched: true,
          rating: data.review_rating,
          reviewCount: data.review_count,
          description: data.description,
          prices: data.prices,
          categories: data.categories,
          logoUrl: data.logo_url,
          appUrl: data.app_url,
          developer: { name: data.developer_name, email: data.developer_mail },
          matchedWith: data.app_name,
        });
      } else {
        enriched.push({ ...app, enriched: false });
      }
    }

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Apps enrich error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

module.exports = router;
