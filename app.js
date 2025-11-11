const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
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
app.use((req, res, next) => {
  if (req.method === 'GET' && !path.extname(req.path)) {
    const trimmedPath = req.path.endsWith('/') && req.path.length > 1 ? req.path.slice(0, -1) : req.path;
    const relativePath = trimmedPath === '/' ? 'index' : trimmedPath.replace(/^\//, '');
    const filePath = path.join(__dirname, 'public', `${relativePath}.html`);
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  }
  next();
});
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

// Explicit routes for dashboard pages
app.get('/admin-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

app.get('/student-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student-dashboard.html'));
});

app.get('/student-profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student-profile.html'));
});

app.get('/admin-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.get('/student-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student-login.html'));
});

app.use('/api', (req, res) => {
  console.log('404 API route:', req.method, req.originalUrl);
  res
    .status(404)
    .json({ error: 'API endpoint not found', path: req.originalUrl, method: req.method });
});
module.exports = app;