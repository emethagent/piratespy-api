/**
 * Daily cron job: scrape ads count for all bookmarked domains
 * Run with: node src/workers/dailyAdsCount.js
 */
require('dotenv').config();
const { pool } = require('../db/pool');
const { fetchAdsCount } = require('../services/adsCountScraper');

const DELAY_MS = 2000;

async function main() {
  console.log('=== Daily ads count started ===');
  console.log('Date:', new Date().toISOString());

  // Get all unique bookmarked domains
  const { rows: domains } = await pool.query(`
    SELECT DISTINCT d.domain
    FROM user_bookmarks b
    JOIN meta_domains d ON b.domain_id = d.id
    WHERE d.domain IS NOT NULL AND d.domain != ''
    ORDER BY d.domain
  `);

  console.log(`Found ${domains.length} unique bookmarked domains`);

  let ok = 0, fail = 0;
  const start = Date.now();

  for (let i = 0; i < domains.length; i++) {
    const { domain } = domains[i];
    console.log(`[${i + 1}/${domains.length}] ${domain}`);

    try {
      const { count, source } = await fetchAdsCount(domain);

      if (count !== null) {
        await pool.query(`
          INSERT INTO daily_ads_count (domain, date, ads_count, active_count)
          VALUES ($1, CURRENT_DATE, $2, $2)
          ON CONFLICT (domain, date) DO UPDATE SET
            ads_count = EXCLUDED.ads_count,
            active_count = EXCLUDED.active_count
        `, [domain, count]);
        console.log(`  ✓ ${count} ads (${source})`);
        ok++;
      } else {
        console.log(`  ✗ no count found`);
        fail++;
      }
    } catch (err) {
      console.log(`  ✗ ${err.message}`);
      fail++;
    }

    if (i < domains.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  const duration = Math.round((Date.now() - start) / 1000);
  console.log(`\n=== Done: ${ok} ok, ${fail} failed, ${duration}s ===`);

  await pool.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
