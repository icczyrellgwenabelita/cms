const { auth } = require('../config/firebase');

const verifyStudentToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    req.userId = decodedToken.uid;
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    res.status(401).json({ error: 'Invalid token', details: error.message });
  }
};

const verifyAdminToken = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const verifyInstructorToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const jwt = require('jsonwebtoken');
    const { db } = require('../config/firebase');
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const adminId = decoded.adminId;
    
    if (!adminId) {
      return res.status(401).json({ error: 'Invalid token: missing adminId' });
    }

    // Load admin record from Firebase
    const adminRef = db.ref(`admins/${adminId}`);
    const adminSnapshot = await adminRef.once('value');
    const adminData = adminSnapshot.val();

    if (!adminData) {
      return res.status(401).json({ error: 'Instructor not found' });
    }

    // Check role: must be "instructor" or "admin" (admin can access instructor views)
    const role = adminData.role || 'instructor';
    if (role !== 'instructor' && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: not instructor' });
    }

    req.instructorId = adminId;
    req.instructor = adminData;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('Instructor token verification error:', error);
    res.status(500).json({ error: 'Token verification failed' });
  }
};

module.exports = { verifyStudentToken, verifyAdminToken, verifyInstructorToken };

