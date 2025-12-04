const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const instructorRoutes = require('./routes/instructor');
const publicRoutes = require('./routes/public');
const classRoutes = require('./routes/class');
app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/instructor', instructorRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/class', classRoutes);
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
  res.redirect('/caresim-login');
});

// Explicit routes for dashboard pages
app.get('/admin-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

app.get('/admin-lessons', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-lessons.html'));
});

app.get('/admin-lesson-editor', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-lesson-editor.html'));
});

app.get('/admin-quizzes', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-quizzes.html'));
});

app.get('/admin-users', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-users.html'));
});

app.get('/admin-game-certificates', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-game-certificates.html'));
});

app.get('/admin-videos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-videos.html'));
});

app.get('/admin-dev-advanced', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dev-advanced.html'));
});

app.get('/verify-certificate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'verify-certificate.html'));
});

app.get('/generic-certificate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'generic-certificate.html'));
});

app.get('/student-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student-dashboard.html'));
});

app.get('/instructor-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instructor-dashboard.html'));
});

app.get('/instructor-students', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instructor-students.html'));
});

app.get('/instructor-class-list', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instructor-class-list.html'));
});

app.get('/instructor-assessment-overview', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instructor-assessment-overview.html'));
});

app.get('/instructor-assessment-students', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instructor-assessment-students.html'));
});

app.get('/instructor-assessment-student', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instructor-assessment-student.html'));
});

app.get('/download/caresim-app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'download-caresim-app.html'));
});


app.get('/instructor-profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instructor-profile.html'));
});

app.get('/instructor-announcements', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instructor-announcements.html'));
});

app.get('/instructor-student-progress', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instructor-student-progress.html'));
});

app.get('/student-profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student-profile.html'));
});

app.get('/student-progress', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student-assessment.html'));
});

app.get('/student-class', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student-class.html'));
});

app.get('/instructor-class', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instructor-class.html'));
});

// Legacy route redirect
app.get('/student-assessment', (req, res) => {
  res.redirect('/student-progress');
});

app.get('/student-instructor-login', (req, res) => {
  res.redirect('/caresim-login');
});

app.get('/admin-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.get('/caresim-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student-login.html'));
});

app.get('/student-login', (req, res) => {
  res.redirect('/caresim-login');
});

app.get('/create-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'create-password.html'));
});

app.use('/api', (req, res) => {
  console.log('404 API route:', req.method, req.originalUrl);
  res
    .status(404)
    .json({ error: 'API endpoint not found', path: req.originalUrl, method: req.method });
});
module.exports = app;
