/**
 * Facebook GraphQL proxy — relays extension's requests to Facebook
 * Uses IPRoyal proxy + user's FB cookies
 */
const express = require('express');
const { ProxyAgent, fetch: undiciFetch } = require('undici');

const router = express.Router();

const IPROYAL_USER = process.env.IPROYAL_USER;
const IPROYAL_PASS = process.env.IPROYAL_PASS;
const IPROYAL_HOST = process.env.IPROYAL_HOST || 'geo.iproyal.com';
const IPROYAL_PORT = process.env.IPROYAL_PORT || '12321';

function getProxyAgent() {
  const token = 'Basic ' + Buffer.from(`${IPROYAL_USER}:${IPROYAL_PASS}`).toString('base64');
  return new ProxyAgent({ uri: `http://${IPROYAL_HOST}:${IPROYAL_PORT}`, token });
}

// POST /api/fb-proxy/graphql
// Body: { body: "urlencoded-string-of-fb-graphql-body", cookie: "cookie-string", userAgent, lsd }
router.post('/graphql', async (req, res) => {
  const { body, cookie, userAgent, lsd } = req.body;

  if (!body || !cookie) {
    return res.status(400).json({ error: 'body and cookie required' });
  }

  try {
    const resp = await undiciFetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      dispatcher: getProxyAgent(),
      headers: {
        'User-Agent': userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookie,
        'Origin': 'https://www.facebook.com',
        'Referer': 'https://www.facebook.com/ads/library/',
        'X-FB-LSD': lsd || '',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      },
      body,
    });

    const text = await resp.text();
    res.status(resp.status).type('application/json').send(text);
  } catch (err) {
    console.error('FB proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
