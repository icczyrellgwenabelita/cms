const express = require('express');
const router = express.Router();
const { auth, db } = require('../config/firebase');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Student login (Firebase Authentication - client-side)
router.post('/student/login', async (req, res) => {
  try {
    const { idToken } = req.body;
    
    if (!idToken) {
      return res.status(400).json({ error: 'ID token required' });
    }

    const decodedToken = await auth.verifyIdToken(idToken);
    
    // Get student data from database
    const studentRef = db.ref(`students/${decodedToken.uid}`);
    const snapshot = await studentRef.once('value');
    let studentData = snapshot.val();

    // If student doesn't exist in database, create basic entry
    if (!studentData) {
      studentData = {
        email: decodedToken.email,
        status: 'active',
        certificates: [],
        createdAt: new Date().toISOString()
      };
      await studentRef.set(studentData);
    }

    res.json({
      success: true,
      user: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        ...studentData
      },
      token: idToken
    });
  } catch (error) {
    console.error('Student login error:', error);
    res.status(401).json({ error: 'Authentication failed', details: error.message });
  }
});

// Admin register
router.post('/admin/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Check if admin exists
    const adminsRef = db.ref('admins');
    const snapshot = await adminsRef.once('value');
    const admins = snapshot.val() || {};

    // Find admin by email
    let adminId = null;
    for (const [id, admin] of Object.entries(admins)) {
      if (admin.email === email) {
        return res.status(400).json({ error: 'Admin already exists' });
      }
    }

    // Create new admin
    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdminRef = adminsRef.push();
    adminId = newAdminRef.key;

    await newAdminRef.set({
      email,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    });

    res.json({ success: true, message: 'Admin registered successfully', adminId });
  } catch (error) {
    console.error('Admin register error:', error);
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});

// Admin login
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Get admin from database
    const adminsRef = db.ref('admins');
    const snapshot = await adminsRef.once('value');
    const admins = snapshot.val() || {};

    // Find admin by email
    let adminId = null;
    let admin = null;
    for (const [id, a] of Object.entries(admins)) {
      if (a.email === email) {
        adminId = id;
        admin = a;
        break;
      }
    }

    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, admin.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { adminId, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      admin: {
        adminId,
        email: admin.email
      },
      token
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
});

module.exports = router;

