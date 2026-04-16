const rateLimit = require('express-rate-limit');

// Global: 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down' },
  keyGenerator: (req) => req.user?.id || req.ip,
});

// Auth: 30 attempts per 15 minutes per IP (relaxed for team testing)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many auth attempts, try again later' },
});

// Write operations: 30 per minute per user
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many write operations' },
  keyGenerator: (req) => req.user?.id || req.ip,
});

module.exports = { globalLimiter, authLimiter, writeLimiter };
