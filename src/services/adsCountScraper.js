/**
 * Scrapes Facebook Ads Library to get ads count for a domain
 * Uses Puppeteer with IPRoyal residential proxy
 */
const puppeteer = require('puppeteer');

const IPROYAL_USER = process.env.IPROYAL_USER || 'tcZa2CIDmqVr37Hx';
const IPROYAL_PASS = process.env.IPROYAL_PASS || 'OyCsoblVVvZ0HG43';
const IPROYAL_HOST = process.env.IPROYAL_HOST || 'geo.iproyal.com';
const IPROYAL_PORT = process.env.IPROYAL_PORT || '12321';

async function fetchAdsCount(domain) {
  const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${encodeURIComponent(domain)}&sort_data[direction]=desc&sort_data[mode]=relevancy_monthly_grouped`;

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      `--proxy-server=http://${IPROYAL_HOST}:${IPROYAL_PORT}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  try {
    const page = await browser.newPage();

    // Auth proxy
    await page.authenticate({
      username: IPROYAL_USER,
      password: IPROYAL_PASS,
    });

    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    // Block only images/media (keep stylesheets + scripts for React rendering)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) return req.abort();
      req.continue();
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

    // Wait for results heading (React renders async)
    try {
      await page.waitForFunction(
        () => {
          const h = document.querySelector('div[role="heading"][aria-level="3"]');
          if (h && /\d/.test(h.textContent)) return true;
          return /~?\d[\d\s,.]*\s*(?:résultats?|results?)/i.test(document.body.innerText);
        },
        { timeout: 15000 }
      );
    } catch {
      // Fallback — proceed with whatever we have
    }

    // Extract count from multiple strategies
    const result = await page.evaluate(() => {
      // Strategy 1: aria-level=3 heading "650 résultats"
      const heading = document.querySelector('div[role="heading"][aria-level="3"]');
      if (heading) {
        const match = heading.textContent.match(/~?([\d\s,.]+)\s*(?:résultats?|results?)/i);
        if (match) {
          const count = parseInt(match[1].replace(/[\s,.]/g, ''), 10);
          if (!isNaN(count)) return { count, source: 'heading', text: heading.textContent.trim() };
        }
      }

      // Strategy 2: any "X résultats" text in the page
      const bodyText = document.body.innerText;
      const fuzzy = bodyText.match(/~?(\d[\d\s,.]*)\s*(?:résultats?|results?)/i);
      if (fuzzy) {
        const count = parseInt(fuzzy[1].replace(/[\s,.]/g, ''), 10);
        if (!isNaN(count)) return { count, source: 'body_text', text: fuzzy[0] };
      }

      // Strategy 3: SSR JSON in HTML
      const html = document.documentElement.innerHTML;
      const json = html.match(/"search_results_connection":\s*\{[^]*?"count":\s*(\d+)/);
      if (json) return { count: parseInt(json[1], 10), source: 'ssr_json' };

      // Strategy 4: no results
      if (/0 résultats?|0 results?|no results?|aucun résultat/i.test(bodyText)) {
        return { count: 0, source: 'zero' };
      }

      return { count: null, source: 'not_found' };
    });

    return result;
  } finally {
    await browser.close();
  }
}

module.exports = { fetchAdsCount };
