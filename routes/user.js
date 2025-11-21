const express = require('express');
const router = express.Router();
const { verifyStudentToken } = require('../middleware/auth');
const { db } = require('../config/firebase');

const normalizeQuizScore = (score) => {
  if (typeof score !== 'number' || isNaN(score)) {
    return 0;
  }
  if (score >= 0 && score <= 1) {
    return score * 10;
  }
  return score;
};

const lessonStatusString = (status) => {
  if (!status || typeof status !== 'string') {
    return 'not_started';
  }
  return status.trim().toLowerCase();
};

const hasLessonSimPassed = (lesson = {}) => {
  if (Array.isArray(lesson.simHistory) && lesson.simHistory.some(entry => {
    const result = String(entry?.result || entry?.status || '').toLowerCase();
    return ['pass', 'passed', 'success', 'complete', 'completed'].includes(result);
  })) {
    return true;
  }
  if (lesson.simCompleted === true) return true;
  if (lesson.simulation && lesson.simulation.completed) return true;
  return false;
};

const lessonHasSimActivity = (lesson = {}) => {
  if (Array.isArray(lesson.simHistory) && lesson.simHistory.length > 0) {
    return true;
  }
  const attempts = Number(lesson.simAttempts || lesson?.simulation?.attempts);
  return Number.isFinite(attempts) && attempts > 0;
};

const announcementMatchesStudent = (announcement = {}, studentInfo = {}) => {
  const audience = announcement.audience;
  if (!audience) {
    return true;
  }

  const studentBatch = (studentInfo.batch || '').toString().toLowerCase();
  const normalize = (value) => String(value || '').toLowerCase();

  const values = Array.isArray(audience) ? audience.map(normalize) : [normalize(audience)];

  if (values.some(val => ['students', 'student', 'all', 'everyone', 'public'].includes(val))) {
    return true;
  }

  if (studentBatch && values.some(val => val.includes(studentBatch))) {
    return true;
  }

  return false;
};
router.get('/dashboard', verifyStudentToken, async (req, res) => {
  try {
    console.log('User dashboard request received for userId:', req.userId);
    
    // Safely fetch user data
    let userData = {};
    try {
      const userRef = db.ref(`users/${req.userId}`);
      const snapshot = await userRef.once('value');
      userData = snapshot.val() || {};
    } catch (err) {
      console.error('Error fetching user data:', err);
      userData = {};
    }
    
    // Safely fetch progress data
    let progressData = {};
    try {
      const progressRef = db.ref(`users/${req.userId}/progress`);
      const progressSnapshot = await progressRef.once('value');
      progressData = progressSnapshot.val() || {};
    } catch (err) {
      console.error('Error fetching progress:', err);
      progressData = {};
    }
    
    // Extract student info safely
    const studentInfo = (userData && typeof userData === 'object' && userData.studentInfo) 
      ? userData.studentInfo 
      : {};
    
    // Calculate totalLessons from progress keys (lesson1, lesson2, etc.)
    const progressKeys = progressData && typeof progressData === 'object' 
      ? Object.keys(progressData).filter(key => /^lesson\d+$/.test(key))
      : [];
    const totalLessons = progressKeys.length || 6; // Default to 6 if no progress
    
    // Calculate lessonsCompleted: count where quiz.completed === true AND simulation.completed === true
    let lessonsCompleted = 0;
    let quizzesTaken = 0;
    let totalQuizScore = 0;
    let quizCount = 0;
    let simulationsCompleted = 0;
    
    for (const lessonKey of progressKeys) {
      const lessonProgress = progressData[lessonKey] || {};
      const quiz = lessonProgress.quiz || {};
      const simulation = lessonProgress.simulation || {};
      
      // Check if lesson is completed (both quiz and simulation completed)
      if (quiz.completed === true && simulation.completed === true) {
        lessonsCompleted += 1;
      }
      
      // Count quiz attempts
      const attempts = Number(quiz.attempts) || 0;
      if (attempts > 0) {
        quizzesTaken += attempts;
      }
      
      // Get highest score for average calculation
      if (quiz.highestScore !== undefined && typeof quiz.highestScore === 'number' && !isNaN(quiz.highestScore)) {
        totalQuizScore += quiz.highestScore;
        quizCount += 1;
      }
      
      // Count completed simulations
      if (simulation.completed === true) {
        simulationsCompleted += 1;
      }
    }
    
    // Calculate avgQuizScore
    const avgQuizScore = quizCount > 0 ? totalQuizScore / quizCount : 0;
    
    // Calculate overallProgressPct
    const overallProgressPct = totalLessons > 0 
      ? Math.round((lessonsCompleted / totalLessons) * 100) 
      : 0;
    
    // Get assigned instructor name
    let assignedInstructorName = 'Not assigned';
    if (userData.assignedInstructor) {
      try {
        const instructorRef = db.ref(`admins/${userData.assignedInstructor}`);
        const instructorSnapshot = await instructorRef.once('value');
        const instructorData = instructorSnapshot.val();
        if (instructorData && typeof instructorData === 'object') {
          assignedInstructorName = instructorData.name || instructorData.fullName || instructorData.email || 'Instructor';
        }
      } catch (err) {
        console.error('Error fetching instructor name:', err);
      }
    }
    
    // Build profile
    const profile = {
      uid: req.userId || '',
      name: userData.name || 'Student',
      email: userData.email || req.user?.email || '',
      verified: !!(userData.verified === true || userData.verified === 'true'),
      studentNumber: studentInfo.studentNumber || '',
      batch: studentInfo.batch || '',
      program: studentInfo.program || studentInfo.course || 'Caregiving NC II',
      assignedInstructor: assignedInstructorName,
      lastLogin: userData.lastLogin || userData.lastLoginDate || null
    };
    
    // Build summaryStats
    const summaryStats = {
      lessonsCompleted,
      totalLessons,
      simulationsCompleted,
      totalSimulations: totalLessons, // Same as totalLessons
      quizzesTaken,
      avgQuizScore: Math.round(avgQuizScore * 10) / 10, // Round to 1 decimal
      certificatesEarned: 0, // Not calculated in minimal version
      overallProgressPct
    };
    
    res.json({
      success: true,
      profile,
      summaryStats
    });
  } catch (error) {
    console.error('User dashboard error:', error);
    res.status(500).json({ error: 'Failed to load user dashboard data' });
  }
});

router.get('/profile', verifyStudentToken, async (req, res) => {
  try {
    const userRef = db.ref(`users/${req.userId}`);
    const snapshot = await userRef.once('value');
    let userData = snapshot.val();
    if (!userData) {
      userData = {};
    }
    const studentInfo = userData.studentInfo || {};
    const isVerified = userData.verified === true || userData.verified === 'true';
    let completionScore = 0;
    
    if (userData.email) completionScore += 15;
    if (userData.name) completionScore += 15;
    if (studentInfo.gender) completionScore += 10;
    if (studentInfo.studentNumber) completionScore += 15;
    if (studentInfo.batch) completionScore += 10;
    if (studentInfo.address) completionScore += 10;
    if (studentInfo.contactNumber) completionScore += 10;
    if (studentInfo.birthday) completionScore += 15;
    
    if (!isVerified) {
      if (completionScore < 50) {
        completionScore = 50;
      }
    }
    const userName = userData.name || '';
    res.json({
      success: true,
      data: {
        email: userData.email || req.user.email || '',
        name: userName,
        fullName: userName,
        gender: studentInfo.gender || '',
        studentNumber: studentInfo.studentNumber || '',
        batch: studentInfo.batch || '',
        address: studentInfo.address || '',
        contactNumber: studentInfo.contactNumber || '',
        birthday: studentInfo.birthday || '',
        school: studentInfo.school || '',
        profilePicture: userData.profilePicture || null,
        profileCompletion: completionScore,
        verified: isVerified,
        isVerified: isVerified
      }
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});
router.put('/profile', verifyStudentToken, async (req, res) => {
  try {
    let { name, fullName, gender, studentNumber, batch, address, contactNumber, birthday, school, profilePicture } = req.body;
    
    if (typeof name === 'string') {
      name = name.trim();
    }
    if (typeof fullName === 'string') {
      fullName = fullName.trim();
    }
    const effectiveName = name !== undefined ? name : fullName;
    const nameRegex = /^[A-Za-z\s]{1,60}$/;
    if (effectiveName && !nameRegex.test(effectiveName)) {
      return res.status(400).json({
        success: false,
        error: 'Full name must contain letters and spaces only (max 60 characters)'
      });
    }
    
    // Validate student number (numeric only)
    if (studentNumber && !/^\d+$/.test(studentNumber)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Student number must contain only numbers' 
      });
    }
    
    // Validate batch (must be 2022-2025)
    if (batch && !['2022', '2023', '2024', '2025'].includes(batch)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Batch must be one of: 2022, 2023, 2024, or 2025' 
      });
    }
    
    // Validate and clean contact number (numeric only, max 11 digits)
    let cleanedContactNumber = contactNumber;
    if (typeof contactNumber === 'string') {
      contactNumber = contactNumber.trim();
    }
    if (contactNumber) {
      const cleanContact = contactNumber.replace(/\D/g, ''); // Remove non-digits
      if (cleanContact.length > 11) {
        return res.status(400).json({ 
          success: false, 
          error: 'Contact number must be maximum 11 digits' 
        });
      }
      if (cleanContact.length > 0 && !/^\d+$/.test(cleanContact)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Contact number must contain only numbers' 
        });
      }
      cleanedContactNumber = cleanContact; // Use cleaned version
    }
    
    console.log('User profile update request received for userId:', req.userId);
    console.log('User profile update - ProfilePicture provided:', profilePicture !== undefined, 'Value:', profilePicture ? 'base64 string (' + profilePicture.length + ' chars)' : profilePicture);
    
    const userRef = db.ref(`users/${req.userId}`);
    const snapshot = await userRef.once('value');
    const existing = snapshot.val() || {};
    
    console.log('User profile update - Existing data keys:', Object.keys(existing));
    const existingStudentInfo = existing.studentInfo || {};
    
    const shouldUpdateName = name !== undefined || fullName !== undefined;
    const nameToSave = shouldUpdateName ? (effectiveName || '') : existing.name;

    const updatedData = {
      ...existing,
      email: req.user.email || existing.email,
      name: nameToSave,
      updatedAt: new Date().toISOString(),
      studentInfo: {
        ...existingStudentInfo,
        gender: gender !== undefined ? gender : existingStudentInfo.gender,
        studentNumber: studentNumber !== undefined ? studentNumber : existingStudentInfo.studentNumber,
        batch: batch !== undefined ? batch : existingStudentInfo.batch,
        address: address !== undefined ? address : existingStudentInfo.address,
        contactNumber: contactNumber !== undefined ? cleanedContactNumber : existingStudentInfo.contactNumber,
        birthday: birthday !== undefined ? birthday : existingStudentInfo.birthday,
        school: school !== undefined ? school : existingStudentInfo.school
      }
    };
    if (profilePicture !== undefined) {
      if (profilePicture === null || profilePicture === 'null') {
        delete updatedData.profilePicture;
        console.log('Removing profile picture from user database');
      } else if (typeof profilePicture === 'string' && profilePicture.trim() !== '') {
        updatedData.profilePicture = profilePicture;
        console.log('Saving profile picture to user database, length:', profilePicture.length);
      }
    }
    let completionScore = 0;
    if (updatedData.email) completionScore += 15;
    if (updatedData.name) completionScore += 15;
    if (updatedData.studentInfo.gender) completionScore += 10;
    if (updatedData.studentInfo.studentNumber) completionScore += 15;
    if (updatedData.studentInfo.batch) completionScore += 10;
    if (updatedData.studentInfo.address) completionScore += 10;
    if (updatedData.studentInfo.contactNumber) completionScore += 10;
    if (updatedData.studentInfo.birthday) completionScore += 15;
    
    updatedData.profileCompletion = completionScore;
    if (completionScore >= 80) {
      updatedData.verified = true;
    }
    await userRef.set(updatedData);
    
    const verifySnapshot = await userRef.once('value');
    const savedData = verifySnapshot.val() || {};
    console.log('User profile saved. ProfilePicture in saved data:', savedData.hasOwnProperty('profilePicture') ? 'Yes (length: ' + (savedData.profilePicture?.length || 0) + ')' : 'No');
    let profilePictureValue = null;
    if (savedData.hasOwnProperty('profilePicture') && savedData.profilePicture) {
      profilePictureValue = savedData.profilePicture;
      console.log('Profile picture found in saved user data, length:', profilePictureValue.length);
    } else {
      console.log('No profile picture in saved user data');
    }
    
    const savedStudentInfo = savedData.studentInfo || {};
    const savedUserName = savedData.name || updatedData.name || '';
    const responseData = {
      email: savedData.email || updatedData.email,
      name: savedUserName,
      fullName: savedUserName,
      gender: savedStudentInfo.gender || updatedData.studentInfo.gender || '',
      studentNumber: savedStudentInfo.studentNumber || updatedData.studentInfo.studentNumber || '',
      batch: savedStudentInfo.batch || updatedData.studentInfo.batch || '',
      address: savedStudentInfo.address || updatedData.studentInfo.address || '',
      contactNumber: savedStudentInfo.contactNumber || updatedData.studentInfo.contactNumber || '',
      birthday: savedStudentInfo.birthday || updatedData.studentInfo.birthday || '',
      school: savedStudentInfo.school || updatedData.studentInfo.school || '',
      profilePicture: profilePictureValue,
      profileCompletion: completionScore,
      verified: savedData.verified !== undefined ? savedData.verified : (completionScore >= 80),
      isVerified: savedData.verified !== undefined ? savedData.verified : (completionScore >= 80)
    };
    console.log('Sending user profile update response, profilePicture:', responseData.profilePicture ? 'Exists (' + (responseData.profilePicture.length || 0) + ' chars)' : 'null');
    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});
// GET /api/user/lessons - Get all lessons with full content for students
router.get('/lessons', verifyStudentToken, async (req, res) => {
  try {
    const lessonsRef = db.ref('lessons');
    const snapshot = await lessonsRef.once('value');
    const lessons = snapshot.val() || {};
    
    // Only return lessons that actually exist in the database
    const lessonsArray = Object.entries(lessons)
      .filter(([key, lesson]) => {
        const slot = parseInt(key);
        return !isNaN(slot) && lesson && (lesson.lessonTitle || lesson.lessonName);
      })
      .map(([key, lesson]) => {
        const slot = parseInt(key);
        return {
          slot,
          lessonTitle: lesson.lessonTitle || lesson.lessonName || '',
          lessonName: lesson.lessonName || lesson.lessonTitle || '', // Keep for backward compatibility
          description: lesson.description || lesson.lessonDescription || '',
          lessonDescription: lesson.lessonDescription || lesson.description || '', // Keep for backward compatibility
          body: lesson.body || '',
          images: lesson.images || [],
          tools: lesson.tools || {}
        };
      })
      .sort((a, b) => a.slot - b.slot);
    
    res.json({ success: true, lessons: lessonsArray });
  } catch (error) {
    console.error('Get lessons error:', error);
    res.status(500).json({ error: 'Failed to fetch lessons' });
  }
});

module.exports = router;