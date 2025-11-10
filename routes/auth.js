const express = require('express');
const router = express.Router();
const { auth, db } = require('../config/firebase');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
router.post('/student/login', async (req, res) => {
  try {
    console.log('Student login request received');
    const { idToken } = req.body;
    
    if (!idToken) {
      console.log('Student login: No ID token provided');
      return res.status(400).json({ error: 'ID token required', success: false });
    }
    console.log('Student login: Verifying ID token...');
    const decodedToken = await auth.verifyIdToken(idToken);
    console.log('Student login: Token verified for UID:', decodedToken.uid);
    
    const studentRef = db.ref(`students/${decodedToken.uid}`);
    const studentSnapshot = await studentRef.once('value');
    let studentData = studentSnapshot.val();
    if (!studentData) {
      console.log('Student login: Not found in students DB, checking users DB...');
      const userRef = db.ref(`users/${decodedToken.uid}`);
      const userSnapshot = await userRef.once('value');
      const userData = userSnapshot.val();
      
      if (userData) {
        const studentInfo = userData.studentInfo || {};
        studentData = {
          email: userData.email || decodedToken.email,
          fullName: userData.name || '',
          status: 'active',
          certificates: [],
          gender: studentInfo.gender || '',
          studentNumber: studentInfo.studentNumber || '',
          batch: studentInfo.batch || '',
          address: studentInfo.address || '',
          contactNumber: studentInfo.contactNumber || '',
          birthday: studentInfo.birthday || '',
          isVerified: userData.verified || false,
          profileCompletion: userData.profileCompletion || 0,
          profilePicture: userData.profilePicture || null,
          _isUser: true,
          _userData: userData
        };
        console.log('Student login: User found in users database, converted to student format');
      }
    } else {
      console.log('Student login: Found in students DB');
    }
    if (!studentData) {
      console.log('Student login: Creating new student entry...');
      studentData = {
        email: decodedToken.email,
        status: 'active',
        certificates: [],
        createdAt: new Date().toISOString()
      };
      await studentRef.set(studentData);
      console.log('Student login: Created new student entry');
    }
    console.log('Student login: Sending success response');
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
    console.error('Student login error stack:', error.stack);
    res.status(401).json({ 
      error: 'Authentication failed', 
      details: error.message,
      success: false 
    });
  }
});
router.post('/user/login', async (req, res) => {
  try {
    const { idToken } = req.body;
    
    if (!idToken) {
      return res.status(400).json({ error: 'ID token required' });
    }
    const decodedToken = await auth.verifyIdToken(idToken);
    
    const userRef = db.ref(`users/${decodedToken.uid}`);
    const snapshot = await userRef.once('value');
    let userData = snapshot.val();
    if (!userData) {
      userData = {
        email: decodedToken.email,
        name: '',
        verified: false,
        profileCompletion: 0,
        studentInfo: {
          address: '',
          batch: '',
          birthday: '',
          school: '',
          studentNumber: ''
        },
        progress: {},
        history: {
          quizzes: {},
          simulations: {}
        },
        createdAt: new Date().toISOString()
      };
      await userRef.set(userData);
    } else {
      if (!userData.email) {
        userData.email = decodedToken.email;
        await userRef.update({ email: decodedToken.email });
      }
    }
    res.json({
      success: true,
      user: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        ...userData
      },
      token: idToken
    });
  } catch (error) {
    console.error('User login error:', error);
    res.status(401).json({ error: 'Authentication failed', details: error.message });
  }
});
router.post('/admin/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const adminsRef = db.ref('admins');
    const snapshot = await adminsRef.once('value');
    const admins = snapshot.val() || {};
    let adminId = null;
    for (const [id, admin] of Object.entries(admins)) {
      if (admin.email === email) {
        return res.status(400).json({ error: 'Admin already exists' });
      }
    }
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
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const adminsRef = db.ref('admins');
    const snapshot = await adminsRef.once('value');
    const admins = snapshot.val() || {};
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
    const isValid = await bcrypt.compare(password, admin.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
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