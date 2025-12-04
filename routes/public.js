const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');

// GET /api/public/certificate/:certId
// Public endpoint to verify certificates without authentication
router.get('/certificate/:certId', async (req, res) => {
  try {
    const { certId } = req.params;
    if (!certId) {
      return res.status(400).json({ error: 'Certificate ID is required' });
    }

    // Use admin SDK to read from certificates/{certId}
    // This bypasses client-side rules (which might be restrictive)
    const certRef = db.ref(`certificates/${certId}`);
    const snapshot = await certRef.once('value');
    const certData = snapshot.val();

    if (!certData) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    // Return public safe data
    res.json({
      success: true,
      data: {
        certificateId: certId,
        type: certData.type,
        fullName: certData.fullName || certData.studentName,
        email: certData.email, // Email is usually shown on cert or verification
        issuedAt: certData.issuedAt,
        status: certData.status
      }
    });
  } catch (error) {
    console.error('Public certificate verification error:', error);
    res.status(500).json({ error: 'Failed to verify certificate' });
  }
});

// GET /api/public/lessons
// Lightweight public endpoint to expose published lessons metadata
router.get('/lessons', async (req, res) => {
  try {
    const lessonsRef = db.ref('lessons');
    const snapshot = await lessonsRef.once('value');
    const lessonsData = snapshot.val() || {};

    const lessons = {};

    Object.entries(lessonsData).forEach(([key, value]) => {
      // Only consider numeric keys (lesson slots)
      const slot = parseInt(key, 10);
      if (!Number.isFinite(slot)) {
        return;
      }

      const rawStatus = (value.status || '').toString().toLowerCase();
      const isPublished = rawStatus === 'published';
      if (!isPublished) {
        return;
      }

      const title =
        value.lessonTitle ||
        value.lessonName ||
        `Lesson ${slot}`;

      lessons[String(slot)] = {
        slot,
        title,
        isPublished: true
      };
    });

    res.json({
      success: true,
      lessons
    });
  } catch (error) {
    console.error('Public lessons fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch lessons' });
  }
});

module.exports = router;

