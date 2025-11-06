const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Import routes
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');

// API Routes - MUST come before static middleware
app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

// Static files - after API routes
app.use(express.static('public'));

// Error handling middleware for API routes (must be after routes but before catch-all)
app.use((err, req, res, next) => {
  if (req.path && req.path.startsWith('/api')) {
    console.error('API Error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
      success: false,
    });
  } else {
    next(err);
  }
});

// Serve frontend pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all for undefined API routes - return JSON error (must be last)
app.use('/api', (req, res) => {
  console.log('404 API route:', req.method, req.originalUrl);
  res
    .status(404)
    .json({ error: 'API endpoint not found', path: req.originalUrl, method: req.method });
});

module.exports = app;


