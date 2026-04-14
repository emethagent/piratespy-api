/**
 * App Token middleware — validates that the request comes from PirateSpy extension
 * Rejects any request without the correct X-App-Token header
 */
function verifyAppToken(req, res, next) {
  const token = req.headers['x-app-token'];

  if (!token || token !== process.env.APP_TOKEN) {
    return res.status(403).json({ error: 'Invalid app token' });
  }

  next();
}

module.exports = { verifyAppToken };
