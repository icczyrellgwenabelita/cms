const express = require('express');
const router = express.Router();
const { verifyStudentToken } = require('../middleware/auth');
const { db, bucket } = require('../config/firebase');
const { logActivity } = require('../utils/activityLogger');

/**
 * Helper to safely read a boolean-like flag that may be stored as
 * true/false, "true"/"false", 1/0, etc.
 */
function asBool(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.toLowerCase().trim();
    if (v === 'true' || v === 'yes' || v === '1') return true;
    if (v === 'false' || v === 'no' || v === '0') return false;
  }
  return defaultValue;
}

/**
 * Normalize quiz structure coming from LMS or Game progress.
 */
function normalizeQuiz(raw = {}) {
  const highestScore = Number(raw.highestScore);
  const attempts = Number(raw.attempts);
  return {
    completed: asBool(raw.completed, false),
    highestScore: Number.isFinite(highestScore) ? highestScore : 0,
    attempts: Number.isFinite(attempts) ? attempts : 0,
    lastAttempt: raw.lastAttempt || null
  };
}

/**
 * Normalize simulation structure coming from LMS or Game progress.
 */
function normalizeSimulation(raw = {}) {
  const score = Number(raw.score);
  const attempts = Number(raw.attempts);
  return {
    completed: asBool(raw.completed, false),
    passed: asBool(raw.passed, false),
    score: Number.isFinite(score) ? score : 0,
    attempts: Number.isFinite(attempts) ? attempts : 0,
    lastAttempt: raw.lastAttempt || null
  };
}

/**
 * Determine LMS lesson status based on:
 * - page completion
 * - quiz completion + score threshold
 * - simulation completion + passed
 *
 * This mirrors the admin certificate eligibility rules and MUST
 * stay in sync with admin → student mappings.
 */
function computeLmsLessonStatus({ hasPages, quiz, simulation, hasProgressObject }) {
  const quizCompleted = quiz.completed === true;
  const quizScoreOk = (quiz.highestScore || 0) >= 7; // 7/10 = 70%
  const simOk = simulation.completed === true && simulation.passed === true;

  const completed = hasPages && quizCompleted && quizScoreOk && simOk;
  if (completed) {
    return 'completed';
  }

  const inProgress = hasProgressObject || hasPages || quizCompleted || quizScoreOk || simOk;
  if (inProgress) {
    return 'in_progress';
  }

  return 'not_started';
}

async function getUserData(userId) {
  const studentRef = db.ref(`students/${userId}`);
  const studentSnapshot = await studentRef.once('value');
  let studentData = studentSnapshot.val();
  let isUser = false;
  if (!studentData) {
    const userRef = db.ref(`users/${userId}`);
    const userSnapshot = await userRef.once('value');
    const userData = userSnapshot.val();
    
    if (userData) {
      isUser = true;
      const studentInfo = userData.studentInfo || {};
      studentData = {
        email: userData.email || '',
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
    }
  }
  return { studentData, isUser };
}

// ============================================
// STUDENT DASHBOARD API (LMS + Game Progress)
// GET /api/student/dashboard
// ============================================
router.get('/dashboard', verifyStudentToken, async (req, res) => {
  try {
    const userId = req.userId;
    console.log('Student LMS dashboard request for userId:', userId);

    // Load canonical user record (source of truth for role / status)
    const userRef = db.ref(`users/${userId}`);
    const userSnapshot = await userRef.once('value');
    const userData = userSnapshot.val() || {};

    const role = (userData.role || '').toString().toLowerCase();
    const isStudent = role === 'student';
    const isActive = asBool(userData.active, true);
    const isArchived = asBool(userData.archived, false);

    if (!isStudent || !isActive || isArchived) {
      console.warn('Student dashboard access denied:', {
        userId,
        role: userData.role,
        active: userData.active,
        archived: userData.archived
      });
      return res.status(403).json({ error: 'Student account is inactive or not authorized for dashboard access' });
    }

    // Legacy / fallback student data (profile details)
    const { studentData, isUser } = await getUserData(userId);
    const studentInfo = userData.studentInfo || {};

    // Resolve assigned instructor name (if any)
    let assignedInstructorName = 'Not assigned';
    if (userData.assignedInstructor) {
      try {
        const instructorRef = db.ref(`admins/${userData.assignedInstructor}`);
        const instructorSnapshot = await instructorRef.once('value');
        const instructorData = instructorSnapshot.val() || {};
        assignedInstructorName =
          instructorData.name ||
          instructorData.fullName ||
          instructorData.email ||
          'Instructor';
      } catch (err) {
        console.error('Error fetching assigned instructor for student dashboard:', err);
      }
    }

    // Load LMS + lesson metadata in bulk
    const [lessonsSnapshot, lmsLessonsSnapshot] = await Promise.all([
      db.ref('lessons').once('value'),
      db.ref('lmsLessons').once('value')
    ]);
    const allLessons = lessonsSnapshot.val() || {};
    const allLmsLessons = lmsLessonsSnapshot.val() || {};

    // Load LMS + Game progress roots (never mix the two in one path)
    const lmsProgressRootRef = isUser
      ? db.ref(`users/${userId}/lmsProgress`)
      : db.ref(`students/${userId}/lmsProgress`);
    const gameProgressRootRef = isUser
      ? db.ref(`users/${userId}/progress`)
      : db.ref(`students/${userId}/progress`);

    const [lmsProgressSnapshot, gameProgressSnapshot] = await Promise.all([
      lmsProgressRootRef.once('value'),
      gameProgressRootRef.once('value')
    ]);

    const lmsProgress = lmsProgressSnapshot.val() || {};
    const gameProgress = gameProgressSnapshot.val() || {};

    // ------------------------
    // Build LMS lessons array
    // ------------------------
    const lmsLessons = [];
    let lessonsCompleted = 0;
    let totalQuizScore = 0;
    let quizScoreCount = 0;
    let totalQuizAttempts = 0;
    let totalSimulationAttempts = 0;

    for (let slot = 1; slot <= 6; slot++) {
      const slotKey = String(slot);
      const lessonMeta = allLessons[slotKey] || {};
      const lmsLessonMeta = allLmsLessons[slotKey] || {};

      // Only include lessons that are published
      const rawStatus = (lessonMeta.status || '').toString().toLowerCase();
      const isPublished = rawStatus === 'published';
      if (!isPublished) {
        continue;
      }

      const pages = lmsLessonMeta.pages || {};
      const totalPages = Object.keys(pages).length;

      const lessonProgress = lmsProgress[`lesson${slot}`] || {};
      const completedPages = lessonProgress.completedPages || {};
      const completedPagesCount = Object.keys(completedPages).filter(
        (key) => completedPages[key]
      ).length;
      const pageProgressPercent =
        totalPages > 0 ? Math.round((completedPagesCount / totalPages) * 100) : 0;

      const rawQuiz = normalizeQuiz(lessonProgress.quiz || {});
      const rawSimulation = normalizeSimulation(
        lessonProgress.simulation || lessonProgress.sim || {}
      );

      // For LMS lesson list / chips, status should be based on LMS page progress only
      let status = 'not_started';
      if (totalPages > 0 && completedPagesCount >= totalPages) {
        status = 'completed';
      } else if (completedPagesCount > 0) {
        status = 'in_progress';
          }
          
      if (status === 'completed') {
        lessonsCompleted += 1;
      }

      if (rawQuiz.completed && rawQuiz.highestScore > 0) {
        totalQuizScore += rawQuiz.highestScore;
        quizScoreCount += 1;
      }
      totalQuizAttempts += rawQuiz.attempts || 0;
      totalSimulationAttempts += rawSimulation.attempts || 0;

      lmsLessons.push({
        slot,
        title:
          lessonMeta.lessonTitle ||
          lessonMeta.lessonName ||
          lmsLessonMeta.title ||
          `Lesson ${slot}`,
        description:
          lessonMeta.description ||
          lessonMeta.lessonDescription ||
          lmsLessonMeta.description ||
          '',
        status,
        totalPages,
        completedPages: completedPagesCount,
        pageProgressPercent,
        quiz: rawQuiz,
        simulation: rawSimulation
      });
    }

    const avgQuizScore =
      quizScoreCount > 0 ? Math.round((totalQuizScore / quizScoreCount) * 10) / 10 : 0;

    const lmsTotals = {
      lessonsCompleted,
      avgQuizScore,
      totalQuizAttempts,
      totalSimulationAttempts
    };

    // ------------------------
    // Build Game progress view
    // ------------------------
    const gameLessons = [];
    for (let slot = 1; slot <= 6; slot++) {
      const lessonKey = `lesson${slot}`;
      const lessonGameProgress = gameProgress[lessonKey] || {};
      const quiz = normalizeQuiz(lessonGameProgress.quiz || {});
      const simulation = normalizeSimulation(lessonGameProgress.simulation || {});

      const hasAnyGameData =
        (quiz.attempts || 0) > 0 ||
        quiz.completed ||
        simulation.attempts > 0 ||
        simulation.completed ||
        simulation.passed;

      if (!hasAnyGameData) continue;

      gameLessons.push({
        slot,
        quiz: {
          completed: quiz.completed,
          highestScore: quiz.highestScore,
          attempts: quiz.attempts
        },
        simulation: {
          completed: simulation.completed,
          passed: simulation.passed,
          attempts: simulation.attempts
        }
      });
    }

    // Use same logic as admin to compute gameLessonsCompleted
    let gameLessonsCompleted = 0;
    const userGameProgress = userData.progress || {};
    if (typeof userData.lessonsCompleted === 'number') {
      gameLessonsCompleted = Math.min(6, Math.max(0, userData.lessonsCompleted));
    } else if (
      userData.gameProgress &&
      typeof userData.gameProgress.lessonsCompleted === 'number'
    ) {
      gameLessonsCompleted = Math.min(
        6,
        Math.max(0, userData.gameProgress.lessonsCompleted)
      );
    } else if (userGameProgress.gameLessons) {
      gameLessonsCompleted = Object.values(userGameProgress.gameLessons).filter(
        (l) => l && l.completed === true
      ).length;
        }

    const gameSection =
      gameLessons.length === 0 && gameLessonsCompleted === 0
        ? null
        : {
            lessons: gameLessons,
            totals: {
              gameLessonsCompleted
            }
          };

    // ------------------------
    // Build top-level user summary
    // ------------------------
    const profileEmail = userData.email || req.user?.email || studentData?.email || '';
    const profileName =
      userData.name ||
      studentData?.fullName ||
      studentData?.name ||
      profileEmail ||
      'Student';

    const userSummary = {
      uid: userId,
      name: profileName,
      email: profileEmail,
      role: 'student',
      batch: studentInfo.batch || studentData?.batch || '',
      assignedInstructorName,
      lastLogin: userData.lastLogin || userData.lastLoginDate || null
    };

    res.json({
      success: true,
      user: userSummary,
      lms: {
        lessons: lmsLessons,
        totals: lmsTotals
      },
      game: gameSection
    });
  } catch (error) {
    console.error('Get student LMS dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch student dashboard data' });
  }
});
router.get('/profile', verifyStudentToken, async (req, res) => {
  try {
    const { studentData: data, isUser } = await getUserData(req.userId);
    let studentData = data;
    if (!studentData) {
      studentData = {
        email: req.user.email,
        status: 'active',
        createdAt: new Date().toISOString()
      };
      const studentRef = db.ref(`students/${req.userId}`);
      await studentRef.set(studentData);
    }
    let completionScore = 0;
    const isVerified = studentData.isVerified || studentData.verified || false;
    
    if (isVerified) {
      completionScore = 50;
    } else {
      if (studentData.email) completionScore += 15;
      if (studentData.fullName) completionScore += 15;
      if (studentData.gender) completionScore += 10;
      if (studentData.studentNumber) completionScore += 15;
      if (studentData.batch) completionScore += 10;
      if (studentData.address) completionScore += 10;
      if (studentData.contactNumber) completionScore += 10;
      if (studentData.birthday) completionScore += 15;
    }
    res.json({
      success: true,
      data: {
        email: req.user.email,
        fullName: studentData.fullName || '',
        gender: studentData.gender || '',
        studentNumber: studentData.studentNumber || '',
        batch: studentData.batch || '',
        address: studentData.address || '',
        contactNumber: studentData.contactNumber || '',
        birthday: studentData.birthday || '',
        profilePicture: studentData.profilePicture || null,
        profileCompletion: completionScore,
        isVerified: isVerified
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});
router.put('/profile', verifyStudentToken, async (req, res) => {
  try {
    let { fullName, gender, studentNumber, batch, address, contactNumber, birthday, profilePicture } = req.body;
    if (typeof fullName === 'string') {
      fullName = fullName.trim();
    }
    const nameRegex = /^[A-Za-z\s]{1,60}$/;
    if (fullName && !nameRegex.test(fullName)) {
      return res.status(400).json({
        success: false,
        error: 'Full name must contain letters and spaces only (max 60 characters)'
      });
    }
    if (studentNumber && !/^\d+$/.test(studentNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Student number must contain only numbers'
      });
    }
    if (batch && !['2022', '2023', '2024', '2025'].includes(batch)) {
      return res.status(400).json({
        success: false,
        error: 'Batch must be one of: 2022, 2023, 2024, or 2025'
      });
    }
    let cleanedContactNumber = contactNumber;
    if (typeof contactNumber === 'string') {
      contactNumber = contactNumber.trim();
    }
    if (contactNumber) {
      const cleanContact = contactNumber.replace(/\D/g, '');
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
      cleanedContactNumber = cleanContact;
    }
    
    console.log('Profile update request received for userId:', req.userId);
    console.log('Profile update - ProfilePicture provided:', profilePicture !== undefined, 'Value:', profilePicture ? 'base64 string (' + profilePicture.length + ' chars)' : profilePicture);
    
    const { studentData: data, isUser } = await getUserData(req.userId);
    const existing = data || {};
    
    console.log('Profile update - Is user from users database:', isUser);
    console.log('Profile update - Existing data keys:', Object.keys(existing));
    if (isUser) {
      const userRef = db.ref(`users/${req.userId}`);
      const userSnapshot = await userRef.once('value');
      const userData = userSnapshot.val() || {};
      const existingStudentInfo = userData.studentInfo || {};
      
      const updatedUserData = {
        ...userData,
        email: req.user.email || userData.email,
        name: fullName !== undefined ? fullName : userData.name,
        updatedAt: new Date().toISOString(),
        studentInfo: {
          ...existingStudentInfo,
          gender: gender !== undefined ? gender : existingStudentInfo.gender,
          studentNumber: studentNumber !== undefined ? studentNumber : existingStudentInfo.studentNumber,
          batch: batch !== undefined ? batch : existingStudentInfo.batch,
          address: address !== undefined ? address : existingStudentInfo.address,
          contactNumber: contactNumber !== undefined ? cleanedContactNumber : existingStudentInfo.contactNumber,
          birthday: birthday !== undefined ? birthday : existingStudentInfo.birthday
        }
      };
      
      if (profilePicture !== undefined) {
        if (profilePicture === null || profilePicture === 'null') {
          delete updatedUserData.profilePicture;
        } else if (typeof profilePicture === 'string' && profilePicture.trim() !== '') {
          updatedUserData.profilePicture = profilePicture;
        }
      }
      
      let completionScore = 0;
      if (updatedUserData.email) completionScore += 15;
      if (updatedUserData.name) completionScore += 15;
      if (updatedUserData.studentInfo.gender) completionScore += 10;
      if (updatedUserData.studentInfo.studentNumber) completionScore += 15;
      if (updatedUserData.studentInfo.batch) completionScore += 10;
      if (updatedUserData.studentInfo.address) completionScore += 10;
      if (updatedUserData.studentInfo.contactNumber) completionScore += 10;
      if (updatedUserData.studentInfo.birthday) completionScore += 15;
      
      updatedUserData.profileCompletion = completionScore;
      
      if (completionScore >= 80) {
        updatedUserData.verified = true;
      }
      
      await userRef.set(updatedUserData);
      
      const savedUserData = (await userRef.once('value')).val() || {};
      const savedStudentInfo = savedUserData.studentInfo || {};
      
      return res.json({
        success: true,
        data: {
          email: savedUserData.email || updatedUserData.email,
          fullName: savedUserData.name || updatedUserData.name || '',
          gender: savedStudentInfo.gender || updatedUserData.studentInfo.gender || '',
          studentNumber: savedStudentInfo.studentNumber || updatedUserData.studentInfo.studentNumber || '',
          batch: savedStudentInfo.batch || updatedUserData.studentInfo.batch || '',
          address: savedStudentInfo.address || updatedUserData.studentInfo.address || '',
          contactNumber: savedStudentInfo.contactNumber || updatedUserData.studentInfo.contactNumber || '',
          birthday: savedStudentInfo.birthday || updatedUserData.studentInfo.birthday || '',
          profilePicture: savedUserData.profilePicture || null,
          profileCompletion: completionScore,
          isVerified: savedUserData.verified || (completionScore >= 80)
        }
      });
    }
    const studentRef = db.ref(`students/${req.userId}`);
    const snapshot = await studentRef.once('value');
    const studentExisting = snapshot.val() || {};
    const updatedData = {
      ...studentExisting,
      email: req.user.email || studentExisting.email,
      fullName: fullName !== undefined ? fullName : studentExisting.fullName,
      gender: gender !== undefined ? gender : studentExisting.gender,
      studentNumber: studentNumber !== undefined ? studentNumber : studentExisting.studentNumber,
      batch: batch !== undefined ? batch : studentExisting.batch,
      address: address !== undefined ? address : studentExisting.address,
      contactNumber: contactNumber !== undefined ? cleanedContactNumber : studentExisting.contactNumber,
      birthday: birthday !== undefined ? birthday : studentExisting.birthday,
      updatedAt: new Date().toISOString()
    };
    if (profilePicture !== undefined) {
      if (profilePicture === null || profilePicture === 'null') {
        delete updatedData.profilePicture;
        console.log('Removing profile picture from database');
      } else if (typeof profilePicture === 'string' && profilePicture.trim() !== '') {
        updatedData.profilePicture = profilePicture;
        console.log('Saving profile picture to database, length:', profilePicture.length);
      }
    }
    await studentRef.set(updatedData);
    
    const verifySnapshot = await studentRef.once('value');
    const savedData = verifySnapshot.val() || {};
    console.log('Profile saved. ProfilePicture in saved data:', savedData.hasOwnProperty('profilePicture') ? 'Yes (length: ' + (savedData.profilePicture?.length || 0) + ')' : 'No');
    let completionScore = 0;
    if (updatedData.email) completionScore += 15;
    if (updatedData.fullName) completionScore += 15;
    if (updatedData.gender) completionScore += 10;
    if (updatedData.studentNumber) completionScore += 15;
    if (updatedData.batch) completionScore += 10;
    if (updatedData.address) completionScore += 10;
    if (updatedData.contactNumber) completionScore += 10;
    if (updatedData.birthday) completionScore += 15;
    if (completionScore >= 80) {
      updatedData.isVerified = true;
      await studentRef.set(updatedData);
    }
    let profilePictureValue = null;
    if (savedData.hasOwnProperty('profilePicture') && savedData.profilePicture) {
      profilePictureValue = savedData.profilePicture;
      console.log('Profile picture found in saved data, length:', profilePictureValue.length);
    } else {
      console.log('No profile picture in saved data');
    }
    
    const responseData = {
      email: savedData.email || updatedData.email,
      fullName: savedData.fullName || updatedData.fullName || '',
      gender: savedData.gender || updatedData.gender || '',
      studentNumber: savedData.studentNumber || updatedData.studentNumber || '',
      batch: savedData.batch || updatedData.batch || '',
      address: savedData.address || updatedData.address || '',
      contactNumber: savedData.contactNumber || updatedData.contactNumber || '',
      birthday: savedData.birthday || updatedData.birthday || '',
      profilePicture: profilePictureValue,
      profileCompletion: completionScore,
      isVerified: savedData.isVerified || updatedData.isVerified || completionScore >= 80
    };
    console.log('Sending profile update response, profilePicture:', responseData.profilePicture ? 'Exists (' + (responseData.profilePicture.length || 0) + ' chars)' : 'null');
    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});
// ============================================
// LMS Lesson Pages API (for students)
// ============================================

// Get all pages for a lesson
router.get('/lessons/:slot/pages', verifyStudentToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    if (slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    const pagesRef = db.ref(`lmsLessons/${slot}/pages`);
    const snapshot = await pagesRef.once('value');
    const pages = snapshot.val() || {};
    
    // Get student progress for this lesson
    const { studentData, isUser } = await getUserData(req.userId);
    const progressRef = isUser 
      ? db.ref(`users/${req.userId}/lmsProgress/lesson${slot}`)
      : db.ref(`students/${req.userId}/lmsProgress/lesson${slot}`);
    const progressSnapshot = await progressRef.once('value');
    const progress = progressSnapshot.val() || {};
    const completedPages = progress.completedPages || {};
    
      // Build pages array with proper unlock logic
      const pagesList = Object.entries(pages)
      .map(([pageId, page]) => ({
        id: pageId,
        title: page.title || '',
        content: page.content || '',
        order: page.order || 0
      }))
      .sort((a, b) => a.order - b.order);
      
      const pagesArray = pagesList.map((page, index) => {
        const isCompleted = completedPages[page.id] === true;
        // First page (order 0) is always unlocked
        // Other pages are unlocked if previous page is completed
        let isUnlocked = false;
        if (index === 0) {
          isUnlocked = true;
        } else {
          const previousPage = pagesList[index - 1];
          isUnlocked = completedPages[previousPage.id] === true;
        }
        return {
          ...page,
          isCompleted,
          isUnlocked
        };
      });
    
    res.json({ success: true, pages: pagesArray });
  } catch (error) {
    console.error('Get lesson pages error:', error);
    res.status(500).json({ error: 'Failed to fetch lesson pages' });
  }
});

// Get assessments for a page
router.get('/lessons/:slot/pages/:pageId/assessments', verifyStudentToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    const { pageId } = req.params;
    
    if (slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    const assessmentsRef = db.ref(`lmsLessons/${slot}/pages/${pageId}/assessments`);
    const snapshot = await assessmentsRef.once('value');
    const assessments = snapshot.val() || {};
    
    // Return assessments without correct answers (for student view)
    const assessmentsArray = Object.entries(assessments)
      .map(([assessmentId, assessment]) => ({
        id: assessmentId,
        question: assessment.question || '',
        answerA: assessment.answerA || '',
        answerB: assessment.answerB || '',
        answerC: assessment.answerC || '',
        answerD: assessment.answerD || ''
        // Note: correctAnswer and explanation are not sent to students
      }));
    
    res.json({ success: true, assessments: assessmentsArray });
  } catch (error) {
    console.error('Get page assessments error:', error);
    res.status(500).json({ error: 'Failed to fetch page assessments' });
  }
});

// Submit assessment answers
router.post('/lessons/:slot/pages/:pageId/assessments/submit', verifyStudentToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot, 10);
    const { pageId } = req.params;
    const { answers } = req.body; // Object mapping assessmentId to selected answer (A, B, C, or D)
    const userId = req.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!Number.isFinite(slot) || slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Answers object is required' });
    }
    
    // Get correct answers from database
    const assessmentsRef = db.ref(`lmsLessons/${slot}/pages/${pageId}/assessments`);
    const snapshot = await assessmentsRef.once('value');
    const assessments = snapshot.val() || {};
    
    let correctCount = 0;
    let totalQuestions = 0;
    const results = {};
    const questions = [];
    
    Object.entries(assessments).forEach(([assessmentId, assessment]) => {
      totalQuestions++;
      const studentAnswer = answers[assessmentId] || null;
      const correctAnswer = assessment.correctAnswer || '';
      const isCorrect = studentAnswer === correctAnswer;
      
      if (isCorrect) {
        correctCount++;
      }
      
      results[assessmentId] = {
        studentAnswer,
        correctAnswer,
        isCorrect,
        explanation: assessment.explanation || ''
      };

      questions.push({
        id: assessmentId,
        question: assessment.question || '',
        options: {
          A: assessment.answerA || '',
          B: assessment.answerB || '',
          C: assessment.answerC || '',
          D: assessment.answerD || ''
        },
        correctOption: correctAnswer || '',
        selectedOption: studentAnswer,
        isCorrect
      });
    });
    
    const scorePercent = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
    const passed = scorePercent >= 70; // 70% passing threshold

    const submittedAt = new Date().toISOString();
    
    // Build answers array matching the spec structure
    const attemptAnswers = questions.map(q => ({
      assessmentId: q.id,
      questionText: q.question,
      selectedOption: q.selectedOption || '',
      correctOption: q.correctOption || '',
      isCorrect: q.isCorrect || false
    }));

    // Persist LMS assessment attempt history under users/{uid}/lmsAssessmentHistory
    const historyBaseRef = db.ref(`users/${userId}/lmsAssessmentHistory/lesson${slot}/page_${pageId}`);
    const historySnap = await historyBaseRef.once('value');
    const existingHistory = historySnap.val() || {};
    
    // Count existing attempts to determine attemptNumber
    const existingAttemptKeys = Object.keys(existingHistory).filter(key => key.startsWith('attempt_'));
    const attemptNumber = existingAttemptKeys.length + 1;
    const attemptId = `attempt_${Date.now()}`;

    // Build attempt object matching spec structure
    const attemptDetails = {
      attemptId,
      attemptNumber,
      lessonSlot: slot,
      pageId,
      scorePercent,
      correctCount,
      totalQuestions,
      passed,
      submittedAt,
      answers: attemptAnswers
    };

    // Save attempt to new history path
    await historyBaseRef.child(attemptId).set(attemptDetails);

    // Also maintain backward compatibility with lmsAssessments structure
    const pageAssessBaseRef = db.ref(`users/${userId}/lmsAssessments/lesson${slot}/pages/${pageId}`);
    const summaryRef = pageAssessBaseRef.child('summary');
    const attemptsRef = pageAssessBaseRef.child('attempts');

    const summarySnap = await summaryRef.once('value');
    const existingSummary = summarySnap.val() || {};

    // Build attemptDetails for backward compatibility (includes questions array)
    const legacyAttemptDetails = {
      submittedAt,
      scorePercent,
      passed,
      attemptNumber,
      questionCount: totalQuestions,
      questions
    };

    const newAttemptRef = attemptsRef.push();
    await newAttemptRef.set(legacyAttemptDetails);

    const bestScorePrev = Number(existingSummary.bestScorePercent || 0);
    const lastScorePercent = scorePercent;
    const bestScorePercent = Number.isFinite(bestScorePrev)
      ? Math.max(bestScorePrev, scorePercent)
      : scorePercent;
    const passedOnce = Boolean(existingSummary.passedOnce || passed);

    await summaryRef.set({
      totalAttempts: attemptNumber,
      lastScorePercent,
      bestScorePercent,
      passedOnce,
      lastAttemptAt: submittedAt,
      questionCount: totalQuestions
    });
    
    // Update student progress if passed (keep existing behavior / paths)
    if (passed) {
      const { studentData, isUser } = await getUserData(userId);
      const progressRef = isUser 
        ? db.ref(`users/${userId}/lmsProgress/lesson${slot}/completedPages/${pageId}`)
        : db.ref(`students/${userId}/lmsProgress/lesson${slot}/completedPages/${pageId}`);
      
      await progressRef.set(true);
      
      // Update last assessment timestamp
      const timestampRef = isUser
        ? db.ref(`users/${userId}/lmsProgress/lesson${slot}/lastAssessment`)
        : db.ref(`students/${userId}/lmsProgress/lesson${slot}/lastAssessment`);
      await timestampRef.set(submittedAt);
      
      const actorName =
        studentData?.fullName ||
        studentData?.name ||
        studentData?.email ||
        req.user.email ||
        'Student';
      await logActivity({
        type: 'lesson',
        action: 'assessment_completed',
        description: `Completed assessment for page ${pageId}`,
        actorType: 'student',
        actorId: userId,
        actorName,
        relatedLesson: slot,
        metadata: {
          pageId,
          score: scorePercent
        }
      });
    }
    
    res.json({
      success: true,
      passed,
      scorePercent,
      correctCount,
      questionCount: totalQuestions,
      results,
      attemptNumber,
      latestAttempt: attemptDetails, // New field: the attempt object just stored
      assessmentSummary: {
        totalAttempts: attemptNumber,
        bestScorePercent,
        lastScorePercent,
        passedOnce,
        lastAttemptAt: submittedAt
      },
      attemptDetails // Keep for backward compatibility
    });
  } catch (error) {
    console.error('Submit assessment error:', error);
    res.status(500).json({ error: 'Failed to submit assessment' });
  }
});

// GET /api/student/lessons/:slot/pages/:pageId/assessment/history
// Get all assessment attempts for a page
router.get('/lessons/:slot/pages/:pageId/assessment/history', verifyStudentToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot, 10);
    const { pageId } = req.params;
    const userId = req.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!Number.isFinite(slot) || slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    // Read from lmsAssessmentHistory
    const historyRef = db.ref(`users/${userId}/lmsAssessmentHistory/lesson${slot}/page_${pageId}`);
    const historySnap = await historyRef.once('value');
    const historyData = historySnap.val() || {};
    
    // Find all attempts (keys starting with 'attempt_')
    const attemptKeys = Object.keys(historyData).filter(key => key.startsWith('attempt_'));
    
    if (attemptKeys.length === 0) {
      return res.json({ success: true, attempts: [] });
    }
    
    // Get all attempts and sort by attemptNumber (ascending - 1, 2, 3, 4...)
    const attempts = attemptKeys.map(key => historyData[key]).filter(Boolean);
    attempts.sort((a, b) => {
      const aNum = Number(a.attemptNumber || 0);
      const bNum = Number(b.attemptNumber || 0);
      return aNum - bNum; // Ascending order (1, 2, 3, 4...)
    });
    
    // Fetch assessment data to get option texts
    const assessmentsRef = db.ref(`lmsLessons/${slot}/pages/${pageId}/assessments`);
    const assessmentsSnap = await assessmentsRef.once('value');
    const assessmentsData = assessmentsSnap.val() || {};
    
    // Convert all attempts to include questions with options
    const attemptsResponse = attempts.map(attempt => ({
      attemptId: attempt.attemptId,
      attemptNumber: attempt.attemptNumber,
      lessonSlot: attempt.lessonSlot,
      pageId: attempt.pageId,
      scorePercent: attempt.scorePercent,
      correctCount: attempt.correctCount,
      totalQuestions: attempt.totalQuestions,
      passed: attempt.passed,
      submittedAt: attempt.submittedAt,
      answers: attempt.answers || [],
      questions: (attempt.answers || []).map(ans => {
        const assessment = assessmentsData[ans.assessmentId] || {};
        return {
          id: ans.assessmentId,
          question: ans.questionText,
          selectedOption: ans.selectedOption,
          correctOption: ans.correctOption,
          isCorrect: ans.isCorrect,
          options: {
            A: assessment.answerA || '',
            B: assessment.answerB || '',
            C: assessment.answerC || '',
            D: assessment.answerD || ''
          }
        };
      })
    }));
    
    return res.json({ success: true, attempts: attemptsResponse });
  } catch (error) {
    console.error('Get assessment history error:', error);
    res.status(500).json({ error: 'Failed to fetch assessment history' });
  }
});

// GET /api/student/lessons/:slot/pages/:pageId/assessment/latest
// Get the most recent assessment attempt for a page (backward compatibility)
router.get('/lessons/:slot/pages/:pageId/assessment/latest', verifyStudentToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot, 10);
    const { pageId } = req.params;
    const userId = req.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!Number.isFinite(slot) || slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    // Read from lmsAssessmentHistory
    const historyRef = db.ref(`users/${userId}/lmsAssessmentHistory/lesson${slot}/page_${pageId}`);
    const historySnap = await historyRef.once('value');
    const historyData = historySnap.val() || {};
    
    // Find all attempts (keys starting with 'attempt_')
    const attemptKeys = Object.keys(historyData).filter(key => key.startsWith('attempt_'));
    
    if (attemptKeys.length === 0) {
      return res.json({ success: true, attempt: null });
    }
    
    // Get all attempts and find the one with highest attemptNumber
    const attempts = attemptKeys.map(key => historyData[key]).filter(Boolean);
    const latestAttempt = attempts.reduce((latest, current) => {
      const currentNum = Number(current.attemptNumber || 0);
      const latestNum = Number(latest.attemptNumber || 0);
      return currentNum > latestNum ? current : latest;
    }, attempts[0]);
    
    // Fetch assessment data to get option texts
    const assessmentsRef = db.ref(`lmsLessons/${slot}/pages/${pageId}/assessments`);
    const assessmentsSnap = await assessmentsRef.once('value');
    const assessmentsData = assessmentsSnap.val() || {};
    
    // Convert answers array to questions array format for frontend compatibility
    const attemptResponse = {
      attemptId: latestAttempt.attemptId,
      attemptNumber: latestAttempt.attemptNumber,
      lessonSlot: latestAttempt.lessonSlot,
      pageId: latestAttempt.pageId,
      scorePercent: latestAttempt.scorePercent,
      correctCount: latestAttempt.correctCount,
      totalQuestions: latestAttempt.totalQuestions,
      passed: latestAttempt.passed,
      submittedAt: latestAttempt.submittedAt,
      answers: latestAttempt.answers || [],
      questions: (latestAttempt.answers || []).map(ans => {
        const assessment = assessmentsData[ans.assessmentId] || {};
        return {
          id: ans.assessmentId,
          question: ans.questionText,
          selectedOption: ans.selectedOption,
          correctOption: ans.correctOption,
          isCorrect: ans.isCorrect,
          options: {
            A: assessment.answerA || '',
            B: assessment.answerB || '',
            C: assessment.answerC || '',
            D: assessment.answerD || ''
          }
        };
      })
    };
    
    return res.json({ success: true, attempt: attemptResponse });
  } catch (error) {
    console.error('Get latest assessment error:', error);
    res.status(500).json({ error: 'Failed to fetch latest assessment' });
  }
});

// POST /api/student/register-certificate
// Allow students to register their generated certificate in the central registry
router.post('/register-certificate', verifyStudentToken, async (req, res) => {
  try {
    const { certId, fullName, email, type, issuedAt } = req.body;
    
    if (!certId || !fullName) {
      return res.status(400).json({ error: 'certId and fullName are required' });
    }

    // Validate certId format (security check)
    if (!certId.startsWith('LMS-') && !certId.startsWith('PUB-')) {
       return res.status(400).json({ error: 'Invalid certificate ID format' });
    }

    // Write to central registry using Admin SDK (bypassing client rules)
    await db.ref(`certificates/${certId}`).set({
      type: type || 'lms_full',
      userId: req.userId,
      fullName,
      email: email || req.user.email || null,
      issuedAt: issuedAt || Date.now(),
      status: 'valid'
    });

    await logActivity({
      type: 'certificate',
      action: 'certificate_registered',
      description: `Student registered certificate ${certId}`,
      actorType: 'student',
      actorId: req.userId,
      actorName: fullName,
      metadata: { certId, type }
    });

    res.json({ success: true, message: 'Certificate registered successfully' });
  } catch (error) {
    console.error('Register certificate error:', error);
    res.status(500).json({ error: 'Failed to register certificate' });
  }
});

// ============================================
// Global Videos Library
// ============================================

// GET /api/student/videos - Get all global videos
router.get('/videos', verifyStudentToken, async (req, res) => {
  try {
    const videosRef = db.ref('videos');
    const snapshot = await videosRef.once('value');
    const videosData = snapshot.val() || {};
    
    const videos = Object.keys(videosData).map(id => ({
      id,
      title: videosData[id].title || 'Untitled',
      description: videosData[id].description || '',
      downloadUrl: videosData[id].downloadUrl || '',
      order: videosData[id].order !== undefined ? videosData[id].order : 999,
      createdAt: videosData[id].createdAt || null
    }));
    
    // Sort by order, then by createdAt
    videos.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
    
    res.json({ success: true, videos });
  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// ============================================
// Global Tools Library
// ============================================

// GET /api/student/tools - Get all tools aggregated from lessons
router.get('/tools', verifyStudentToken, async (req, res) => {
  try {
    const lessonsRef = db.ref('lessons');
    const snapshot = await lessonsRef.once('value');
    const lessonsData = snapshot.val() || {};
    
    const allTools = [];
    
    // Iterate through all lessons
    Object.keys(lessonsData).forEach(slot => {
      const lesson = lessonsData[slot];
      if (!lesson || !lesson.tools || typeof lesson.tools !== 'object') {
        return;
      }
      
      const lessonTitle = lesson.lessonTitle || lesson.lessonName || `Lesson ${slot}`;
      const lessonSlot = parseInt(slot, 10);
      
      // Extract tools from this lesson
      Object.keys(lesson.tools).forEach(toolId => {
        const tool = lesson.tools[toolId];
        if (!tool) return;
        
        allTools.push({
          id: `${slot}_${toolId}`, // Unique ID combining lesson slot and tool ID
          toolId,
          name: tool.name || 'Unnamed Tool',
          description: tool.description || '',
          category: tool.category || 'other',
          imageUrl: tool.imageUrl || tool.imageURL || null,
          modelUrl: tool.modelUrl || (tool.model ? tool.model.url : null) || null,
          instructions: tool.instructions || '',
          lessonSlot,
          lessonTitle,
          // Include model info if available
          modelType: tool.modelType || (tool.model ? tool.model.format : null) || null,
          storagePath: tool.storagePath || (tool.model ? tool.model.storagePath : null) || null
        });
      });
    });
    
    // Sort by lesson slot, then by tool name
    allTools.sort((a, b) => {
      if (a.lessonSlot !== b.lessonSlot) return a.lessonSlot - b.lessonSlot;
      return (a.name || '').localeCompare(b.name || '');
    });
    
    res.json({ success: true, tools: allTools });
  } catch (error) {
    console.error('Get tools error:', error);
    res.status(500).json({ error: 'Failed to fetch tools' });
  }
});

// ============================================
// LMS Page Time Spent Tracking
// ============================================

router.post('/lessons/:slot/pages/:pageId/time-spent', verifyStudentToken, async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const slot = req.params.slot;
    const pageId = req.params.pageId;
    const { deltaSeconds } = req.body || {};
    const delta = parseInt(deltaSeconds, 10);

    if (!Number.isFinite(delta) || delta <= 0 || delta > 3600) {
      return res.status(400).json({ error: 'Invalid deltaSeconds' });
    }

    const timeRef = db.ref(`users/${userId}/lmsTimeSpent/lesson${slot}/pages/${pageId}/totalSeconds`);

    await timeRef.transaction((current) => {
      const currentVal = parseInt(current || 0, 10);
      if (!Number.isFinite(currentVal) || currentVal < 0) return delta;
      return currentVal + delta;
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error updating LMS time spent:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// LMS Progress Summary
// ============================================

router.get('/progress/lms', verifyStudentToken, async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Load lessons metadata
    const lessonsSnap = await db.ref('lessons').once('value');
    const lessonsVal = lessonsSnap.val() || {};

    const lessonSlots = Object.keys(lessonsVal)
      .filter((key) => !isNaN(key))
      .map((key) => parseInt(key, 10))
      .sort((a, b) => a - b);

    const lessons = [];
    let totalLessons = 0;
    let lessonsCompleted = 0;
    let totalPagesCompleted = 0;
    let totalTimeSeconds = 0;
    let totalAssessmentsAllLessons = 0;
    let assessmentsPassedAllLessons = 0;
    let totalAssessmentAttemptsAllLessons = 0;
    let globalScoreSum = 0;
    let globalScoreCount = 0;

    for (const slot of lessonSlots) {
      const lessonData = lessonsVal[slot] || {};
      const rawStatus = (lessonData.status || '').toString().toLowerCase();
      const isPublished = rawStatus === 'published';
      if (!isPublished) continue;

      totalLessons++;

      // Load pages for this lesson
      const pagesSnap = await db.ref(`lmsLessons/${slot}/pages`).once('value');
      const pagesVal = pagesSnap.val() || {};
      const pageIds = Object.keys(pagesVal);
      const totalPages = pageIds.length;

      // Load LMS progress (completed pages) with legacy fallback
      let lessonProgressSnap = await db
        .ref(`users/${userId}/lmsProgress/lesson${slot}`)
        .once('value');
      let lessonProgress = lessonProgressSnap.val();

      if (!lessonProgress) {
        const legacySnap = await db
          .ref(`students/${userId}/lmsProgress/lesson${slot}`)
          .once('value');
        lessonProgress = legacySnap.val();
      }

      const completedPages = (lessonProgress && lessonProgress.completedPages) || {};
      const completedPagesCount = Object.keys(completedPages).filter(
        (key) => completedPages[key]
      ).length;

      // Load time spent for this lesson
      const timeSnap = await db
        .ref(`users/${userId}/lmsTimeSpent/lesson${slot}/pages`)
        .once('value');
      const timeVal = timeSnap.val() || {};

      let lessonTimeSeconds = 0;
      Object.values(timeVal).forEach((entry) => {
        const sec = parseInt((entry && entry.totalSeconds) || entry, 10);
        if (Number.isFinite(sec) && sec > 0) {
          lessonTimeSeconds += sec;
        }
      });

      totalPagesCompleted += completedPagesCount;
      totalTimeSeconds += lessonTimeSeconds;

      // -----------------------------------
      // Aggregate LMS assessment statistics
      // Read from lmsAssessmentHistory (new path) with fallback to lmsAssessments (legacy)
      // -----------------------------------
      const historySnap = await db
        .ref(`users/${userId}/lmsAssessmentHistory/lesson${slot}`)
        .once('value');
      const historyVal = historySnap.val() || {};
      
      // Also check legacy path for backward compatibility
      const assessmentsSnap = await db
        .ref(`users/${userId}/lmsAssessments/lesson${slot}/pages`)
        .once('value');
      const assessmentsVal = assessmentsSnap.val() || {};

      let totalAssessments = 0;
      let assessmentsPassed = 0;
      let totalAssessmentAttempts = 0;
      let lessonScoreSum = 0;
      let lessonScoreCount = 0;
      let bestScorePercent = 0;

      pageIds.forEach((pageId) => {
        const pageNode = pagesVal[pageId] || {};
        const hasDefinedAssessment =
          pageNode.assessments && typeof pageNode.assessments === 'object';

        // Try new history path first
        const pageHistoryKey = `page_${pageId}`;
        const pageHistory = historyVal[pageHistoryKey] || {};
        const attemptKeys = Object.keys(pageHistory).filter(key => key.startsWith('attempt_'));
        const attempts = attemptKeys.map(key => pageHistory[key]).filter(Boolean);
        
        // Fallback to legacy path
        const pageAssess = assessmentsVal[pageId] || {};
        const legacySummary = pageAssess.summary || null;

        if (!hasDefinedAssessment && attempts.length === 0 && !legacySummary) {
          return;
        }

        totalAssessments += 1;

        // Use new history path if available, otherwise fall back to legacy
        if (attempts.length > 0) {
          totalAssessmentAttempts += attempts.length;
          
          // Find best score from attempts
          const scores = attempts.map(a => Number(a.scorePercent || 0)).filter(Number.isFinite);
          if (scores.length > 0) {
            const pageBestScore = Math.max(...scores);
            if (pageBestScore > bestScorePercent) {
              bestScorePercent = pageBestScore;
            }
            lessonScoreSum += pageBestScore;
            lessonScoreCount += 1;
          }
          
          // Check if any attempt passed
          const hasPassed = attempts.some(a => Boolean(a.passed));
          if (hasPassed) {
            assessmentsPassed += 1;
          }
        } else if (legacySummary) {
          // Legacy path fallback
          const attempts = Number(legacySummary.totalAttempts || 0);
          if (attempts > 0) {
            totalAssessmentAttempts += attempts;
          }

          if (legacySummary.passedOnce) {
            assessmentsPassed += 1;
          }

          const bestScore = Number(legacySummary.bestScorePercent);
          if (Number.isFinite(bestScore) && bestScore >= 0) {
            lessonScoreSum += bestScore;
            lessonScoreCount += 1;
            if (bestScore > bestScorePercent) {
              bestScorePercent = bestScore;
            }
          }
        }
      });

      const averageScorePercent =
        lessonScoreCount > 0 ? Math.round(lessonScoreSum / lessonScoreCount) : 0;

      // Compute lesson status using same helper as dashboard
      const rawQuiz = normalizeQuiz((lessonProgress && lessonProgress.quiz) || {});
      const rawSimulation = normalizeSimulation(
        (lessonProgress && (lessonProgress.simulation || lessonProgress.sim)) || {}
      );
      // hasPages should be true only if ALL pages are completed (for completion status)
      const hasPages = totalPages > 0 && completedPagesCount >= totalPages;
      const hasProgressObject =
        lessonProgress &&
        typeof lessonProgress === 'object' &&
        Object.keys(lessonProgress).length > 0;

      const lessonStatus = computeLmsLessonStatus({
        hasPages,
        quiz: rawQuiz,
        simulation: rawSimulation,
        hasProgressObject
      });

      if (lessonStatus === 'completed') {
        lessonsCompleted += 1;
      }

      const pageProgressPercent =
        totalPages > 0 ? Math.round((completedPagesCount / totalPages) * 100) : 0;

      lessons.push({
        slot,
        lessonTitle:
          lessonData.lessonTitle || lessonData.lessonName || `Lesson ${slot}`,
        status: lessonStatus,
        totalPages,
        completedPagesCount,
        pageProgressPercent,
        timeSeconds: lessonTimeSeconds,
        assessmentStats: {
          totalAssessments,
          assessmentsPassed,
          totalAssessmentAttempts,
          averageScorePercent,
          assessmentBestScorePercent: bestScorePercent,
          assessmentAttempts: totalAssessmentAttempts
        }
      });

      totalAssessmentsAllLessons += totalAssessments;
      assessmentsPassedAllLessons += assessmentsPassed;
      totalAssessmentAttemptsAllLessons += totalAssessmentAttempts;
      if (averageScorePercent > 0 && totalAssessments > 0) {
        globalScoreSum += averageScorePercent;
        globalScoreCount += 1;
      }
    }

    return res.json({
      success: true,
      summary: {
        totalLessons,
        lessonsCompleted,
        totalPagesCompleted,
        totalTimeSeconds,
        totalAssessmentsAllLessons,
        assessmentsPassedAllLessons,
        totalAssessmentAttemptsAllLessons,
        totalAssessmentAttempts: totalAssessmentAttemptsAllLessons, // Alias for consistency
        averageAssessmentScoreAllLessons:
          globalScoreCount > 0 ? Math.round(globalScoreSum / globalScoreCount) : 0
      },
      lessons
    });
  } catch (error) {
    console.error('Error in GET /api/student/progress/lms:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Student Tools 3D Model Streaming (Proxy)
// ============================================

router.get('/tools/model', async (req, res) => {
  try {
    const { path: modelPath } = req.query;

    if (!modelPath) {
      return res.status(400).json({ error: 'Missing model path.' });
    }

    // Basic security check to ensure we only serve files from the tools directory
    if (!modelPath.startsWith('tools/')) {
      return res.status(400).json({ error: 'Invalid model path. Access denied.' });
    }

    if (!bucket) {
      return res.status(503).json({ error: 'Storage bucket not configured.' });
    }

    const file = bucket.file(modelPath);
    const [exists] = await file.exists();

    if (!exists) {
      return res.status(404).json({ error: 'Model file not found.' });
    }

    // Determine Content-Type
    let contentType = 'application/octet-stream';
    if (modelPath.endsWith('.glb')) contentType = 'model/gltf-binary';
    else if (modelPath.endsWith('.gltf')) contentType = 'model/gltf+json';
    else if (modelPath.endsWith('.fbx')) contentType = 'application/octet-stream';
    else if (modelPath.endsWith('.obj')) contentType = 'text/plain';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const readStream = file.createReadStream();

    readStream.on('error', (err) => {
      console.error('[student streamToolModel] Error streaming model:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream model file.' });
      } else {
        res.end();
      }
    });

    readStream.pipe(res);
  } catch (error) {
    console.error('[student streamToolModel] Unexpected error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error streaming model.' });
    }
  }
});

module.exports = router;