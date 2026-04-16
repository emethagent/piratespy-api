/**
 * Scrapes Facebook Ads Library to get active ads count for a domain
 * Uses IPRoyal residential proxy via undici ProxyAgent
 */
const { ProxyAgent, fetch: undiciFetch } = require('undici');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const IPROYAL_USER = process.env.IPROYAL_USER || 'tcZa2CIDmqVr37Hx';
const IPROYAL_PASS = process.env.IPROYAL_PASS || 'OyCsoblVVvZ0HG43';
const IPROYAL_HOST = process.env.IPROYAL_HOST || 'geo.iproyal.com';
const IPROYAL_PORT = process.env.IPROYAL_PORT || '12321';

function getProxyAgent(country = 'us') {
  const session = Math.random().toString(36).substring(2, 10);
  const username = `${IPROYAL_USER}_country-${country}_session-${session}`;
  const token = 'Basic ' + Buffer.from(`${username}:${IPROYAL_PASS}`).toString('base64');
  return new ProxyAgent({
    uri: `http://${IPROYAL_HOST}:${IPROYAL_PORT}`,
    token,
  });
}

async function fetchAdsCount(domain) {
  const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${encodeURIComponent(domain)}&sort_data[direction]=desc&sort_data[mode]=relevancy_monthly_grouped`;

  const resp = await undiciFetch(url, {
    dispatcher: getProxyAgent(),
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      'sec-ch-ua': '"Chromium";v="120", "Not?A_Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'upgrade-insecure-requests': '1',
    },
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const html = await resp.text();

  // Strategy 1: Parse from SSR JSON blob `search_results_connection.count`
  const jsonMatch = html.match(/"search_results_connection":\s*\{[^]*?"count":\s*(\d+)/);
  if (jsonMatch) {
    return { count: parseInt(jsonMatch[1], 10), source: 'ssr_json' };
  }

  // Strategy 2: Parse from heading "650 résultats" / "650 results"
  const headingMatch = html.match(/role="heading"[^>]*>([\d\s,.]+)\s*(?:résultats?|results?)/i);
  if (headingMatch) {
    const count = parseInt(headingMatch[1].replace(/[\s,.]/g, ''), 10);
    if (!isNaN(count)) return { count, source: 'heading' };
  }

  // Strategy 3: Fuzzy match anywhere
  const fuzzyMatch = html.match(/~?(\d[\d\s,.]*)\s*(?:résultats?|results?)/i);
  if (fuzzyMatch) {
    const count = parseInt(fuzzyMatch[1].replace(/[\s,.]/g, ''), 10);
    if (!isNaN(count)) return { count, source: 'fuzzy' };
  }

  // Strategy 4: No results
  if (/0 résultats?|0 results?|no results?|aucun résultat/i.test(html)) {
    return { count: 0, source: 'zero' };
  }

  return { count: null, source: 'not_found' };
}

module.exports = { fetchAdsCount };
