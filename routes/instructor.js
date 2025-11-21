const express = require('express');
const router = express.Router();
const { verifyInstructorToken } = require('../middleware/auth');
const { db } = require('../config/firebase');

/**
 * GET /api/instructor/dashboard
 * Returns dashboard statistics and recent activity
 */
router.get('/dashboard', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    
    // Get all students assigned to this instructor
    const usersRef = db.ref('users');
    const usersSnapshot = await usersRef.once('value');
    const usersData = usersSnapshot.val() || {};
    
    const assignedStudents = [];
    let totalQuizScore = 0;
    let totalQuizCount = 0;
    let totalSimulations = 0;
    let completedSimulations = 0;
    const recentActivity = [];
    
    // Find students assigned to this instructor
    for (const [uid, userData] of Object.entries(usersData)) {
      if (userData.role === 'student' && userData.assignedInstructor === instructorId) {
        assignedStudents.push(uid);
        
        const progress = userData.progress || {};
        const history = userData.history || {};
        const quizzes = history.quizzes || {};
        const simulations = history.simulations || {};
        
        // Calculate quiz scores
        // Quiz scores are stored as raw scores out of 10 (0-10), keep as raw scores
        // Only count quizzes that have actually been taken (not lessons with no quiz attempts)
        
        // Use history/quizzes as primary source (most accurate - represents actual quiz attempts)
        // Only use progress if history doesn't have data for that lesson
        const lessonsWithHistoryQuizzes = new Set();
        
        // First, count all quiz attempts from history (these are actual quiz takes)
        for (const [quizId, quizData] of Object.entries(quizzes)) {
          if (quizData && typeof quizData.score === 'number') {
            // Count all quiz attempts from history (they represent actual quiz takes)
            totalQuizScore += quizData.score;
            totalQuizCount += 1;
            
            // Track which lesson this quiz belongs to
            const lessonNum = typeof quizData.lesson === 'number' ? quizData.lesson : 
                             (typeof quizData.lesson === 'string' && quizData.lesson.match(/\d+/)) ? 
                             parseInt(quizData.lesson.match(/\d+/)[0]) : null;
            if (lessonNum) {
              lessonsWithHistoryQuizzes.add(lessonNum);
            }
            
            // Add to recent activity
            recentActivity.push({
              uid,
              name: userData.name || 'Unknown',
              type: 'quiz',
              lesson: quizData.lesson || 'Unknown',
              scoreOrResult: `${quizData.score} / 10`,
              date: quizData.timestamp || quizData.date || new Date().toISOString()
            });
          }
        }
        
        // Only use progress scores if history doesn't have data for that lesson
        for (let i = 1; i <= 6; i++) {
          if (!lessonsWithHistoryQuizzes.has(i)) {
            const lessonProgress = progress[`lesson${i}`] || {};
            const quiz = lessonProgress.quiz || {};
            // Only include if quiz was actually taken (has a score)
            if (quiz.highestScore !== undefined && typeof quiz.highestScore === 'number') {
              totalQuizScore += quiz.highestScore;
              totalQuizCount += 1;
            }
          }
        }
        
        // Calculate simulation completion
        for (const [simId, simData] of Object.entries(simulations)) {
          totalSimulations += 1;
          if (simData && simData.completed) {
            completedSimulations += 1;
            
            // Add to recent activity
            recentActivity.push({
              uid,
              name: userData.name || 'Unknown',
              type: 'simulation',
              lesson: simData.lesson || 'Unknown',
              scoreOrResult: simData.passed ? 'Passed' : 'Failed',
              date: simData.timestamp || simData.date || new Date().toISOString()
            });
          }
        }
      }
    }
    
    // Calculate at-risk students and attention metrics
    let atRiskStudents = 0;
    let inactiveStudents = 0;
    let noSimulationsCompleted = 0;
    
    for (const uid of assignedStudents) {
      const userData = usersData[uid];
      const progress = userData.progress || {};
      const history = userData.history || {};
      const quizzes = history.quizzes || {};
      const simulations = history.simulations || {};
      
      let studentQuizScore = 0;
      let studentQuizCount = 0;
      let hasAnyActivity = false;
      
      // Check progress for quiz scores - keep as raw scores (0-10)
      // Only count quizzes that have actually been taken
      for (let i = 1; i <= 6; i++) {
        const lessonProgress = progress[`lesson${i}`] || {};
        const quiz = lessonProgress.quiz || {};
        const simulation = lessonProgress.simulation || {};
        
        // Only include if quiz was actually taken (has a score)
        if (quiz.highestScore !== undefined && typeof quiz.highestScore === 'number') {
          studentQuizScore += quiz.highestScore;
          studentQuizCount += 1;
          hasAnyActivity = true;
        }
        
        if (simulation.completed) {
          hasAnyActivity = true;
        }
      }
      
      // Count all quiz attempts from history
      for (const [quizId, quizData] of Object.entries(quizzes)) {
        // Only include if quiz was actually taken (has a score)
        if (quizData && typeof quizData.score === 'number') {
          studentQuizScore += quizData.score;
          studentQuizCount += 1;
          hasAnyActivity = true;
        }
      }
      
      const avgScore = studentQuizCount > 0 ? studentQuizScore / studentQuizCount : 0;
      const hasSimulations = Object.keys(simulations || {}).length > 0;
      const hasCompletedSimulations = Object.values(simulations || {}).some(sim => sim && sim.completed);
      
      // At-risk: avg quiz < 6/10 (60%) OR no simulations completed
      if (avgScore < 6 || !hasCompletedSimulations) {
        atRiskStudents += 1;
      }
      
      // Inactive: no activity at all
      if (!hasAnyActivity && !hasSimulations) {
        inactiveStudents += 1;
      }
      
      // No simulations completed
      if (!hasCompletedSimulations) {
        noSimulationsCompleted += 1;
      }
    }
    
    // Sort recent activity by date (newest first)
    recentActivity.sort((a, b) => new Date(b.date) - new Date(a.date));
    const topRecentActivity = recentActivity.slice(0, 10);
    
    // avgQuizScore is in raw format (0-10)
    const avgQuizScore = totalQuizCount > 0 ? totalQuizScore / totalQuizCount : 0;
    const avgSimulationCompletionRate = totalSimulations > 0 
      ? (completedSimulations / totalSimulations) * 100 
      : 0;
    
    // Calculate lesson performance for class overview
    const lessonsRef = db.ref('lessons');
    const lessonsSnapshot = await lessonsRef.once('value');
    const lessonsData = lessonsSnapshot.val() || {};
    
    const lessonPerformance = [];
    for (let i = 1; i <= 6; i++) {
      const lessonKey = `lesson${i}`;
      const lessonData = lessonsData[i] || {};
      let lessonQuizScores = [];
      let lessonCompletions = 0;
      let lessonTotalStudents = 0;
      
      for (const uid of assignedStudents) {
        const userData = usersData[uid];
        const progress = userData.progress || {};
        const lessonProgress = progress[lessonKey] || {};
        const quiz = lessonProgress.quiz || {};
        const simulation = lessonProgress.simulation || {};
        
        lessonTotalStudents += 1;
        
        if (quiz.highestScore !== undefined) {
          // Keep as raw score (0-10)
          lessonQuizScores.push(quiz.highestScore);
        }
        
        if (quiz.completed && simulation.completed) {
          lessonCompletions += 1;
        }
      }
      
      // avgLessonScore is in raw format (0-10)
      const avgLessonScore = lessonQuizScores.length > 0
        ? lessonQuizScores.reduce((sum, score) => sum + score, 0) / lessonQuizScores.length
        : 0;
      const completionRate = lessonTotalStudents > 0
        ? (lessonCompletions / lessonTotalStudents) * 100
        : 0;
      
      lessonPerformance.push({
        lessonId: i,
        lessonTitle: lessonData.lessonTitle || lessonData.lessonName || `Lesson ${i}`,
        avgQuizScore: Math.round(avgLessonScore * 10) / 10, // Raw score (0-10), round to 1 decimal
        completionRate: Math.round(completionRate * 100) / 100
      });
    }
    
    // Return avgQuizScore as raw score (0-10) for display as "X.X / 10"
    res.json({
      success: true,
      stats: {
        totalStudents: assignedStudents.length,
        activeStudents: assignedStudents.length, // Can be enhanced with active/inactive logic
        avgQuizScore: Math.round(avgQuizScore * 10) / 10, // Raw score (0-10), round to 1 decimal
        avgSimulationCompletionRate: Math.round(avgSimulationCompletionRate * 100) / 100,
        atRiskStudents,
        inactiveStudents,
        noSimulationsCompleted
      },
      recentActivity: topRecentActivity,
      lessonPerformance
    });
  } catch (error) {
    console.error('Instructor dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

/**
 * GET /api/instructor/class-list
 * Returns list of students assigned to this instructor
 */
router.get('/class-list', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    
    const usersRef = db.ref('users');
    const usersSnapshot = await usersRef.once('value');
    const usersData = usersSnapshot.val() || {};
    
    const students = [];
    
    for (const [uid, userData] of Object.entries(usersData)) {
      if (userData.role === 'student' && userData.assignedInstructor === instructorId) {
        const studentInfo = userData.studentInfo || {};
        const progress = userData.progress || {};
        const history = userData.history || {};
        
        // Calculate progress
        let lessonsCompleted = 0;
        let totalLessons = 6; // Assuming 6 lessons
        let totalQuizScore = 0;
        let totalQuizCount = 0;
        let simulationsCompleted = 0;
        let totalSimulations = 0;
        
        for (let i = 1; i <= 6; i++) {
          const lessonProgress = progress[`lesson${i}`] || {};
          const quiz = lessonProgress.quiz || {};
          const simulation = lessonProgress.simulation || {};
          
          if (quiz.completed) {
            lessonsCompleted += 1;
          }
          
          if (simulation.completed) {
            simulationsCompleted += 1;
          }
          
          if (quiz.highestScore !== undefined) {
            // Keep as raw score (0-10)
            totalQuizScore += quiz.highestScore;
            totalQuizCount += 1;
          }
          
          if (simulation.completed !== undefined) {
            totalSimulations += 1;
          }
        }
        
        // Also check history for quiz scores - keep as raw scores (0-10)
        const quizzes = history.quizzes || {};
        for (const [quizId, quizData] of Object.entries(quizzes)) {
          if (quizData && typeof quizData.score === 'number') {
            // Keep as raw score (0-10)
            totalQuizScore += quizData.score;
            totalQuizCount += 1;
          }
        }
        
        // avgQuizScore is in raw format (0-10)
        const avgQuizScore = totalQuizCount > 0 ? totalQuizScore / totalQuizCount : 0;
        
        // Determine status (avgQuizScore is in raw format 0-10)
        let status = 'On Track';
        if (avgQuizScore < 6 || simulationsCompleted === 0) { // 6/10 = 60%
          status = 'At Risk';
        } else if (lessonsCompleted === 0) {
          status = 'Inactive';
        }
        
        students.push({
          uid,
          name: userData.name || '',
          email: userData.email || '',
          studentNumber: studentInfo.studentNumber || '',
          batch: studentInfo.batch || '',
          school: studentInfo.school || '',
          progress: {
            lessonsCompleted,
            totalLessons,
            avgQuizScore: Math.round(avgQuizScore * 10) / 10, // Raw score (0-10), round to 1 decimal
            simulationsCompleted,
            totalSimulations
          },
          status
        });
      }
    }
    
    res.json({ success: true, students });
  } catch (error) {
    console.error('Instructor class list error:', error);
    res.status(500).json({ error: 'Failed to fetch class list' });
  }
});

/**
 * GET /api/instructor/students/:uid
 * Returns detailed view for a single student
 */
router.get('/students/:uid', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { uid } = req.params;
    
    const userRef = db.ref(`users/${uid}`);
    const userSnapshot = await userRef.once('value');
    const userData = userSnapshot.val();
    
    if (!userData) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    // Verify student is assigned to this instructor
    if (userData.assignedInstructor !== instructorId) {
      return res.status(403).json({ error: 'Student not assigned to this instructor' });
    }
    
    const progress = userData.progress || {};
    const history = userData.history || {};
    const quizzes = history.quizzes || {};
    const simulations = history.simulations || {};
    
    // Build lesson progress
    const lessonProgress = {};
    for (let i = 1; i <= 6; i++) {
      const lessonKey = `lesson${i}`;
      const lessonData = progress[lessonKey] || {};
      
      lessonProgress[lessonKey] = {
        quiz: lessonData.quiz || {},
        simulation: lessonData.simulation || {}
      };
    }
    
    // Build quiz history array
    const quizHistory = [];
    for (const [quizId, quizData] of Object.entries(quizzes)) {
      if (quizData) {
        const lessonValue = quizData.lesson || quizData.lessonId || quizData.lessonNumber;
        let lessonNumber = null;
        if (typeof lessonValue === 'number') {
          lessonNumber = lessonValue;
        } else if (typeof lessonValue === 'string') {
          const match = lessonValue.match(/\d+/);
          if (match) {
            lessonNumber = parseInt(match[0], 10);
          }
        }

        let fallbackTimestamp = null;
        if (lessonNumber) {
          const lessonKey = `lesson${lessonNumber}`;
          const lessonData = progress[lessonKey]?.quiz || {};
          fallbackTimestamp = lessonData.lastAttempt || lessonData.completedAt || lessonData.updatedAt || null;
        }

        let timestampFromKey = null;
        if (quizId && !Number.isNaN(Date.parse(quizId))) {
          timestampFromKey = new Date(quizId).toISOString();
        }

        const timestamp =
          quizData.timestamp ||
          quizData.date ||
          quizData.completedAt ||
          quizData.lastAttempt ||
          quizData.createdAt ||
          quizData.updatedAt ||
          timestampFromKey ||
          fallbackTimestamp ||
          null;

        quizHistory.push({
          id: quizId,
          lesson: quizData.lesson || 'Unknown',
          score: quizData.score || 0,
          timestamp,
          ...quizData
        });
      }
    }
    quizHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Build simulation history array
    const simulationHistory = [];
    for (const [simId, simData] of Object.entries(simulations)) {
      if (simData) {
        simulationHistory.push({
          id: simId,
          lesson: simData.lesson || 'Unknown',
          completed: simData.completed || false,
          passed: simData.passed || false,
          timestamp: simData.timestamp || simData.date || '',
          ...simData
        });
      }
    }
    simulationHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Check for certificates (if they exist in the database)
    const certificatesRef = db.ref(`users/${uid}/certificates`);
    const certificatesSnapshot = await certificatesRef.once('value');
    const certificates = certificatesSnapshot.val() || {};
    
    res.json({
      success: true,
      student: {
        uid,
        name: userData.name || '',
        email: userData.email || '',
        studentInfo: userData.studentInfo || {},
        progress: {
          lessons: lessonProgress
        },
        quizHistory,
        simulationHistory,
        certificates
      }
    });
  } catch (error) {
    console.error('Instructor student detail error:', error);
    res.status(500).json({ error: 'Failed to fetch student details' });
  }
});

/**
 * POST /api/instructor/students/:uid/notes
 * Allows an instructor to send a note/message to a specific student.
 * Notes are stored under users/{uid}/instructorNotes and can be surfaced on the student side.
 */
router.post('/students/:uid/notes', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const instructor = req.instructor || {};
    const { uid } = req.params;
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const userRef = db.ref(`users/${uid}`);
    const userSnapshot = await userRef.once('value');
    const userData = userSnapshot.val();

    if (!userData) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Verify student is assigned to this instructor
    if (userData.assignedInstructor !== instructorId) {
      return res.status(403).json({ error: 'Student not assigned to this instructor' });
    }

    const notesRef = db.ref(`users/${uid}/instructorNotes`).push();
    const noteId = notesRef.key;

    const notePayload = {
      id: noteId,
      instructorId,
      instructorName: instructor.name || instructor.fullName || instructor.email || 'Instructor',
      message: message.trim(),
      createdAt: new Date().toISOString(),
      read: false,
    };

    await notesRef.set(notePayload);

    res.json({ success: true, note: notePayload });
  } catch (error) {
    console.error('Instructor student note error:', error);
    res.status(500).json({ error: 'Failed to send note' });
  }
});

/**
 * GET /api/instructor/assessments
 * Returns assessment overview for assigned students only
 */
router.get('/assessments', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    
    const usersRef = db.ref('users');
    const usersSnapshot = await usersRef.once('value');
    const usersData = usersSnapshot.val() || {};
    
    // Get lessons metadata
    const lessonsRef = db.ref('lessons');
    const lessonsSnapshot = await lessonsRef.once('value');
    const lessonsData = lessonsSnapshot.val() || {};
    
    // Aggregate data per lesson - only for assigned students
    const lessonStats = {};
    let totalQuizAttempts = 0;
    let totalQuizScore = 0;
    let totalQuizCount = 0;
    let totalSimulations = 0;
    let completedSimulations = 0;
    let passedSimulations = 0;
    let atRiskStudents = 0;
    
    // Track simulation status summary
    let studentsCompletedAllSims = 0;
    let studentsInProgress = 0;
    let studentsNotStarted = 0;
    const totalAssignedStudents = [];
    
    for (const [uid, userData] of Object.entries(usersData)) {
      if (userData.role === 'student' && userData.assignedInstructor === instructorId) {
        totalAssignedStudents.push(uid);
        const progress = userData.progress || {};
        const history = userData.history || {};
        const quizzes = history.quizzes || {};
        const simulations = history.simulations || {};
        
        // Track student's quiz scores for at-risk calculation
        const studentQuizScores = [];
        
        // Track student's simulation completions
        const studentSimCompletions = new Set();
        
        for (let i = 1; i <= 6; i++) {
          const lessonKey = `lesson${i}`;
          if (!lessonStats[lessonKey]) {
            lessonStats[lessonKey] = {
              lessonId: i,
              lessonTitle: lessonsData[i]?.lessonTitle || lessonsData[i]?.lessonName || `Lesson ${i}`,
              quizScores: [],
              quizAttempts: 0,
              quizPasses: 0,
              simulationPasses: 0,
              simulationTotal: 0,
              completions: 0,
              totalStudents: 0
            };
          }
          
          const lessonProgress = progress[lessonKey] || {};
          const quiz = lessonProgress.quiz || {};
          const simulation = lessonProgress.simulation || {};
          
          lessonStats[lessonKey].totalStudents += 1;
          
          // Quiz data - only count quizzes that have been taken
          // Use history as primary source (actual quiz attempts)
          let lessonHasQuizInHistory = false;
          for (const [quizId, quizData] of Object.entries(quizzes)) {
            const quizLessonNum = typeof quizData.lesson === 'number' ? quizData.lesson : 
                                 (typeof quizData.lesson === 'string' && quizData.lesson.match(/\d+/)) ? 
                                 parseInt(quizData.lesson.match(/\d+/)[0]) : null;
            
            if (quizLessonNum === i && quizData && typeof quizData.score === 'number') {
              // Count all quiz attempts from history
              const rawScore = quizData.score;
              lessonStats[lessonKey].quizScores.push(rawScore);
              lessonStats[lessonKey].quizAttempts += 1;
              totalQuizAttempts += 1;
              totalQuizScore += rawScore;
              totalQuizCount += 1;
              studentQuizScores.push(rawScore);
              
              if (rawScore >= 6) { // 6/10 threshold (60%)
                lessonStats[lessonKey].quizPasses += 1;
              }
              lessonHasQuizInHistory = true;
            }
          }
          
          // Only use progress if history doesn't have data for this lesson
          if (!lessonHasQuizInHistory && quiz.highestScore !== undefined && typeof quiz.highestScore === 'number') {
            const rawScore = quiz.highestScore;
            lessonStats[lessonKey].quizScores.push(rawScore);
            lessonStats[lessonKey].quizAttempts += 1;
            totalQuizAttempts += 1;
            totalQuizScore += rawScore;
            totalQuizCount += 1;
            studentQuizScores.push(rawScore);
            
            if (rawScore >= 6) { // 6/10 threshold (60%)
              lessonStats[lessonKey].quizPasses += 1;
            }
          }
          
          // Simulation data - use history as primary source to avoid double counting
          let lessonHasSimInHistory = false;
          for (const [simId, simData] of Object.entries(simulations)) {
            const simLessonNum = typeof simData.lesson === 'number' ? simData.lesson : 
                                (typeof simData.lesson === 'string' && simData.lesson.match(/\d+/)) ? 
                                parseInt(simData.lesson.match(/\d+/)[0]) : null;
            
            if (simLessonNum === i && simData && simData.completed) {
              // Count unique simulation completions per lesson (from history)
              lessonStats[lessonKey].simulationTotal += 1;
              completedSimulations += 1;
              totalSimulations += 1;
              studentSimCompletions.add(i);
              
              if (simData.passed) {
                lessonStats[lessonKey].simulationPasses += 1;
                passedSimulations += 1;
              }
              lessonHasSimInHistory = true;
            }
          }
          
          // Only use progress if history doesn't have data for this lesson
          if (!lessonHasSimInHistory && simulation.completed !== undefined && simulation.completed) {
            lessonStats[lessonKey].simulationTotal += 1;
            totalSimulations += 1;
            completedSimulations += 1;
            studentSimCompletions.add(i);
            
            if (simulation.passed) {
              lessonStats[lessonKey].simulationPasses += 1;
              passedSimulations += 1;
            }
          }
          
          if (quiz.completed && simulation.completed) {
            lessonStats[lessonKey].completions += 1;
          }
        }
        
        // Calculate if student is at-risk
        const avgStudentScore = studentQuizScores.length > 0 
          ? studentQuizScores.reduce((sum, score) => sum + score, 0) / studentQuizScores.length 
          : 0;
        const hasCompletedSimulations = studentSimCompletions.size > 0;
        
        if (avgStudentScore < 6 || !hasCompletedSimulations) {
          atRiskStudents += 1;
        }
        
        // Track simulation status summary
        const totalLessons = 6;
        if (studentSimCompletions.size === totalLessons) {
          studentsCompletedAllSims += 1;
        } else if (studentSimCompletions.size > 0) {
          studentsInProgress += 1;
        } else {
          studentsNotStarted += 1;
        }
      }
    }
    
    // Calculate overall average quiz score (only from quizzes that were taken)
    const overallAvgQuizScore = totalQuizCount > 0 ? totalQuizScore / totalQuizCount : 0;
    const simulationPassRate = completedSimulations > 0 ? (passedSimulations / completedSimulations) * 100 : 0;
    
    // Build response
    const lessons = [];
    const sims = [];
    
    for (let i = 1; i <= 6; i++) {
      const lessonKey = `lesson${i}`;
      const stats = lessonStats[lessonKey] || {
        lessonId: i,
        lessonTitle: lessonsData[i]?.lessonTitle || lessonsData[i]?.lessonName || `Lesson ${i}`,
        quizScores: [],
        quizAttempts: 0,
        quizPasses: 0,
        simulationPasses: 0,
        simulationTotal: 0,
        completions: 0,
        totalStudents: 0
      };
      
      // avgQuizScore is in raw format (0-10)
      const avgQuizScore = stats.quizScores.length > 0
        ? stats.quizScores.reduce((sum, score) => sum + score, 0) / stats.quizScores.length
        : 0;
      
      const passRate = stats.quizAttempts > 0 ? (stats.quizPasses / stats.quizAttempts) * 100 : 0;
      const completionRate = stats.totalStudents > 0 ? (stats.completions / stats.totalStudents) * 100 : 0;
      
      // Calculate students below 60% (6/10) for this lesson
      const studentsBelow60 = stats.quizScores.filter(score => score < 6).length;
      
      lessons.push({
        lessonId: i,
        lessonTitle: stats.lessonTitle,
        avgQuizScore: Math.round(avgQuizScore * 10) / 10, // Raw score (0-10), round to 1 decimal
        attempts: stats.quizAttempts,
        passRate: Math.round(passRate * 100) / 100,
        completionRate: Math.round(completionRate * 100) / 100,
        studentsBelow60: studentsBelow60
      });
      
      const lessonSimPassRate = stats.simulationTotal > 0
        ? (stats.simulationPasses / stats.simulationTotal) * 100
        : 0;
      
      // Students completed = number of unique students who completed this simulation
      const studentsCompleted = stats.simulationTotal;
      
      sims.push({
        lessonId: i,
        lessonTitle: stats.lessonTitle,
        simulationPassRate: Math.round(lessonSimPassRate * 100) / 100,
        studentsCompleted: studentsCompleted,
        totalStudents: stats.totalStudents
      });
    }
    
    // Calculate low-scoring quizzes (lessons with students below 60%)
    const lowScoringQuizzes = lessons
      .filter(lesson => lesson.studentsBelow60 > 0)
      .sort((a, b) => b.studentsBelow60 - a.studentsBelow60)
      .slice(0, 5) // Top 5
      .map(lesson => ({
        lessonTitle: lesson.lessonTitle,
        studentsBelow60: lesson.studentsBelow60
      }));
    
    res.json({
      success: true,
      assessments: {
        lessons,
        simulations: sims
      },
      stats: {
        avgQuizScore: Math.round(overallAvgQuizScore * 10) / 10, // Raw score (0-10), round to 1 decimal
        totalQuizAttempts: totalQuizAttempts,
        simulationPassRate: Math.round(simulationPassRate * 100) / 100,
        atRiskStudents: atRiskStudents
      },
      lowScoringQuizzes,
      simulationSummary: {
        completedAll: studentsCompletedAllSims,
        inProgress: studentsInProgress,
        notStarted: studentsNotStarted
      }
    });
  } catch (error) {
    console.error('Instructor assessments error:', error);
    res.status(500).json({ error: 'Failed to fetch assessments' });
  }
});

/**
 * GET /api/instructor/certificates
 * Returns certificate overview for all students
 */
router.get('/certificates', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    
    const usersRef = db.ref('users');
    const usersSnapshot = await usersRef.once('value');
    const usersData = usersSnapshot.val() || {};
    
    const certificates = [];
    
    for (const [uid, userData] of Object.entries(usersData)) {
      if (userData.role === 'student' && userData.assignedInstructor === instructorId) {
        const progress = userData.progress || {};
        const history = userData.history || {};
        
        // Check certificates in database
        const certificatesRef = db.ref(`users/${uid}/certificates`);
        const certificatesSnapshot = await certificatesRef.once('value');
        const studentCertificates = certificatesSnapshot.val() || {};
        
        // Calculate eligibility based on performance
        let lessonCertificates = 0;
        let simulationCertificates = 0;
        let overallStatus = 'Not Eligible';
        
        // Count completed lessons with passing quiz scores
        for (let i = 1; i <= 6; i++) {
          const lessonProgress = progress[`lesson${i}`] || {};
          const quiz = lessonProgress.quiz || {};
          
          if (quiz.completed && quiz.highestScore >= 0.6) {
            lessonCertificates += 1;
          }
          
          const simulation = lessonProgress.simulation || {};
          if (simulation.completed && simulation.passed) {
            simulationCertificates += 1;
          }
        }
        
        // Determine overall status
        if (lessonCertificates >= 6 && simulationCertificates >= 6) {
          overallStatus = 'Eligible';
        } else if (lessonCertificates > 0 || simulationCertificates > 0) {
          overallStatus = 'In Progress';
        }
        
        certificates.push({
          uid,
          name: userData.name || '',
          overallStatus,
          lessonCertificates,
          simulationCertificates
        });
      }
    }
    
    res.json({
      success: true,
      certificates
    });
  } catch (error) {
    console.error('Instructor certificates error:', error);
    res.status(500).json({ error: 'Failed to fetch certificates' });
  }
});

/**
 * GET /api/instructor/profile
 * Returns instructor profile data
 */
router.get('/profile', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    
    const adminRef = db.ref(`admins/${instructorId}`);
    const adminSnapshot = await adminRef.once('value');
    const adminData = adminSnapshot.val();
    
    if (!adminData) {
      return res.status(404).json({ error: 'Instructor not found' });
    }
    
    res.json({
      success: true,
      profile: {
        name: adminData.name || '',
        email: adminData.email || '',
        department: adminData.department || '',
        idNumber: adminData.idNumber || '',
        contact: adminData.contact || '',
        bio: adminData.bio || '',
        ...adminData
      }
    });
  } catch (error) {
    console.error('Instructor profile get error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * PUT /api/instructor/profile
 * Updates instructor profile
 */
router.put('/profile', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { name, email, contact, department, idNumber, bio } = req.body;
    
    const adminRef = db.ref(`admins/${instructorId}`);
    const adminSnapshot = await adminRef.once('value');
    const adminData = adminSnapshot.val();
    
    if (!adminData) {
      return res.status(404).json({ error: 'Instructor not found' });
    }
    
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (contact !== undefined) updates.contact = contact;
    if (department !== undefined) updates.department = department;
    if (idNumber !== undefined) updates.idNumber = idNumber;
    if (bio !== undefined) updates.bio = bio;
    
    updates.updatedAt = new Date().toISOString();
    
    await adminRef.update(updates);
    
    const updatedSnapshot = await adminRef.once('value');
    const updatedData = updatedSnapshot.val();
    
    res.json({
      success: true,
      profile: updatedData
    });
  } catch (error) {
    console.error('Instructor profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * GET /api/instructor/announcements
 * Returns all announcements created by this instructor
 */
router.get('/announcements', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    
    const announcementsRef = db.ref('announcements');
    const announcementsSnapshot = await announcementsRef.once('value');
    const announcementsData = announcementsSnapshot.val() || {};
    
    const announcements = [];
    for (const [id, announcement] of Object.entries(announcementsData)) {
      if (announcement.instructorId === instructorId) {
        announcements.push({
          id,
          ...announcement
        });
      }
    }
    
    // Sort by createdAt (newest first), pinned first
    announcements.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    
    res.json({
      success: true,
      announcements
    });
  } catch (error) {
    console.error('Instructor announcements get error:', error);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

/**
 * POST /api/instructor/announcements
 * Creates a new announcement
 */
router.post('/announcements', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { title, audience, message, pinned } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }
    
    const announcementsRef = db.ref('announcements');
    const newAnnouncementRef = announcementsRef.push();
    
    const announcementData = {
      id: newAnnouncementRef.key,
      instructorId,
      title,
      audience: audience || 'students',
      message,
      pinned: pinned || false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await newAnnouncementRef.set(announcementData);
    
    res.json({
      success: true,
      announcement: announcementData
    });
  } catch (error) {
    console.error('Instructor announcement create error:', error);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

/**
 * DELETE /api/instructor/announcements/:id
 * Deletes an announcement
 */
router.delete('/announcements/:id', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { id } = req.params;
    
    const announcementRef = db.ref(`announcements/${id}`);
    const announcementSnapshot = await announcementRef.once('value');
    const announcementData = announcementSnapshot.val();
    
    if (!announcementData) {
      return res.status(404).json({ error: 'Announcement not found' });
    }
    
    if (announcementData.instructorId !== instructorId) {
      return res.status(403).json({ error: 'Not authorized to delete this announcement' });
    }
    
    await announcementRef.remove();
    
    res.json({
      success: true,
      message: 'Announcement deleted'
    });
  } catch (error) {
    console.error('Instructor announcement delete error:', error);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

/**
 * GET /api/instructor/lessons
 * Returns all lessons with full content for instructors (view-only)
 */
router.get('/lessons', verifyInstructorToken, async (req, res) => {
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
          lessonName: lesson.lessonName || lesson.lessonTitle || '',
          description: lesson.description || lesson.lessonDescription || '',
          lessonDescription: lesson.lessonDescription || lesson.description || '',
          body: lesson.body || '',
          images: lesson.images || [],
          tools: lesson.tools || {}
        };
      })
      .sort((a, b) => a.slot - b.slot);
    
    res.json({ success: true, lessons: lessonsArray });
  } catch (error) {
    console.error('Get instructor lessons error:', error);
    res.status(500).json({ error: 'Failed to fetch lessons' });
  }
});

module.exports = router;
