const express = require('express');
const { pool } = require('../db/pool');
const { writeLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// POST /ads — save ads batch (from extension)
router.post('/', writeLimiter, async (req, res) => {
  const { ads, page, domain } = req.body;

  if (!ads || !Array.isArray(ads)) {
    return res.status(400).json({ error: 'ads array required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert page if provided
    if (page && page.page_id) {
      await client.query(`
        INSERT INTO meta_pages (page_id, page_name, page_category, likes, profile_photo, cover_photo, page_alias, page_url, raw_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (page_id) DO UPDATE SET
          page_name = COALESCE(EXCLUDED.page_name, meta_pages.page_name),
          page_category = COALESCE(EXCLUDED.page_category, meta_pages.page_category),
          likes = COALESCE(EXCLUDED.likes, meta_pages.likes),
          profile_photo = COALESCE(EXCLUDED.profile_photo, meta_pages.profile_photo),
          cover_photo = COALESCE(EXCLUDED.cover_photo, meta_pages.cover_photo),
          page_alias = COALESCE(EXCLUDED.page_alias, meta_pages.page_alias),
          page_url = COALESCE(EXCLUDED.page_url, meta_pages.page_url),
          raw_data = COALESCE(EXCLUDED.raw_data, meta_pages.raw_data),
          updated_at = NOW()
      `, [page.page_id, page.page_name, page.page_category, page.likes, page.profile_photo, page.cover_photo, page.page_alias, page.page_url, JSON.stringify(page.raw_data || null)]);
    }

    // Upsert domain if provided
    let domainId = null;
    if (domain && domain.domain) {
      const { rows } = await client.query(`
        INSERT INTO meta_domains (domain, is_shopify, shopify_theme, store_name, main_categories, language)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (domain) DO UPDATE SET
          is_shopify = COALESCE(EXCLUDED.is_shopify, meta_domains.is_shopify),
          shopify_theme = COALESCE(EXCLUDED.shopify_theme, meta_domains.shopify_theme),
          store_name = COALESCE(EXCLUDED.store_name, meta_domains.store_name),
          updated_at = NOW()
        RETURNING id
      `, [domain.domain, domain.is_shopify || false, domain.shopify_theme, domain.store_name, domain.main_categories || [], domain.language]);
      domainId = rows[0].id;
    }

    // Upsert each ad
    let saved = 0;
    for (const ad of ads) {
      if (!ad.ad_archive_id) continue;

      await client.query(`
        INSERT INTO meta_ads (ad_archive_id, page_id, collation_id, collation_count, domain_id, title, body, link_url, cta_text, eu_total_reach, start_date, end_date, is_active, platforms, media_assets, raw_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (ad_archive_id) DO UPDATE SET
          eu_total_reach = GREATEST(EXCLUDED.eu_total_reach, meta_ads.eu_total_reach),
          is_active = EXCLUDED.is_active,
          end_date = EXCLUDED.end_date,
          media_assets = COALESCE(EXCLUDED.media_assets, meta_ads.media_assets),
          raw_data = COALESCE(EXCLUDED.raw_data, meta_ads.raw_data),
          updated_at = NOW()
      `, [
        ad.ad_archive_id, ad.page_id, ad.collation_id, ad.collation_count || 1,
        domainId, ad.title, ad.body, ad.link_url, ad.cta_text,
        ad.eu_total_reach || 0,
        ad.start_date ? new Date(ad.start_date * 1000) : null,
        ad.end_date ? new Date(ad.end_date * 1000) : null,
        ad.is_active !== false,
        ad.platforms || [],
        JSON.stringify(ad.media_assets || []),
        JSON.stringify(ad.raw_data || null)
      ]);

      // Insert daily snapshot
      if (ad.eu_total_reach) {
        await client.query(`
          INSERT INTO meta_ads_snapshots (ad_archive_id, eu_total_reach, is_active, raw_aaa)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (ad_archive_id, snapshot_date) DO UPDATE SET
            eu_total_reach = GREATEST(EXCLUDED.eu_total_reach, meta_ads_snapshots.eu_total_reach),
            is_active = EXCLUDED.is_active,
            raw_aaa = COALESCE(EXCLUDED.raw_aaa, meta_ads_snapshots.raw_aaa)
        `, [ad.ad_archive_id, ad.eu_total_reach, ad.is_active !== false, JSON.stringify(ad.aaa_info || null)]);
      }

      saved++;
    }

    // Update collation groups
    const collations = {};
    for (const ad of ads) {
      if (!ad.collation_id || !ad.ad_archive_id) continue;
      if (!collations[ad.collation_id]) {
        collations[ad.collation_id] = { ads: [], totalReach: 0 };
      }
      collations[ad.collation_id].ads.push(ad.ad_archive_id);
      collations[ad.collation_id].totalReach += (ad.eu_total_reach || 0);
    }

    for (const [collationId, data] of Object.entries(collations)) {
      await client.query(`
        INSERT INTO meta_collation_groups (collation_id, primary_ad_id, ad_ids, total_count, total_audience)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (collation_id) DO UPDATE SET
          ad_ids = EXCLUDED.ad_ids,
          total_count = EXCLUDED.total_count,
          total_audience = GREATEST(EXCLUDED.total_audience, meta_collation_groups.total_audience),
          updated_at = NOW()
      `, [collationId, data.ads[0], data.ads, data.ads.length, data.totalReach]);
    }

    // Update page-domain mapping
    if (page?.page_id && domainId) {
      await client.query(`
        INSERT INTO meta_page_domains (page_id, domain_id, ads_count, last_seen)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (page_id, domain_id) DO UPDATE SET
          ads_count = EXCLUDED.ads_count,
          last_seen = NOW()
      `, [page.page_id, domainId, ads.length]);
    }

    await client.query('COMMIT');
    res.json({ saved, collations: Object.keys(collations).length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Save ads error:', err);
    res.status(500).json({ error: 'Failed to save ads' });
  } finally {
    client.release();
  }
});

// GET /ads?page_id=X&domain=X&active=true&limit=20
router.get('/', async (req, res) => {
  const { page_id, domain, active, limit = 50, offset = 0 } = req.query;

  let where = [];
  let params = [];
  let i = 1;

  if (page_id) { where.push(`a.page_id = $${i++}`); params.push(page_id); }
  if (domain) { where.push(`d.domain = $${i++}`); params.push(domain); }
  if (active !== undefined) { where.push(`a.is_active = $${i++}`); params.push(active === 'true'); }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

  try {
    const { rows } = await pool.query(`
      SELECT a.*, p.page_name, d.domain, d.is_shopify, d.shopify_theme
      FROM meta_ads a
      LEFT JOIN meta_pages p ON a.page_id = p.page_id
      LEFT JOIN meta_domains d ON a.domain_id = d.id
      ${whereClause}
      ORDER BY a.eu_total_reach DESC
      LIMIT $${i++} OFFSET $${i++}
    `, [...params, parseInt(limit), parseInt(offset)]);

    res.json({ ads: rows, count: rows.length });
  } catch (err) {
    console.error('Get ads error:', err);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
});

// GET /ads/:ad_archive_id/history — snapshots history
router.get('/:ad_archive_id/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM meta_ads_snapshots WHERE ad_archive_id = $1 ORDER BY snapshot_date DESC LIMIT 90',
      [req.params.ad_archive_id]
    );
    res.json({ snapshots: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
