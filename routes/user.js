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
    const userRef = db.ref(`users/${req.userId}`);
    const snapshot = await userRef.once('value');
    let userData = snapshot.val();
    console.log('Raw userData from Firebase:', JSON.stringify(userData ? Object.keys(userData) : 'null'));
    if (!userData) {
      userData = {};
    }
    const lessonsRef = db.ref('lessons');
    const lessonsSnapshot = await lessonsRef.once('value');
    const allLessons = lessonsSnapshot.val() || {};
    
    const historyRef = db.ref(`users/${req.userId}/history/quizzes`);
    const historySnapshot = await historyRef.once('value');
    const allHistory = historySnapshot.val() || {};
    
    const simHistoryRef = db.ref(`users/${req.userId}/history/simulations`);
    const simHistorySnapshot = await simHistoryRef.once('value');
    const allSimHistory = simHistorySnapshot.val() || {};
    
    console.log('User Dashboard: Fetched all quiz history, entries:', Object.keys(allHistory || {}).length);
    console.log('User Dashboard: Fetched all simulation history, entries:', Object.keys(allSimHistory || {}).length);
    
    const lessons = [];
    for (let i = 1; i <= 6; i++) {
      const lesson = allLessons[i];
      
      const lessonData = {
        slot: i
      };
      
      if (lesson && lesson.lessonName) {
        lessonData.lessonName = lesson.lessonName;
        if (lesson.lessonDescription) {
          lessonData.lessonDescription = lesson.lessonDescription;
        }
      }
      
      const lessonHistory = [];
      if (allHistory && typeof allHistory === 'object') {
        Object.entries(allHistory).forEach(([timestamp, entry]) => {
          if (entry && entry.lesson === i) {
            const dateObj = new Date(timestamp);
            const dateStr = dateObj.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'short', 
              day: 'numeric' 
            });
            const timeStr = dateObj.toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit',
              hour12: true 
            });
            
            const durationSeconds = entry.time || 0;
            const mins = Math.floor(durationSeconds / 60);
            const secs = Math.floor(durationSeconds % 60);
            const durationStr = `${mins}m ${secs}s`;
            
            const score = entry.score || 0;
            const scoreStr = `${score} out of 10`;
            
            lessonHistory.push({
              timestamp: timestamp,
              date: dateStr,
              time: timeStr,
              duration: durationStr,
              durationSeconds: durationSeconds,
              score: score,
              scoreText: scoreStr
            });
          }
        });
        
        lessonHistory.sort((a, b) => {
          return new Date(b.timestamp) - new Date(a.timestamp);
        });
        
        console.log(`Lesson ${i} - Found ${lessonHistory.length} quiz history entries`);
      }
      
      const lessonSimHistory = [];
      const parseLessonNumber = (value) => {
        if (value === null || value === undefined) {
          return null;
        }
        if (typeof value === 'number' && !isNaN(value)) {
          return value;
        }
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (/^\d+$/.test(trimmed)) {
            return Number(trimmed);
          }
          const match = trimmed.match(/\d+/);
          if (match && match[0]) {
            return Number(match[0]);
          }
        }
        if (typeof value === 'object') {
          if ('slot' in value) {
            return parseLessonNumber(value.slot);
          }
          if ('number' in value) {
            return parseLessonNumber(value.number);
          }
          if ('lesson' in value) {
            return parseLessonNumber(value.lesson);
          }
        }
        return null;
      };

      if (allSimHistory && typeof allSimHistory === 'object') {
        Object.entries(allSimHistory).forEach(([timestamp, entry]) => {
          if (!entry || typeof entry !== 'object') {
            return;
          }
          const lessonRef = entry.lesson ?? entry.lessonId ?? entry.lessonNumber ?? entry.lessonSlot ?? entry.lessonIndex;
          const resolvedLesson = parseLessonNumber(lessonRef);
          const lessonMatch = resolvedLesson === i;
          if (lessonMatch) {
            const dateObj = new Date(timestamp);
            const dateStr = dateObj.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'short', 
              day: 'numeric' 
            });
            const timeStr = dateObj.toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit',
              hour12: true 
            });
            
            const durationSeconds = Number(entry.time || entry.duration || 0) || 0;
            const mins = Math.floor(durationSeconds / 60);
            const secs = Math.floor(durationSeconds % 60);
            const durationStr = `${mins}m ${secs}s`;
            
            lessonSimHistory.push({
              timestamp: timestamp,
              date: dateStr,
              time: timeStr,
              duration: durationStr,
              durationSeconds: durationSeconds,
              result: entry.result || entry.status || ''
            });
          }
        });
        
        lessonSimHistory.sort((a, b) => {
          return new Date(b.timestamp) - new Date(a.timestamp);
        });
        
        console.log(`Lesson ${i} - Found ${lessonSimHistory.length} simulation history entries`);
      }
      
      const lessonProgressRef = db.ref(`users/${req.userId}/progress/lesson${i}`);
      const progressSnapshot = await lessonProgressRef.once('value');
      const progress = progressSnapshot.val();
      
      console.log(`Lesson ${i} progress from users DB:`, JSON.stringify(progress));
      
      if (progress && typeof progress === 'object' && progress !== null) {
        const quizCompleted = progress.quiz?.completed || false;
        const simCompleted = progress.simulation?.completed || false;
        const quizAttempts = progress.quiz?.attempts || 0;
        const rawSimAttempts = progress.simulation?.attempts;
        const simAttemptsNumber = Number(rawSimAttempts);
        const simAttempts = !isNaN(simAttemptsNumber) && simAttemptsNumber > 0 ? simAttemptsNumber : 0;
        
        console.log(`Lesson ${i} - Quiz completed: ${quizCompleted}, Sim completed: ${simCompleted}, Quiz attempts: ${quizAttempts}, Sim attempts: ${simAttempts}`);
        
        let status = 'not_started';
        if (quizCompleted && simCompleted) {
          status = 'completed';
          console.log(`Lesson ${i} - Status: completed (both quiz and sim completed)`);
        } else if (quizCompleted || simCompleted || quizAttempts > 0 || simAttempts > 0) {
          status = 'in_progress';
          console.log(`Lesson ${i} - Status: in_progress (one or both incomplete)`);
        } else {
          console.log(`Lesson ${i} - Status: not_started (no attempts)`);
        }
        
        lessonData.status = status;
        lessonData.simAttempts = simAttempts;
        lessonData.simCompleted = simCompleted;
        
        if (progress.quiz) {
          const latestScore = progress.quiz.latestScore;
          if (latestScore !== null && latestScore !== undefined && typeof latestScore === 'number' && !isNaN(latestScore)) {
            lessonData.recentQuizScore = latestScore;
            console.log(`Lesson ${i} - Recent Quiz Score: ${latestScore}`);
          } else {
            console.log(`Lesson ${i} - Recent Quiz Score: MISSING or invalid (value: ${latestScore}, type: ${typeof latestScore})`);
          }
          
          const highestScore = progress.quiz.highestScore;
          if (highestScore !== null && highestScore !== undefined && typeof highestScore === 'number' && !isNaN(highestScore)) {
            lessonData.highestQuizScore = highestScore;
            console.log(`Lesson ${i} - Highest Quiz Score: ${highestScore}`);
          } else {
            console.log(`Lesson ${i} - Highest Quiz Score: MISSING or invalid (value: ${highestScore}, type: ${typeof highestScore})`);
          }
          
          const attempts = progress.quiz.attempts;
          if (attempts !== null && attempts !== undefined && typeof attempts === 'number' && !isNaN(attempts)) {
            lessonData.quizAttempts = attempts;
            console.log(`Lesson ${i} - Quiz Attempts: ${attempts}`);
          } else {
            console.log(`Lesson ${i} - Quiz Attempts: MISSING or invalid (value: ${attempts}, type: ${typeof attempts})`);
          }
          
          const avgTime = progress.quiz.avgTime;
          if (avgTime !== null && avgTime !== undefined && typeof avgTime === 'number' && !isNaN(avgTime) && avgTime > 0) {
            lessonData.avgQuizTime = avgTime;
            console.log(`Lesson ${i} - Avg Quiz Time: ${avgTime}`);
          } else {
            console.log(`Lesson ${i} - Avg Quiz Time: MISSING or invalid (value: ${avgTime}, type: ${typeof avgTime})`);
          }
        }
        
        if (progress.simulation) {
          const simAvgTime = typeof progress.simulation.avgTime === 'number' && !isNaN(progress.simulation.avgTime)
            ? progress.simulation.avgTime
            : 0;
          lessonData.avgSimTime = simAvgTime;
          if (simAvgTime > 0) {
            console.log(`Lesson ${i} - Avg Sim Time: ${simAvgTime}`);
          } else {
            console.log(`Lesson ${i} - Avg Sim Time: MISSING or invalid (value: ${progress.simulation.avgTime}, type: ${typeof progress.simulation.avgTime})`);
          }
        }
        
        console.log(`Lesson ${i} - Final lessonData:`, JSON.stringify(lessonData, null, 2));
      } else {
        lessonData.status = 'not_started';
        console.log(`Lesson ${i} - No progress data found, defaulting to not_started`);
      }
      
      if (lessonHistory.length > 0) {
        lessonData.quizHistory = lessonHistory;
        console.log(`Lesson ${i} - Quiz History: ${lessonHistory.length} entries from history/quizzes`);
        
        const totalScore = lessonHistory.reduce((sum, entry) => {
          const score = entry.score || 0;
          return sum + score;
        }, 0);
        const avgScore = lessonHistory.length > 0 ? totalScore / lessonHistory.length : 0;
        lessonData.avgQuizScore = Math.round(avgScore * 100) / 100;
        console.log(`Lesson ${i} - Average Quiz Score: ${lessonData.avgQuizScore} (calculated from ${lessonHistory.length} attempts, totalScore: ${totalScore})`);
      } else {
        const attempts = progress?.quiz?.attempts || 0;
        if (attempts > 0) {
          lessonData.quizHistory = [];
          console.log(`Lesson ${i} - Quiz History: No history found, but ${attempts} attempts exist`);
        }
        lessonData.avgQuizScore = null;
        console.log(`Lesson ${i} - Average Quiz Score: null (no history available)`);
      }
      
      if (lessonSimHistory.length > 0) {
        lessonData.simHistory = lessonSimHistory;
        console.log(`Lesson ${i} - Simulation History: ${lessonSimHistory.length} entries from history/simulations`);
      } else {
        lessonData.simHistory = [];
        const attemptsForLog = Number(lessonData.simAttempts) || Number(progress?.simulation?.attempts) || 0;
        if (attemptsForLog > 0) {
          console.log(`Lesson ${i} - Simulation History: No history found, but ${attemptsForLog} attempts exist`);
        }
      }
      
      lessons.push(lessonData);
    }
    const studentInfo = userData.studentInfo || {};
    const totalLessons = lessons.length || 0;
    const completedLessonsCount = lessons.filter(lesson => lessonStatusString(lesson.status) === 'completed').length;
    const normalizedQuizScores = lessons
      .map(lesson => normalizeQuizScore(lesson.recentQuizScore))
      .filter(score => score > 0);
    const averageQuizScore = normalizedQuizScores.length > 0
      ? normalizedQuizScores.reduce((sum, score) => sum + score, 0) / normalizedQuizScores.length
      : 0;
    const finalGradePercent = Math.round(averageQuizScore * 10) || 0;
    
    const simulationSummaries = lessons.map(lesson => {
      const status = hasLessonSimPassed(lesson)
        ? 'pass'
        : lessonHasSimActivity(lesson)
          ? 'pending'
          : 'not_started';
      const lastAttempt = Array.isArray(lesson.simHistory) && lesson.simHistory.length > 0
        ? lesson.simHistory[0].timestamp || null
        : null;
      const attempts = Array.isArray(lesson.simHistory)
        ? lesson.simHistory.length
        : Number(lesson.simAttempts || (lesson.simulation && lesson.simulation.attempts)) || 0;
      return {
        slot: lesson.slot,
        lessonName: lesson.lessonName || `Lesson ${lesson.slot}`,
        status,
        attempts,
        lastAttempt
      };
    });
    
    const lessonCompletionMet = totalLessons > 0 && completedLessonsCount === totalLessons;
    const simulationCompletionMet = simulationSummaries.length > 0
      ? simulationSummaries.every(summary => summary.status === 'pass')
      : false;
    const finalCourseMet = lessonCompletionMet && simulationCompletionMet && finalGradePercent >= 75;
    
    const certificateProgress = {
      lessonCompletion: lessonCompletionMet,
      simulationCompletion: simulationCompletionMet,
      finalCourse: finalCourseMet,
      finalGradePercent
    };
    
    const lessonCertificates = lessons
      .map(lesson => {
        const normalizedScore = normalizeQuizScore(lesson.recentQuizScore);
        const quizPassed = normalizedScore >= 6;
        const statusValue = lessonStatusString(lesson.status);
        if (statusValue === 'completed' && quizPassed) {
          const issuedTimestamp = Array.isArray(lesson.quizHistory) && lesson.quizHistory.length > 0
            ? lesson.quizHistory[0].timestamp
            : null;
          return {
            id: `lesson-${lesson.slot}`,
            type: 'lesson',
            lessonSlot: lesson.slot,
            title: lesson.lessonName || `Lesson ${lesson.slot} Certificate`,
            date: issuedTimestamp || new Date().toISOString(),
            status: 'issued'
          };
        }
        return null;
      })
      .filter(Boolean);
    
    const computedCertificates = [...lessonCertificates];
    if (simulationCompletionMet) {
      computedCertificates.push({
        id: 'simulation-completion',
        type: 'simulation',
        title: 'Simulation Completion Certificate',
        date: new Date().toISOString(),
        status: 'issued'
      });
    }
    if (finalCourseMet) {
      computedCertificates.push({
        id: 'overall-course',
        type: 'course',
        title: 'Overall Course Certificate',
        date: new Date().toISOString(),
        status: 'issued'
      });
    }
    
    const [certificatesSnapshot, announcementsSnapshot] = await Promise.all([
      db.ref(`users/${req.userId}/certificates`).once('value'),
      db.ref('announcements').once('value')
    ]);
    
    const storedCertificatesData = certificatesSnapshot.val() || {};
    const storedCertificates = Object.entries(storedCertificatesData).map(([id, cert]) => ({
      id,
      type: cert.type || (cert.lessonSlot ? 'lesson' : 'course'),
      lessonSlot: cert.lessonSlot !== undefined ? Number(cert.lessonSlot) : null,
      title: cert.title || cert.name || (cert.lessonSlot ? `Lesson ${cert.lessonSlot} Certificate` : 'Certificate'),
      date: cert.date || cert.issuedAt || cert.createdAt || null,
      status: cert.status || 'issued',
      downloadUrl: cert.downloadUrl || null
    }));
    
    const certificateMap = new Map();
    storedCertificates.forEach(cert => {
      const key = cert.id || `${cert.type}-${cert.lessonSlot || 'general'}`;
      certificateMap.set(key, cert);
    });
    computedCertificates.forEach(cert => {
      const key = cert.id || `${cert.type}-${cert.lessonSlot || 'general'}`;
      if (certificateMap.has(key)) {
        certificateMap.set(key, { ...certificateMap.get(key), ...cert });
      } else {
        certificateMap.set(key, cert);
      }
    });
    const certificates = Array.from(certificateMap.values());
    
    const announcementsData = announcementsSnapshot.val() || {};
    const announcements = Object.values(announcementsData)
      .filter(announcement => announcementMatchesStudent(announcement, studentInfo))
      .map(announcement => ({
        id: announcement.id || '',
        title: announcement.title || 'Announcement',
        message: announcement.message || announcement.content || '',
        audience: announcement.audience || 'students',
        pinned: !!announcement.pinned,
        instructorId: announcement.instructorId || null,
        date: announcement.createdAt || announcement.updatedAt || new Date().toISOString()
      }))
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.date || 0) - new Date(a.date || 0);
      })
      .slice(0, 10);
    
    const isVerified = userData.verified === true || userData.verified === 'true';
    let completionScore = 0;
    
    console.log('User Dashboard: Raw verified value from DB:', userData.verified, 'Type:', typeof userData.verified);
    console.log('User Dashboard: isVerified after check:', isVerified);
    
    if (userData.email) completionScore += 15;
    if (userData.name) completionScore += 15;
    if (studentInfo.gender) completionScore += 10;
    if (studentInfo.studentNumber) completionScore += 15;
    if (studentInfo.batch) completionScore += 10;
    if (studentInfo.address) completionScore += 10;
    if (studentInfo.contactNumber) completionScore += 10;
    if (studentInfo.birthday) completionScore += 15;
    
    console.log('User Dashboard: Calculated completion score before verified check:', completionScore);
    
    if (!isVerified) {
      console.log('User Dashboard: Verified is false, checking if completion < 50');
      if (completionScore < 50) {
        console.log('User Dashboard: Setting completion to 50% (was:', completionScore + ')');
        completionScore = 50;
      } else {
        console.log('User Dashboard: Completion already >= 50%, keeping:', completionScore);
      }
    } else {
      console.log('User Dashboard: Verified is true, using calculated score:', completionScore);
    }
    let profilePictureValue = null;
    console.log('User Dashboard: Checking for profilePicture...');
    console.log('User Dashboard: userData type:', typeof userData);
    console.log('User Dashboard: userData keys:', userData ? Object.keys(userData) : 'null');
    
    if (userData && typeof userData === 'object' && userData !== null) {
      if ('profilePicture' in userData) {
        const picValue = userData.profilePicture;
        console.log('User Dashboard: profilePicture field found, type:', typeof picValue);
        
        if (picValue && typeof picValue === 'string' && picValue.trim() !== '' && picValue !== 'null' && picValue !== 'undefined') {
          profilePictureValue = picValue;
          console.log('User Dashboard: Profile picture VALID, length:', picValue.length);
        }
      }
    }
    console.log('User Dashboard: Final profilePictureValue:', profilePictureValue ? 'Yes (' + (profilePictureValue.length || 0) + ' chars)' : 'No/null');
    const userName = userData.name || '';
    const responseData = {
      email: userData.email || req.user.email || '',
      name: userName,
      fullName: userName,
      status: 'active',
      certificates,
      certificateProgress,
      announcements,
      simulations: simulationSummaries,
      lessons: lessons,
      profileCompletion: completionScore,
      verified: isVerified,
      isVerified: isVerified,
      gender: studentInfo.gender || '',
      studentNumber: studentInfo.studentNumber || '',
      batch: studentInfo.batch || '',
      address: studentInfo.address || '',
      contactNumber: studentInfo.contactNumber || '',
      birthday: studentInfo.birthday || '',
      school: studentInfo.school || '',
      profilePicture: profilePictureValue !== undefined ? profilePictureValue : null
    };
    
    console.log('User Dashboard: Response being sent');
    console.log('User Dashboard: Lessons count:', lessons.length);
    lessons.forEach((lesson, idx) => {
      if (lesson.quizHistory && Array.isArray(lesson.quizHistory)) {
        console.log(`Lesson ${lesson.slot || idx + 1} - quizHistory array length: ${lesson.quizHistory.length}`);
        if (lesson.quizHistory.length > 0) {
          console.log(`Lesson ${lesson.slot || idx + 1} - First history entry:`, JSON.stringify(lesson.quizHistory[0]));
        }
      } else {
        console.log(`Lesson ${lesson.slot || idx + 1} - No quizHistory found`);
      }
    });
    console.log('User Dashboard: Lessons data (full):', JSON.stringify(lessons, null, 2));
    if (lessons.length > 0) {
      console.log('User Dashboard: First lesson keys:', Object.keys(lessons[0]));
      console.log('User Dashboard: First lesson data:', JSON.stringify(lessons[0], null, 2));
    }
    console.log('User Dashboard: Profile completion:', completionScore);
    console.log('User Dashboard: Is verified:', isVerified);
    console.log('User Dashboard: User name:', userName);
    console.log('User Dashboard: User email:', userData.email || req.user.email);
    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Get user dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch user dashboard data' });
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