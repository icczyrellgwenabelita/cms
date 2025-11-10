const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const app = express();
app.use(cors());
app.use(express.json());
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use(express.static('public'));
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
app.get('/', (req, res) => {
  res.redirect('/student-login.html');
});
app.use('/api', (req, res) => {
  console.log('404 API route:', req.method, req.originalUrl);
  res
    .status(404)
    .json({ error: 'API endpoint not found', path: req.originalUrl, method: req.method });
});
module.exports = app;