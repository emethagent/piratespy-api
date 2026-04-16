require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { migrate } = require('./db/migrate');
const { verifyAppToken } = require('./middleware/appToken');
const { verifyJWT } = require('./middleware/auth');
const { globalLimiter } = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const adsRoutes = require('./routes/ads');
const adminRoutes = require('./routes/admin');
const shopifyAppsRoutes = require('./routes/shopifyApps');
const bookmarksRoutes = require('./routes/bookmarks');

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use(helmet());

// CORS — extension Chrome only (no cookies)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-App-Token'],
}));

// Body parser
app.use(express.json({ limit: '10mb' }));

// Global rate limiter
app.use(globalLimiter);

// App token on all routes (validates request comes from PirateSpy)
app.use('/api', verifyAppToken);

// Health check (no auth)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Bootstrap: create first admin (one-time, requires BOOTSTRAP_KEY env var)
app.post('/bootstrap', async (req, res) => {
  const { key, email, password } = req.body;
  if (!key || key !== process.env.BOOTSTRAP_KEY) {
    return res.status(403).json({ error: 'Invalid bootstrap key' });
  }
  const { pool } = require('./db/pool');
  const bcrypt = require('bcryptjs');
  const { rows: existing } = await pool.query('SELECT id FROM users LIMIT 1');
  if (existing.length > 0) {
    return res.status(409).json({ error: 'Already bootstrapped' });
  }
  const hash = await bcrypt.hash(password, 12);
  const { rows: [user] } = await pool.query(
    "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id, email, role",
    [email, hash]
  );
  res.json({ user, message: 'Admin created. Delete BOOTSTRAP_KEY env var now.' });
});

// Auth routes (no JWT required)
app.use('/api/auth', authRoutes);

// Public (app token only, no JWT required)
app.use('/api/apps', shopifyAppsRoutes);

// Protected routes (JWT required)
app.use('/api/ads', verifyJWT, adsRoutes);
app.use('/api/admin', verifyJWT, adminRoutes);
app.use('/api/bookmarks', verifyJWT, bookmarksRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start
async function start() {
  try {
    await migrate();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`PirateSpy API running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
