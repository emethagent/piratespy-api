const express = require('express');
const { pool } = require('../db/pool');
const { fetchAdsCount } = require('../services/adsCountScraper');

const router = express.Router();

// POST /api/ads/quick-count — scrape + store count for a domain
router.post('/quick-count', async (req, res) => {
  const { domain, store = true } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });

  try {
    const { count, source } = await fetchAdsCount(domain);

    if (count === null) {
      return res.json({ success: false, domain, count: 0, source, error: 'Could not parse count' });
    }

    // Store in daily_ads_count (upsert per day)
    if (store) {
      await pool.query(`
        INSERT INTO daily_ads_count (domain, date, ads_count, active_count)
        VALUES ($1, CURRENT_DATE, $2, $2)
        ON CONFLICT (domain, date) DO UPDATE SET
          ads_count = EXCLUDED.ads_count,
          active_count = EXCLUDED.active_count,
          created_at = NOW()
      `, [domain, count]);
    }

    res.json({ success: true, domain, totalCount: count, source });
  } catch (err) {
    console.error(`Quick-count error for ${domain}:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/ads/history?domain=X&days=30 — time series for a domain
router.get('/history', async (req, res) => {
  const { domain, days = 30 } = req.query;
  if (!domain) return res.status(400).json({ error: 'domain required' });

  try {
    const { rows } = await pool.query(`
      SELECT date, ads_count, active_count
      FROM daily_ads_count
      WHERE domain = $1 AND date >= CURRENT_DATE - INTERVAL '${parseInt(days, 10)} days'
      ORDER BY date ASC
    `, [domain]);

    res.json({ domain, history: rows, count: rows.length });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
