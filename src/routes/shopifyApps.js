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
      // Extract words (for partial matching)
      const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

      // Try multiple matching strategies:
      // 1. Exact normalized match (best)
      // 2. app_name is contained in search (e.g. "loox" in "loox reviews")
      // 3. Search is contained in app_name (e.g. "judgeme" in "judge-me-product-reviews")
      // 4. Any word from search matches app_name
      const wordPatterns = words.map((w) => `%${w}%`);

      const { rows } = await pool.query(`
        WITH candidates AS (
          SELECT
            app_name, app_url, review_count, review_rating, description,
            prices, categories, logo_url, developer_name, developer_mail,
            CASE
              -- Exact normalized match
              WHEN LOWER(REGEXP_REPLACE(app_name, '[^a-zA-Z0-9]', '', 'g')) = $1 THEN 100
              -- app_name fully contained in search
              WHEN $1 LIKE '%' || LOWER(REGEXP_REPLACE(app_name, '[^a-zA-Z0-9]', '', 'g')) || '%' THEN 90
              -- search fully contained in app_name
              WHEN LOWER(REGEXP_REPLACE(app_name, '[^a-zA-Z0-9]', '', 'g')) LIKE '%' || $1 || '%' THEN 80
              ELSE 0
            END AS score,
            CASE WHEN review_count IS NOT NULL AND review_count != '' AND review_count ~ '^[0-9]+$'
                 THEN CAST(review_count AS INTEGER) ELSE 0 END AS reviews
          FROM shopify_apps
          WHERE LOWER(REGEXP_REPLACE(app_name, '[^a-zA-Z0-9]', '', 'g')) LIKE '%' || $1 || '%'
             OR $1 LIKE '%' || LOWER(REGEXP_REPLACE(app_name, '[^a-zA-Z0-9]', '', 'g')) || '%'
             ${words.length > 0 ? `OR LOWER(app_name) ILIKE ANY($2::text[])` : ''}
        )
        SELECT * FROM candidates
        WHERE score > 0 OR reviews > 0
        ORDER BY score DESC, reviews DESC
        LIMIT 1
      `, words.length > 0 ? [normalized, wordPatterns] : [normalized]);

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
