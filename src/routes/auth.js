const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.use(authLimiter);

// POST /auth/register — invite-only registration
router.post('/register', async (req, res) => {
  const { email, password, invite_code } = req.body;

  if (!email || !password || !invite_code) {
    return res.status(400).json({ error: 'email, password, and invite_code required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const client = await pool.connect();
  try {
    // Validate invite code
    const { rows: codes } = await client.query(
      'SELECT * FROM invite_codes WHERE code = $1 AND used_by IS NULL AND (expires_at IS NULL OR expires_at > NOW())',
      [invite_code]
    );

    if (codes.length === 0) {
      return res.status(403).json({ error: 'Invalid or expired invite code' });
    }

    // Check if email already exists
    const { rows: existing } = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Create user
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows: [user] } = await client.query(
      'INSERT INTO users (email, password_hash, invite_code) VALUES ($1, $2, $3) RETURNING id, email, role',
      [email, passwordHash, invite_code]
    );

    // Mark invite as used
    await client.query(
      'UPDATE invite_codes SET used_by = $1, used_at = NOW() WHERE code = $2',
      [user.id, invite_code]
    );

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN });

    res.status(201).json({ user, token, refreshToken });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    client.release();
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN });

    res.json({ user: { id: user.id, email: user.email, role: user.role }, token, refreshToken });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const { rows } = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [decoded.id]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

    res.json({ token });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

module.exports = router;
