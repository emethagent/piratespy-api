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

// Auth routes (no JWT required)
app.use('/api/auth', authRoutes);

// Protected routes (JWT required)
app.use('/api/ads', verifyJWT, adsRoutes);
app.use('/api/admin', verifyJWT, adminRoutes);

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
