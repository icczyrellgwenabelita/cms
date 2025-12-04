const express = require('express');
const router = express.Router();
const { verifyInstructorToken } = require('../middleware/auth');
const { db, bucket } = require('../config/firebase');
const multer = require('multer');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

const USERS_COLLECTION = 'users';

// ============================================
// Helper Functions (reused from student.js)
// ============================================

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

/**
 * GET /api/instructor/me
 * Returns current instructor information
 */
router.get('/me', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const instructor = req.instructor;
    
    // Find instructor's class(es)
    const classesRef = db.ref('classes');
    const classesSnapshot = await classesRef.once('value');
    const classesData = classesSnapshot.val() || {};
    
    const instructorClasses = [];
    for (const [classId, classData] of Object.entries(classesData)) {
      if (classData && classData.instructorId === instructorId) {
        const studentIds = classData.studentIds || {};
        instructorClasses.push({
          id: classId,
          classId: classId,
          name: classData.name || 'Unnamed Class',
          section: classData.section || '',
          courseName: classData.courseName || '',
          batchYear: classData.batchYear || null,
          studentCount: Object.keys(studentIds).length
        });
      }
    }
    
    res.json({
      success: true,
      id: instructorId,
      name: instructor.name || instructor.fullName || '',
      email: instructor.email || '',
      class: instructorClasses.length > 0 ? instructorClasses[0] : null,
      classes: instructorClasses
    });
  } catch (error) {
    console.error('Error fetching instructor info:', error);
    res.status(500).json({ error: 'Failed to fetch instructor information' });
  }
});

/**
 * GET /api/instructor/class
 * Returns the instructor's main class
 */
router.get('/class', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    
    const classesRef = db.ref('classes');
    const classesSnapshot = await classesRef.once('value');
    const classesData = classesSnapshot.val() || {};
    
    // Find first class for this instructor
    for (const [classId, classData] of Object.entries(classesData)) {
      if (classData && classData.instructorId === instructorId) {
        const studentIds = classData.studentIds || {};
        return res.json({
          success: true,
          class: {
            id: classId,
            classId: classId,
            name: classData.name || 'Unnamed Class',
            section: classData.section || '',
            courseName: classData.courseName || '',
            batchYear: classData.batchYear || null,
            studentCount: Object.keys(studentIds).length
          }
        });
      }
    }
    
    res.json({
      success: false,
      message: 'No class found for instructor',
      class: null
    });
  } catch (error) {
    console.error('Error fetching instructor class:', error);
    res.status(500).json({ error: 'Failed to fetch class information' });
  }
});

/**
 * GET /api/instructor/class/posts
 * Returns all posts for the instructor's class
 */
router.get('/class/posts', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    
    // Find instructor's class
    const classesRef = db.ref('classes');
    const classesSnapshot = await classesRef.once('value');
    const classesData = classesSnapshot.val() || {};
    
    let classId = null;
    for (const [cid, classData] of Object.entries(classesData)) {
      if (classData && classData.instructorId === instructorId) {
        classId = cid;
        break;
      }
    }
    
    if (!classId) {
      return res.json({
        success: true,
        posts: []
      });
    }
    
    // Get posts from classPosts/{classId}
    const postsRef = db.ref(`classPosts/${classId}`);
    const postsSnapshot = await postsRef.once('value');
    const postsData = postsSnapshot.val() || {};
    
    const posts = [];
    for (const [postId, postData] of Object.entries(postsData)) {
      if (postData) {
        // Use new attachments array if available, otherwise fall back to legacy format
        let attachments = [];
        if (postData.attachments && Array.isArray(postData.attachments)) {
          attachments = postData.attachments;
        } else if (postData.attachmentUrl) {
          // Legacy format: convert to array
          attachments = [{
            name: postData.attachmentName || 'Attachment',
            label: postData.attachmentName || 'Attachment',
            url: postData.attachmentUrl
          }];
        }

        // Normalize task metadata (supports both new taskMeta object and legacy flat fields)
        let taskMeta = null;
        if (postData.taskMeta && typeof postData.taskMeta === 'object') {
          taskMeta = {
            dueDate: postData.taskMeta.dueDate || null,
            maxScore: typeof postData.taskMeta.maxScore === 'number'
              ? postData.taskMeta.maxScore
              : (postData.taskMeta.maxScore != null
                  ? Number(postData.taskMeta.maxScore)
                  : null)
          };
        } else if (postData.dueDate || postData.maxScore != null) {
          taskMeta = {
            dueDate: postData.dueDate || null,
            maxScore: postData.maxScore != null ? Number(postData.maxScore) : null
          };
        }

        posts.push({
          id: postId,
          postId: postId,
          type: postData.type || 'message',
          title: postData.title || '',
          body: postData.body || '',
          attachments: attachments,
          linkUrl: postData.linkUrl || null,
          createdBy: postData.createdBy || '',
          createdByName: postData.createdByName || 'Instructor',
          instructorName: postData.createdByName || 'Instructor',
          createdAt: postData.createdAt || new Date().toISOString(),
          taskMeta
        });
      }
    }
    
    // Sort by createdAt desc
    posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json({
      success: true,
      posts
    });
  } catch (error) {
    console.error('Error fetching class posts:', error);
    res.status(500).json({ error: 'Failed to fetch class posts' });
  }
});

/**
 * POST /api/instructor/class/upload-attachment
 * Uploads file attachments for class posts
 */
router.post('/class/upload-attachment', verifyInstructorToken, upload.array('files'), async (req, res) => {
  try {
    if (!bucket) {
      return res.status(503).json({ error: 'Storage bucket not configured.' });
    }

    const classId = req.body.classId || 'default';
    const uploadedFiles = [];

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded.' });
    }

    for (const file of req.files) {
      const originalName = file.originalname || 'attachment';
      const safeName = originalName.replace(/[^\w.\-]/g, '_');
      const timestamp = Date.now();
      const storagePath = `classAttachments/${classId}/${timestamp}_${safeName}`;
      const bucketFile = bucket.file(storagePath);

      await bucketFile.save(file.buffer, {
        contentType: file.mimetype || 'application/octet-stream',
        resumable: false,
      });

      await bucketFile.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(storagePath)}`;

      uploadedFiles.push({
        name: originalName,
        url: publicUrl,
        storagePath,
        contentType: file.mimetype,
        size: file.size || null,
      });
    }

    return res.json({ success: true, files: uploadedFiles });
  } catch (error) {
    console.error('Error uploading class attachments:', error);
    return res.status(500).json({ error: 'Failed to upload attachments.' });
  }
});

/**
 * POST /api/instructor/class/posts
 * Creates a new post in the instructor's class
 */
router.post('/class/posts', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const instructor = req.instructor;
    const {
      type,
      title,
      body,
      attachments,
      linkUrl,
      // Optional task fields (task posts only)
      dueDate,
      maxScore
    } = req.body;
    
    if (!type || !title || !body) {
      return res.status(400).json({ error: 'Type, title, and body are required' });
    }
    
    // Find instructor's class
    const classesRef = db.ref('classes');
    const classesSnapshot = await classesRef.once('value');
    const classesData = classesSnapshot.val() || {};
    
    let classId = null;
    for (const [cid, classData] of Object.entries(classesData)) {
      if (classData && classData.instructorId === instructorId) {
        classId = cid;
        break;
      }
    }
    
    if (!classId) {
      return res.status(404).json({ error: 'No class found for instructor' });
    }
    
    // Create post
    const postsRef = db.ref(`classPosts/${classId}`);
    const newPostRef = postsRef.push();
    const postId = newPostRef.key;
    
    // Store attachments array properly
    const attachmentsArray = Array.isArray(attachments) ? attachments : [];
    
    // For backward compatibility, also store first attachment in old format
    const firstAttachment = attachmentsArray.length > 0 ? attachmentsArray[0] : null;

    // Normalize task metadata (only meaningful for task-type posts, but harmless if present otherwise)
    let normalizedTaskMeta = null;
    if (type === 'task') {
      const parsedMaxScore =
        maxScore != null && maxScore !== ''
          ? Number(maxScore)
          : null;

      normalizedTaskMeta = {
        dueDate: dueDate || null,
        maxScore: Number.isNaN(parsedMaxScore) ? null : parsedMaxScore
      };
    }

    const postData = {
      postId: postId,
      classId: classId,
      type: type,
      title: title,
      body: body,
      linkUrl: linkUrl || null,
      attachments: attachmentsArray, // New: full attachments array
      attachmentUrl: firstAttachment ? firstAttachment.url : null, // Legacy: first attachment URL
      attachmentName: firstAttachment ? (firstAttachment.name || firstAttachment.label) : null, // Legacy: first attachment name
      createdBy: instructorId,
      createdByName: instructor.name || instructor.fullName || 'Instructor',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // New: normalized task meta block, used by instructor & (optionally) student UIs
      taskMeta: normalizedTaskMeta,
      // Legacy flat fields kept for compatibility with any existing consumers
      dueDate: normalizedTaskMeta ? normalizedTaskMeta.dueDate : (dueDate || null),
      maxScore: normalizedTaskMeta ? normalizedTaskMeta.maxScore : (
        (maxScore != null && maxScore !== '' && !Number.isNaN(Number(maxScore)))
          ? Number(maxScore)
          : null
      )
    };
    
    await newPostRef.set(postData);
    
    res.json({
      success: true,
      post: {
        id: postId,
        ...postData
      }
    });
  } catch (error) {
    console.error('Error creating class post:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

/**
 * GET /api/instructor/class/students/progress
 * Returns student progress for the instructor's class
 */
router.get('/class/students/progress', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    
    // Find instructor's class
    const classesRef = db.ref('classes');
    const classesSnapshot = await classesRef.once('value');
    const classesData = classesSnapshot.val() || {};
    
    let classId = null;
    let classData = null;
    for (const [cid, cd] of Object.entries(classesData)) {
      if (cd && cd.instructorId === instructorId) {
        classId = cid;
        classData = cd;
        break;
      }
    }
    
    if (!classId || !classData) {
      return res.json({
        success: true,
        students: []
      });
    }
    
    const studentIds = classData.studentIds || {};
    const studentUids = Object.keys(studentIds);
    
    // Load lesson metadata
    const [lessonsSnapshot, lmsLessonsSnapshot] = await Promise.all([
      db.ref('lessons').once('value'),
      db.ref('lmsLessons').once('value')
    ]);
    const allLessons = lessonsSnapshot.val() || {};
    const allLmsLessons = lmsLessonsSnapshot.val() || {};
    
    const students = [];
    
    for (const studentId of studentUids) {
      // Get student user data
      const userRef = db.ref(`${USERS_COLLECTION}/${studentId}`);
      const userSnapshot = await userRef.once('value');
      const userData = userSnapshot.val() || {};
      
      if (!userData || userData.role !== 'student') continue;
      
      const studentInfo = userData.studentInfo || {};
      
      // Load LMS progress
      const lmsProgressRef = db.ref(`${USERS_COLLECTION}/${studentId}/lmsProgress`);
      const lmsProgressSnapshot = await lmsProgressRef.once('value');
      const lmsProgress = lmsProgressSnapshot.val() || {};
      
      // Load Game progress
      const gameProgressRef = db.ref(`${USERS_COLLECTION}/${studentId}/progress`);
      const gameProgressSnapshot = await gameProgressRef.once('value');
      const gameProgress = gameProgressSnapshot.val() || {};
      
      // Load time spent if exists
      const lmsTimeSpentRef = db.ref(`${USERS_COLLECTION}/${studentId}/lmsTimeSpent`);
      const lmsTimeSpentSnapshot = await lmsTimeSpentRef.once('value');
      const lmsTimeSpent = lmsTimeSpentSnapshot.val() || {};
      
      // Calculate LMS summary
      let lmsLessonsCompleted = 0;
      let lmsTotalLessons = 0;
      let lmsTotalPagesCompleted = 0;
      let lmsTotalPages = 0;
      let lmsTotalTimeSeconds = 0;
      
      // Calculate Game summary
      let gameTotalQuizScore = 0;
      let gameQuizCount = 0;
      let gameSimulationsPassed = 0;
      
      for (let slot = 1; slot <= 6; slot++) {
        const slotKey = String(slot);
        const lessonMeta = allLessons[slotKey] || {};
        const lmsLessonMeta = allLmsLessons[slotKey] || {};
        
        const rawStatus = (lessonMeta.status || '').toString().toLowerCase();
        const isPublished = rawStatus === 'published';
        if (!isPublished) continue;
        
        lmsTotalLessons += 1;
        
        // LMS calculations
        const pages = lmsLessonMeta.pages || {};
        const totalPages = Object.keys(pages).length;
        lmsTotalPages += totalPages;
        
        const lessonProgress = lmsProgress[`lesson${slot}`] || {};
        const completedPages = lessonProgress.completedPages || {};
        const completedPagesCount = Object.keys(completedPages).filter(
          (key) => completedPages[key]
        ).length;
        lmsTotalPagesCompleted += completedPagesCount;
        
        const rawQuiz = normalizeQuiz(lessonProgress.quiz || {});
        const rawSimulation = normalizeSimulation(
          lessonProgress.simulation || lessonProgress.sim || {}
        );
        
        // Check if lesson is completed
        const hasPages = totalPages > 0 && completedPagesCount >= totalPages;
        const hasProgressObject = lessonProgress && typeof lessonProgress === 'object' && Object.keys(lessonProgress).length > 0;
        const lessonStatus = computeLmsLessonStatus({
          hasPages,
          quiz: rawQuiz,
          simulation: rawSimulation,
          hasProgressObject
        });
        
        if (lessonStatus === 'completed') {
          lmsLessonsCompleted += 1;
        }
        
        // Time spent
        const lessonTimeSpent = lmsTimeSpent[`lesson${slot}`] || {};
        const timeSeconds = Number(lessonTimeSpent.totalSeconds || 0);
        if (Number.isFinite(timeSeconds)) {
          lmsTotalTimeSeconds += timeSeconds;
        }
        
        // Game calculations
        const lessonGameProgress = gameProgress[`lesson${slot}`] || {};
        const gameQuiz = normalizeQuiz(lessonGameProgress.quiz || {});
        const gameSim = normalizeSimulation(lessonGameProgress.simulation || {});
        
        if (gameQuiz.completed && gameQuiz.highestScore > 0) {
          gameTotalQuizScore += gameQuiz.highestScore;
          gameQuizCount += 1;
        }
        
        if (gameSim.completed && gameSim.passed) {
          gameSimulationsPassed += 1;
        }
      }
      
      const gameAvgQuizScore = gameQuizCount > 0 ? Math.round((gameTotalQuizScore / gameQuizCount) * 10) / 10 : 0;
      
      // Get last active timestamp (use updatedAt from user or progress)
      const lastActiveAt = userData.updatedAt || userData.lastActiveAt || null;
      
      students.push({
        uid: studentId,
        name: userData.name || userData.fullName || 'Student',
        email: userData.email || '',
        studentNumber: studentInfo.studentNumber || '',
        lms: {
          lessonsCompleted: lmsLessonsCompleted,
          totalLessons: lmsTotalLessons,
          pagesCompleted: lmsTotalPagesCompleted,
          totalPages: lmsTotalPages,
          totalTimeSeconds: Math.round(lmsTotalTimeSeconds)
        },
        game: {
          avgQuizScore: gameAvgQuizScore,
          quizzesCompleted: gameQuizCount,
          simulationsPassed: gameSimulationsPassed
        },
        lastActiveAt: lastActiveAt
      });
    }
    
    res.json({
      success: true,
      students
    });
  } catch (error) {
    console.error('Error getting class student progress:', error);
    res.status(500).json({ error: 'Failed to get student progress' });
  }
});

/**
 * GET /api/instructor/dashboard
 * Returns dashboard statistics and recent activity
 */
router.get('/dashboard', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    
    // Get all students assigned to this instructor
    const usersRef = db.ref(USERS_COLLECTION);
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
    
    const usersRef = db.ref(USERS_COLLECTION);
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
 * Returns assessment overview for students in instructor's class
 * 
 * ANALYTICS INCLUDED:
 * - Game Quiz Analytics: Unity game quiz results from users/{uid}/progress/lessonX/quiz (6 fixed game lessons)
 * - Game Simulation Analytics: Unity game simulation results from users/{uid}/progress/lessonX/simulation
 * - Instructor Task Analytics: Task posts and submissions from classPosts and classTaskSubmissions
 * 
 * NOTE: This endpoint does NOT include LMS (web) lesson/page analytics.
 * LMS analytics would require separate implementation reading from lmsLessons and lmsProgress collections.
 */
router.get('/assessments', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    
    // Find instructor's class
    const classesRef = db.ref('classes');
    const classesSnapshot = await classesRef.once('value');
    const classesData = classesSnapshot.val() || {};
    
    let classId = null;
    let classData = null;
    for (const [cid, cd] of Object.entries(classesData)) {
      if (cd && cd.instructorId === instructorId) {
        classId = cid;
        classData = cd;
        break;
      }
    }
    
    if (!classId || !classData) {
      return res.json({
        success: true,
        assessments: { lessons: [], simulations: [] },
        stats: {
          avgQuizScore: 0,
          totalQuizAttempts: 0,
          simulationPassRate: 0,
          atRiskStudents: 0
        },
        taskSummary: {
          totalTasks: 0,
          totalGraded: 0,
          avgTaskScorePercent: 0,
          tasksByPost: []
        },
        lowScoringQuizzes: [],
        simulationSummary: {
          completedAll: 0,
          inProgress: 0,
          notStarted: 0
        }
      });
    }
    
    // Get student IDs from class
    const studentIds = classData.studentIds || {};
    const studentUids = Object.keys(studentIds);
    
    // Game lesson display names mapping (6 fixed Unity game lessons)
    // NOTE: We read from lessons/{slot} ONLY for game lesson display names, not for LMS data
    // The lessons collection may contain LMS metadata, but we only use it for game lesson titles here
    const gameLessonNames = {
      1: 'Monitoring Vital Signs',
      2: 'Medication Assistance',
      3: 'Meal Preparation & Feeding',
      4: 'Personal Care & Hygiene',
      5: 'Safety & Emergencies',
      6: 'Communication & Documentation'
    };
    
    // Optionally fetch lesson metadata for display names (fallback if not in hardcoded map)
    let lessonsData = {};
    try {
      const lessonsRef = db.ref('lessons');
      const lessonsSnapshot = await lessonsRef.once('value');
      lessonsData = lessonsSnapshot.val() || {};
    } catch (err) {
      console.warn('Could not load lesson metadata for display names:', err);
    }
    
    // Get all task posts for this class
    const postsRef = db.ref(`classPosts/${classId}`);
    const postsSnapshot = await postsRef.once('value');
    const postsData = postsSnapshot.val() || {};
    
    // Filter task posts
    const taskPosts = [];
    for (const [postId, postData] of Object.entries(postsData)) {
      if (postData && postData.type === 'task') {
        const maxScore = postData.taskMeta?.maxScore || postData.maxScore || 10;
        taskPosts.push({
          postId,
          title: postData.title || 'Untitled Task',
          maxScore: Number(maxScore),
          dueDate: postData.taskMeta?.dueDate || postData.dueDate || null,
          createdAt: postData.createdAt || null
        });
      }
    }
    
    // Get task submissions for all tasks
    const taskSubmissionsRef = db.ref(`classTaskSubmissions/${classId}`);
    const taskSubmissionsSnapshot = await taskSubmissionsRef.once('value');
    const taskSubmissionsData = taskSubmissionsSnapshot.val() || {};
    
    // Aggregate data per GAME lesson (6 fixed Unity game lessons) - only for students in class
    // NOTE: This is GAME analytics only, not LMS. Game progress is in users/{uid}/progress/lessonX
    const gameLessonStats = {};
    let totalQuizAttempts = 0;
    let totalQuizScore = 0;
    let totalQuizCount = 0;
    let totalSimulations = 0;
    let completedSimulations = 0;
    let passedSimulations = 0;
    
    // Track simulation status summary
    let studentsCompletedAllSims = 0;
    let studentsInProgress = 0;
    let studentsNotStarted = 0;
    
    // Per-student data for at-risk calculation
    const studentData = {};
    
    // Load all student data
    for (const studentId of studentUids) {
      const userRef = db.ref(`${USERS_COLLECTION}/${studentId}`);
      const userSnapshot = await userRef.once('value');
      const userData = userSnapshot.val() || {};
      
      if (!userData || userData.role !== 'student') continue;
      
      const progress = userData.progress || {};
      
      // Initialize student data
      studentData[studentId] = {
        name: userData.name || userData.fullName || 'Student',
        email: userData.email || '',
        quizScores: [],
        simCompletions: new Set(),
        taskScores: [],
        taskSubmissions: 0,
        totalTasks: taskPosts.length
      };
      
      // Process GAME quiz and simulation progress (6 fixed Unity game lessons)
      // Data source: users/{uid}/progress/lessonX/quiz and lessonX/simulation
      // This is GAME data only, not LMS lesson/page data
      for (let i = 1; i <= 6; i++) {
        const gameLessonKey = `lesson${i}`;
        if (!gameLessonStats[gameLessonKey]) {
          // Get game lesson display name (prefer hardcoded map, fallback to lessons collection)
          const gameLessonTitle = gameLessonNames[i] || 
                                  lessonsData[i]?.lessonTitle || 
                                  lessonsData[i]?.lessonName || 
                                  `Game Lesson ${i}`;
          
          gameLessonStats[gameLessonKey] = {
            lessonId: i,
            lessonTitle: gameLessonTitle,
            quizScores: [],
            quizAttempts: 0,
            quizCompletions: 0,
            simulationCompletions: 0,
            simulationPasses: 0,
            simulationTotal: 0,
            totalStudents: 0
          };
        }
        
        // Read GAME progress: users/{uid}/progress/lessonX/quiz and lessonX/simulation
        const gameLessonProgress = progress[gameLessonKey] || {};
        const gameQuiz = normalizeQuiz(gameLessonProgress.quiz || {});
        const gameSimulation = normalizeSimulation(gameLessonProgress.simulation || {});
        
        gameLessonStats[gameLessonKey].totalStudents += 1;
        
        // GAME Quiz data - from Unity game quiz results
        if (gameQuiz.attempts > 0 && gameQuiz.highestScore > 0) {
          const rawScore = gameQuiz.highestScore;
          gameLessonStats[gameLessonKey].quizScores.push(rawScore);
          gameLessonStats[gameLessonKey].quizAttempts += gameQuiz.attempts;
          totalQuizAttempts += gameQuiz.attempts;
          totalQuizScore += rawScore;
          totalQuizCount += 1;
          studentData[studentId].quizScores.push(rawScore);
          
          if (gameQuiz.completed) {
            gameLessonStats[gameLessonKey].quizCompletions += 1;
          }
        }
        
        // GAME Simulation data - from Unity game simulation results
        // CRITICAL: Only lessons 1 and 2 have simulations in the Unity game
        // Only count simulation completions for lessons 1 and 2
        if (gameSimulation.completed && (i === 1 || i === 2)) {
          gameLessonStats[gameLessonKey].simulationCompletions += 1;
          gameLessonStats[gameLessonKey].simulationTotal += 1;
          totalSimulations += 1;
          completedSimulations += 1;
          studentData[studentId].simCompletions.add(i);
          
          if (gameSimulation.passed) {
            gameLessonStats[gameLessonKey].simulationPasses = (gameLessonStats[gameLessonKey].simulationPasses || 0) + 1;
            passedSimulations += 1;
          }
        }
      }
      
      // Process INSTRUCTOR TASK submissions for this student
      // Tasks are separate from game quizzes/simulations - they come from classTaskSubmissions
      for (const taskPost of taskPosts) {
        const submissionData = taskSubmissionsData[taskPost.postId]?.[studentId];
        if (submissionData) {
          studentData[studentId].taskSubmissions += 1;
          
          // Only count graded tasks (score is not null)
          if (submissionData.score !== null && submissionData.score !== undefined) {
            const score = Number(submissionData.score);
            const maxScore = taskPost.maxScore || 10;
            const scorePercent = (score / maxScore) * 100;
            studentData[studentId].taskScores.push(scorePercent);
          }
        }
      }
      
      // Track GAME simulation status summary will be recalculated after identifying real simulations
    }
    
    // At-risk calculation will be done after identifying real simulations
    // Initialize variables here, will be recalculated later
    let atRiskStudents = 0;
    const atRiskStudentList = [];
    
    // Calculate overall GAME quiz average (from Unity game quizzes only)
    const overallGameQuizAvg = totalQuizCount > 0 ? totalQuizScore / totalQuizCount : 0;
    // Calculate GAME simulation pass rate (from Unity game simulations only)
    const gameSimulationPassRate = completedSimulations > 0 ? (passedSimulations / completedSimulations) * 100 : 0;
    
    // Build GAME lesson response (6 fixed Unity game lessons)
    const gameLessons = [];
    const gameSims = [];
    
    for (let i = 1; i <= 6; i++) {
      const gameLessonKey = `lesson${i}`;
      const gameLessonTitle = gameLessonNames[i] || 
                              lessonsData[i]?.lessonTitle || 
                              lessonsData[i]?.lessonName || 
                              `Game Lesson ${i}`;
      
      const stats = gameLessonStats[gameLessonKey] || {
        lessonId: i,
        lessonTitle: gameLessonTitle,
        quizScores: [],
        quizAttempts: 0,
        quizCompletions: 0,
        simulationCompletions: 0,
        simulationPasses: 0,
        simulationTotal: 0,
        totalStudents: 0
      };
      
      // GAME quiz average (0-10 scale) - average of highestScore per student with attempts
      const gameQuizAvg = stats.quizScores.length > 0
        ? stats.quizScores.reduce((sum, score) => sum + score, 0) / stats.quizScores.length
        : 0;
      
      const gameQuizCompletionRate = stats.totalStudents > 0 ? (stats.quizCompletions / stats.totalStudents) * 100 : 0;
      
      // Calculate students below 60% (6/10) for this GAME lesson
      const studentsBelow60 = stats.quizScores.filter(score => score < 6).length;
      
      gameLessons.push({
        lessonId: i,
        lessonTitle: stats.lessonTitle,
        avgQuizScore: Math.round(gameQuizAvg * 10) / 10, // Raw score (0-10), round to 1 decimal
        attempts: stats.quizAttempts,
        completionRate: Math.round(gameQuizCompletionRate * 100) / 100,
        studentsBelow60: studentsBelow60
      });
      
      // GAME simulation pass rate for this lesson
      // CRITICAL: Only lessons 1 and 2 have simulations in the Unity game
      // Only include simulations that actually exist (have data from at least one student)
      // A simulation is "real" if at least one student has attempted/completed it
      // But we only show simulations for lessons 1 and 2 (the actual simulations in Unity)
      const hasSimulationData = (i === 1 || i === 2) && (stats.simulationTotal > 0 || stats.simulationCompletions > 0);
      
      if (hasSimulationData) {
        const gameSimPassRate = stats.simulationTotal > 0
          ? ((stats.simulationPasses || 0) / stats.simulationTotal) * 100
          : 0;
        
        gameSims.push({
          lessonId: i,
          lessonTitle: stats.lessonTitle,
          simulationPassRate: Math.round(gameSimPassRate * 100) / 100,
          studentsCompleted: stats.simulationCompletions,
          totalStudents: stats.totalStudents
        });
      }
    }
    
    // Calculate low-scoring GAME quizzes (lessons with students below 60%)
    const lowScoringGameQuizzes = gameLessons
      .filter(lesson => lesson.studentsBelow60 > 0)
      .sort((a, b) => b.studentsBelow60 - a.studentsBelow60)
      .slice(0, 5) // Top 5
      .map(lesson => ({
        lessonTitle: lesson.lessonTitle,
        studentsBelow60: lesson.studentsBelow60
      }));
    
    // Calculate INSTRUCTOR TASK analytics (separate from game quizzes/simulations)
    // Tasks come from classPosts (type: 'task') and classTaskSubmissions
    const taskSummary = {
      totalTasks: taskPosts.length,
      totalGraded: 0,
      avgTaskScorePercent: 0,
      tasksByPost: []
    };
    
    let totalGradedSubmissions = 0;
    let totalTaskScorePercent = 0;
    
    for (const taskPost of taskPosts) {
      const submissions = taskSubmissionsData[taskPost.postId] || {};
      let gradedCount = 0;
      let totalScorePercent = 0;
      let submissionCount = 0;
      
      for (const studentId of studentUids) {
        const submission = submissions[studentId];
        if (submission) {
          submissionCount += 1;
          if (submission.score !== null && submission.score !== undefined) {
            gradedCount += 1;
            const score = Number(submission.score);
            const scorePercent = (score / taskPost.maxScore) * 100;
            totalScorePercent += scorePercent;
            totalGradedSubmissions += 1;
            totalTaskScorePercent += scorePercent;
          }
        }
      }
      
      const avgScorePercent = gradedCount > 0 ? totalScorePercent / gradedCount : 0;
      const completionRate = studentUids.length > 0 ? (submissionCount / studentUids.length) * 100 : 0;
      
      taskSummary.tasksByPost.push({
        postId: taskPost.postId,
        title: taskPost.title,
        avgScorePercent: Math.round(avgScorePercent * 100) / 100,
        completionRate: Math.round(completionRate * 100) / 100,
        dueDate: taskPost.dueDate,
        maxScore: taskPost.maxScore
      });
      
      if (gradedCount > 0) {
        taskSummary.totalGraded += 1;
      }
    }
    
    taskSummary.avgTaskScorePercent = totalGradedSubmissions > 0
      ? Math.round((totalTaskScorePercent / totalGradedSubmissions) * 100) / 100
      : 0;
    
    // ============================================
    // LMS Analytics Aggregation
    // ============================================
    // NOTE: LMS analytics are separate from Game and Tasks
    // Data sources:
    // - LMS Lessons: lessons/{slot} (filtered by status: 'published')
    // - LMS Pages: lmsLessons/{slot}/pages/{pageId}
    // - LMS Assessments: lmsLessons/{slot}/pages/{pageId}/assessments/{assessmentId}
    // - LMS Progress: users/{uid}/lmsProgress/lesson{slot}/completedPages
    // - LMS Assessment History: users/{uid}/lmsAssessmentHistory/lesson{slot}/page_{pageId}/attempt_*
    //
    // IMPORTANT: Currently uses hard-coded slots 1-6. In the future, this could be made dynamic
    // by iterating over actual published lessons from the lessons collection instead of hard-coding slots.
    // For now, we process slots 1-6 and filter by status: 'published' to only include active lessons.
    //
    // CRITICAL AVERAGING RULE: All metrics (avgProgressPercent, avgScorePercent, etc.) must be calculated
    // over ALL students in the instructor's class, not just students who have started/completed work.
    // Students with no progress entry are treated as 0% progress / 0 attempts / 0% score.
    
    const lmsSummary = {
      lessons: [],
      assessments: []
    };
    
    try {
      // Load LMS lesson metadata and pages
      const [lmsLessonsMetaSnapshot, lmsLessonsSnapshot] = await Promise.all([
        db.ref('lessons').once('value'),
        db.ref('lmsLessons').once('value')
      ]);
      const lmsLessonsMeta = lmsLessonsMetaSnapshot.val() || {};
      const lmsLessonsData = lmsLessonsSnapshot.val() || {};
      
      // Aggregate LMS lesson progress
      // NOTE: Currently uses slots 1-6. In the future, this could be made dynamic
      // by reading actual published lessons from the lessons collection instead of hard-coding slots.
      const lmsLessonStats = {};
      const lmsAssessmentStats = {};
      
      // First, initialize lesson stats for all published lessons
      // This ensures we have totalPages for each lesson before processing students
      for (let slot = 1; slot <= 6; slot++) {
        const slotKey = String(slot);
        const lessonMeta = lmsLessonsMeta[slotKey] || {};
        const rawStatus = (lessonMeta.status || '').toString().toLowerCase();
        const isPublished = rawStatus === 'published';
        
        if (!isPublished) continue;
        
        const lessonTitle = lessonMeta.lessonTitle || lessonMeta.lessonName || `LMS Lesson ${slot}`;
        const lmsLessonData = lmsLessonsData[slotKey] || {};
        const pages = lmsLessonData.pages || {};
        const totalPages = Object.keys(pages).length;
        
        // Initialize lesson stats with empty arrays - will be populated for ALL students
        lmsLessonStats[slot] = {
          lessonId: slot,
          title: lessonTitle,
          totalPages: totalPages,
          studentProgress: [], // Will contain progress for ALL students in class
          studentsCompleted: 0
        };
      }
      
      // Now process each student in the class
      // CRITICAL: We must include ALL students, even those with no progress (treat as 0%)
      for (const studentId of studentUids) {
        const userRef = db.ref(`${USERS_COLLECTION}/${studentId}`);
        const userSnapshot = await userRef.once('value');
        const userData = userSnapshot.val() || {};
        
        if (!userData || userData.role !== 'student') continue;
        
        // Load LMS progress (may be empty or missing for some lessons)
        const lmsProgressRef = db.ref(`${USERS_COLLECTION}/${studentId}/lmsProgress`);
        const lmsProgressSnapshot = await lmsProgressRef.once('value');
        const lmsProgress = lmsProgressSnapshot.val() || {};
        
        // Load LMS assessment history
        const lmsAssessmentHistoryRef = db.ref(`${USERS_COLLECTION}/${studentId}/lmsAssessmentHistory`);
        const lmsAssessmentHistorySnapshot = await lmsAssessmentHistoryRef.once('value');
        const lmsAssessmentHistory = lmsAssessmentHistorySnapshot.val() || {};
        
        // Process each published LMS lesson
        // For each lesson, calculate this student's progress (0% if no progress entry exists)
        for (let slot = 1; slot <= 6; slot++) {
          const slotKey = String(slot);
          const lessonMeta = lmsLessonsMeta[slotKey] || {};
          const rawStatus = (lessonMeta.status || '').toString().toLowerCase();
          const isPublished = rawStatus === 'published';
          
          if (!isPublished) continue;
          
          // Skip if lesson stats weren't initialized (shouldn't happen, but safety check)
          if (!lmsLessonStats[slot]) continue;
          
          const lessonTitle = lessonMeta.lessonTitle || lessonMeta.lessonName || `LMS Lesson ${slot}`;
          const totalPages = lmsLessonStats[slot].totalPages;
          
          // Get student's LMS progress for this lesson
          // If no progress entry exists, treat as 0% progress
          const lessonProgress = lmsProgress[`lesson${slot}`] || {};
          const completedPages = lessonProgress.completedPages || {};
          const completedPagesCount = Object.keys(completedPages).filter(
            key => completedPages[key] === true
          ).length;
          
          // Calculate completion percent for THIS student
          // If student has no progress entry, completedPagesCount = 0, so progressPercent = 0
          const progressPercent = totalPages > 0 
            ? Math.round((completedPagesCount / totalPages) * 100) 
            : 0;
          
          // ALWAYS add this student's progress to the array (even if 0%)
          // This ensures avgProgressPercent includes ALL students in the class
          lmsLessonStats[slot].studentProgress.push(progressPercent);
          
          // Check if lesson is fully completed (all pages completed)
          if (totalPages > 0 && completedPagesCount >= totalPages) {
            lmsLessonStats[slot].studentsCompleted += 1;
          }
          
          // Process assessments for each page
          for (const [pageId, pageData] of Object.entries(pages)) {
            const assessments = pageData.assessments || {};
            if (Object.keys(assessments).length === 0) continue;
            
            // Get assessment history for this page
            const pageHistoryKey = `page_${pageId}`;
            const pageHistory = lmsAssessmentHistory[`lesson${slot}`]?.[pageHistoryKey] || {};
            const attemptKeys = Object.keys(pageHistory).filter(key => key.startsWith('attempt_'));
            const attempts = attemptKeys.map(key => pageHistory[key]).filter(Boolean);
            
            // Process each assessment on this page
            for (const [assessmentId, assessmentData] of Object.entries(assessments)) {
              const assessmentKey = `${slot}_${pageId}_${assessmentId}`;
              
              if (!lmsAssessmentStats[assessmentKey]) {
                lmsAssessmentStats[assessmentKey] = {
                  assessmentId,
                  title: assessmentData.question || `Assessment ${assessmentId}`,
                  lessonId: slot,
                  lessonTitle: lessonTitle,
                  maxScore: 100, // LMS assessments are percentage-based (0-100)
                  studentScores: [],
                  studentAttempts: [],
                  studentsPassed: 0,
                  totalStudents: 0
                };
              }
              
              // Find best score from attempts for this page (assessments are grouped by page)
              // CRITICAL: Include ALL students in the class, even those with no attempts (treat as 0%)
              // Always increment totalStudents for every student in the class
              lmsAssessmentStats[assessmentKey].totalStudents += 1;
              
              if (attempts.length > 0) {
                const scores = attempts.map(a => Number(a.scorePercent || 0)).filter(Number.isFinite);
                const bestScore = scores.length > 0 ? Math.max(...scores) : 0;
                const passed = attempts.some(a => Boolean(a.passed));
                
                lmsAssessmentStats[assessmentKey].studentScores.push(bestScore);
                lmsAssessmentStats[assessmentKey].studentAttempts.push(attempts.length);
                
                if (passed) {
                  lmsAssessmentStats[assessmentKey].studentsPassed += 1;
                }
              } else {
                // No attempts yet - student has 0% score and 0 attempts
                // Still include in averages to reflect whole class performance
                lmsAssessmentStats[assessmentKey].studentScores.push(0);
                lmsAssessmentStats[assessmentKey].studentAttempts.push(0);
              }
            }
          }
        }
      }
      
      // Build LMS lesson summary
      // CRITICAL: avgProgressPercent must be calculated over ALL students in the class
      // stats.studentProgress.length should equal the number of students in the class
      for (const [slot, stats] of Object.entries(lmsLessonStats)) {
        const totalStudentsInClass = stats.studentProgress.length;
        
        // Calculate average progress across ALL students (including those with 0% progress)
        const avgProgressPercent = totalStudentsInClass > 0
          ? Math.round(stats.studentProgress.reduce((sum, p) => sum + p, 0) / totalStudentsInClass)
          : 0;
        
        // Completion rate: percentage of students who completed all pages
        const completionRate = totalStudentsInClass > 0
          ? Math.round((stats.studentsCompleted / totalStudentsInClass) * 100)
          : 0;
        
        lmsSummary.lessons.push({
          lessonId: stats.lessonId,
          title: stats.title,
          avgProgressPercent,
          completionRate,
          studentsCompleted: stats.studentsCompleted
        });
      }
      
      // Build LMS assessment summary
      // CRITICAL: All averages must be calculated over ALL students in the class
      // stats.studentScores.length should equal stats.totalStudents (all students included)
      for (const [key, stats] of Object.entries(lmsAssessmentStats)) {
        // avgScorePercent: average across ALL students (including 0% for no attempts)
        const avgScorePercent = stats.totalStudents > 0
          ? Math.round(stats.studentScores.reduce((sum, s) => sum + s, 0) / stats.totalStudents)
          : 0;
        
        // avgAttempts: average across ALL students (including 0 attempts for students who haven't tried)
        const avgAttempts = stats.totalStudents > 0
          ? Math.round((stats.studentAttempts.reduce((sum, a) => sum + a, 0) / stats.totalStudents) * 10) / 10
          : 0;
        
        // passRatePercent: percentage of students who passed (out of all students in class)
        const passRatePercent = stats.totalStudents > 0
          ? Math.round((stats.studentsPassed / stats.totalStudents) * 100)
          : 0;
        
        lmsSummary.assessments.push({
          assessmentId: stats.assessmentId,
          title: stats.title,
          lessonId: stats.lessonId,
          lessonTitle: stats.lessonTitle,
          avgScorePercent,
          avgAttempts,
          passRatePercent
        });
      }
      
      // Sort lessons by lessonId
      lmsSummary.lessons.sort((a, b) => a.lessonId - b.lessonId);
      
      // Sort assessments by lessonId, then by title
      lmsSummary.assessments.sort((a, b) => {
        if (a.lessonId !== b.lessonId) return a.lessonId - b.lessonId;
        return a.title.localeCompare(b.title);
      });
      
    } catch (lmsError) {
      console.error('Error aggregating LMS analytics:', lmsError);
      // Continue with empty LMS summary if there's an error
    }
    
    // Recalculate GAME simulation status summary using only real simulations
    // CRITICAL: Only lessons 1 and 2 have simulations in the Unity game
    // Identify which lessons have real simulations (those included in gameSims)
    // But restrict to only lessons 1 and 2 (the actual simulations in Unity)
    const realSimulationLessonIds = new Set(
      gameSims
        .map(sim => sim.lessonId)
        .filter(lessonId => lessonId === 1 || lessonId === 2) // Only lessons 1 and 2 have simulations
    );
    const realSimulationsCount = realSimulationLessonIds.size;
    
    // Recalculate simulation status and at-risk based on real simulations only
    studentsCompletedAllSims = 0;
    studentsInProgress = 0;
    studentsNotStarted = 0;
    
    // Recalculate at-risk students with correct simulation completion rate
    atRiskStudents = 0;
    atRiskStudentList.length = 0; // Clear previous entries
    
    for (const [studentId, data] of Object.entries(studentData)) {
      // Count only completions for real simulations
      let realSimCompletions = 0;
      for (const lessonId of data.simCompletions) {
        if (realSimulationLessonIds.has(lessonId)) {
          realSimCompletions += 1;
        }
      }
      
      // GAME quiz average (from Unity game quizzes only)
      const gameQuizAvg = data.quizScores.length > 0
        ? data.quizScores.reduce((sum, score) => sum + score, 0) / data.quizScores.length
        : 0;
      
      // GAME simulation completion rate (based on real simulations only)
      const gameSimulationCompletion = realSimulationsCount > 0 
        ? realSimCompletions / realSimulationsCount 
        : 0;
      
      // INSTRUCTOR TASK metrics (separate from game)
      const taskCompletionRate = data.totalTasks > 0 ? data.taskSubmissions / data.totalTasks : 0;
      const avgTaskScorePercent = data.taskScores.length > 0
        ? data.taskScores.reduce((sum, score) => sum + score, 0) / data.taskScores.length
        : 0;
      
      // At-risk if: game quiz avg < 6/10 OR game sim completion < 70% OR task completion < 70% OR task score < 60%
      const isAtRisk = gameQuizAvg < 6 ||
                       gameSimulationCompletion < 0.7 ||
                       (data.totalTasks > 0 && (taskCompletionRate < 0.7 || avgTaskScorePercent < 60));
      
      if (isAtRisk) {
        atRiskStudents += 1;
        atRiskStudentList.push({
          studentId,
          name: data.name,
          email: data.email,
          reasons: []
        });
        
        if (gameQuizAvg < 6) atRiskStudentList[atRiskStudentList.length - 1].reasons.push('Low game quiz scores');
        if (gameSimulationCompletion < 0.7) atRiskStudentList[atRiskStudentList.length - 1].reasons.push('Incomplete game simulations');
        if (data.totalTasks > 0 && taskCompletionRate < 0.7) atRiskStudentList[atRiskStudentList.length - 1].reasons.push('Missing task submissions');
        if (data.totalTasks > 0 && avgTaskScorePercent < 60) atRiskStudentList[atRiskStudentList.length - 1].reasons.push('Low task scores');
      }
      
      // Track simulation status summary (based on real simulations only)
      if (realSimCompletions === realSimulationsCount && realSimulationsCount > 0) {
        studentsCompletedAllSims += 1;
      } else if (realSimCompletions > 0) {
        studentsInProgress += 1;
      } else {
        studentsNotStarted += 1;
      }
    }
    
    res.json({
      success: true,
      assessments: {
        lessons: gameLessons, // GAME lessons (6 fixed Unity game lessons)
        simulations: gameSims // GAME simulations (6 fixed Unity game lessons)
      },
      stats: {
        avgQuizScore: Math.round(overallGameQuizAvg * 10) / 10, // GAME quiz average (0-10), round to 1 decimal
        totalQuizAttempts: totalQuizAttempts, // GAME quiz attempts
        simulationPassRate: Math.round(gameSimulationPassRate * 100) / 100, // GAME simulation pass rate
        atRiskStudents: atRiskStudents // Based on game quizzes, game simulations, and instructor tasks
      },
      taskSummary, // INSTRUCTOR TASK analytics (separate from game)
      lmsSummary, // LMS analytics (web lessons, pages, assessments) - separate from game and tasks
      atRiskStudentList,
      lowScoringQuizzes: lowScoringGameQuizzes, // GAME quizzes with low scores
      simulationSummary: {
        completedAll: studentsCompletedAllSims, // GAME simulations
        inProgress: studentsInProgress, // GAME simulations
        notStarted: studentsNotStarted // GAME simulations
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
    
    const usersRef = db.ref(USERS_COLLECTION);
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

// ============================================
// Class Student Progress API
// ============================================

/**
 * GET /api/instructor/classes/:classId/students/progress
 * Returns LMS + Game progress for all students in a class
 */
router.get('/classes/:classId/students/progress', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { classId } = req.params;
    
    // Verify instructor owns the class
    const classRef = db.ref(`classes/${classId}`);
    const classSnapshot = await classRef.once('value');
    const classData = classSnapshot.val();
    
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }
    
    if (classData.instructorId !== instructorId) {
      return res.status(403).json({ error: 'Instructor does not own this class' });
    }
    
    const studentIds = classData.studentIds || {};
    const studentUids = Object.keys(studentIds);
    
    // Load lesson metadata
    const [lessonsSnapshot, lmsLessonsSnapshot] = await Promise.all([
      db.ref('lessons').once('value'),
      db.ref('lmsLessons').once('value')
    ]);
    const allLessons = lessonsSnapshot.val() || {};
    const allLmsLessons = lmsLessonsSnapshot.val() || {};
    
    const students = [];
    
    for (const studentId of studentUids) {
      // Get student user data
      const userRef = db.ref(`${USERS_COLLECTION}/${studentId}`);
      const userSnapshot = await userRef.once('value');
      const userData = userSnapshot.val() || {};
      
      if (!userData || userData.role !== 'student') continue;
      
      const studentInfo = userData.studentInfo || {};
      
      // Load LMS progress
      const lmsProgressRef = db.ref(`${USERS_COLLECTION}/${studentId}/lmsProgress`);
      const lmsProgressSnapshot = await lmsProgressRef.once('value');
      const lmsProgress = lmsProgressSnapshot.val() || {};
      
      // Load Game progress
      const gameProgressRef = db.ref(`${USERS_COLLECTION}/${studentId}/progress`);
      const gameProgressSnapshot = await gameProgressRef.once('value');
      const gameProgress = gameProgressSnapshot.val() || {};
      
      // Calculate LMS summary
      let lmsLessonsCompleted = 0;
      let lmsTotalPagesCompleted = 0;
      let lmsTotalPages = 0;
      let lmsTotalQuizScore = 0;
      let lmsQuizCount = 0;
      
      // Calculate Game summary
      let gameTotalQuizScore = 0;
      let gameQuizCount = 0;
      let gameSimulationsPassed = 0;
      let gameTotalSimulations = 0;
      
      for (let slot = 1; slot <= 6; slot++) {
        const slotKey = String(slot);
        const lessonMeta = allLessons[slotKey] || {};
        const lmsLessonMeta = allLmsLessons[slotKey] || {};
        
        const rawStatus = (lessonMeta.status || '').toString().toLowerCase();
        const isPublished = rawStatus === 'published';
        if (!isPublished) continue;
        
        // LMS calculations
        const pages = lmsLessonMeta.pages || {};
        const totalPages = Object.keys(pages).length;
        lmsTotalPages += totalPages;
        
        const lessonProgress = lmsProgress[`lesson${slot}`] || {};
        const completedPages = lessonProgress.completedPages || {};
        const completedPagesCount = Object.keys(completedPages).filter(
          (key) => completedPages[key]
        ).length;
        lmsTotalPagesCompleted += completedPagesCount;
        
        const rawQuiz = normalizeQuiz(lessonProgress.quiz || {});
        const rawSimulation = normalizeSimulation(
          lessonProgress.simulation || lessonProgress.sim || {}
        );
        
        // Check if lesson is completed (all pages + quiz + sim)
        const hasPages = totalPages > 0 && completedPagesCount >= totalPages;
        const hasProgressObject = lessonProgress && typeof lessonProgress === 'object' && Object.keys(lessonProgress).length > 0;
        const lessonStatus = computeLmsLessonStatus({
          hasPages,
          quiz: rawQuiz,
          simulation: rawSimulation,
          hasProgressObject
        });
        
        if (lessonStatus === 'completed') {
          lmsLessonsCompleted += 1;
        }
        
        if (rawQuiz.completed && rawQuiz.highestScore > 0) {
          lmsTotalQuizScore += rawQuiz.highestScore;
          lmsQuizCount += 1;
        }
        
        // Game calculations
        const lessonGameProgress = gameProgress[`lesson${slot}`] || {};
        const gameQuiz = normalizeQuiz(lessonGameProgress.quiz || {});
        const gameSim = normalizeSimulation(lessonGameProgress.simulation || {});
        
        if (gameQuiz.completed && gameQuiz.highestScore > 0) {
          gameTotalQuizScore += gameQuiz.highestScore;
          gameQuizCount += 1;
        }
        
        if (gameSim.completed) {
          gameTotalSimulations += 1;
          if (gameSim.passed) {
            gameSimulationsPassed += 1;
          }
        }
      }
      
      const lmsAvgQuizScore = lmsQuizCount > 0 ? Math.round((lmsTotalQuizScore / lmsQuizCount) * 10) / 10 : 0;
      const gameAvgQuizScore = gameQuizCount > 0 ? Math.round((gameTotalQuizScore / gameQuizCount) * 10) / 10 : 0;
      
      students.push({
        studentId,
        name: userData.name || userData.fullName || 'Student',
        email: userData.email || '',
        studentNumber: studentInfo.studentNumber || '',
        batch: studentInfo.batch || '',
        lmsSummary: {
          lessonsCompleted: lmsLessonsCompleted,
          totalPagesCompleted: lmsTotalPagesCompleted,
          totalPages: lmsTotalPages,
          averageQuizScore: lmsAvgQuizScore,
          quizCount: lmsQuizCount
        },
        gameSummary: {
          averageQuizScore: gameAvgQuizScore,
          quizzesCompleted: gameQuizCount,
          simulationsPassed: gameSimulationsPassed,
          totalSimulations: gameTotalSimulations
        }
      });
    }
    
    res.json({
      success: true,
      students
    });
  } catch (error) {
    console.error('Error getting class student progress:', error);
    res.status(500).json({ error: 'Failed to get student progress' });
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
 * GET /api/instructor/assessment/students
 * Returns gradebook data for all students in instructor's class
 * Includes LMS, Game, and Task aggregates per student
 */
router.get('/assessment/students', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    
    // Find instructor's class
    const classesRef = db.ref('classes');
    const classesSnapshot = await classesRef.once('value');
    const classesData = classesSnapshot.val() || {};
    
    let classId = null;
    let classData = null;
    for (const [cid, cd] of Object.entries(classesData)) {
      if (cd && cd.instructorId === instructorId) {
        classId = cid;
        classData = cd;
        break;
      }
    }
    
    if (!classId || !classData) {
      return res.json({
        success: true,
        students: []
      });
    }
    
    // Get student IDs from class
    const studentIds = classData.studentIds || {};
    const studentUids = Object.keys(studentIds);
    
    // Get task posts for this class
    const postsRef = db.ref(`classPosts/${classId}`);
    const postsSnapshot = await postsRef.once('value');
    const postsData = postsSnapshot.val() || {};
    
    const taskPosts = [];
    for (const [postId, postData] of Object.entries(postsData)) {
      if (postData && postData.type === 'task') {
        const maxScore = postData.taskMeta?.maxScore || postData.maxScore || 10;
        taskPosts.push({
          postId,
          title: postData.title || 'Untitled Task',
          maxScore: Number(maxScore),
          dueDate: postData.taskMeta?.dueDate || postData.dueDate || null
        });
      }
    }
    
    // Get task submissions
    const taskSubmissionsRef = db.ref(`classTaskSubmissions/${classId}`);
    const taskSubmissionsSnapshot = await taskSubmissionsRef.once('value');
    const taskSubmissionsData = taskSubmissionsSnapshot.val() || {};
    
    // Load LMS lesson metadata and pages
    const [lmsLessonsMetaSnapshot, lmsLessonsSnapshot] = await Promise.all([
      db.ref('lessons').once('value'),
      db.ref('lmsLessons').once('value')
    ]);
    const lmsLessonsMeta = lmsLessonsMetaSnapshot.val() || {};
    const lmsLessonsData = lmsLessonsSnapshot.val() || {};
    
    // Identify real game simulations (those with data from any student)
    // CRITICAL: Only lessons 1 and 2 have simulations in the Unity game
    // A simulation is "real" if at least one student has attempted/completed it
    // But we only check lessons 1 and 2 (the actual simulations in Unity)
    const realSimulationLessonIds = new Set();
    
    // Get all student progress to identify real simulations (only check lessons 1 and 2)
    for (const studentId of studentUids) {
      const userRef = db.ref(`${USERS_COLLECTION}/${studentId}`);
      const userSnapshot = await userRef.once('value');
      const userData = userSnapshot.val() || {};
      if (!userData || userData.role !== 'student') continue;
      
      const progress = userData.progress || {};
      // Only check lessons 1 and 2 for simulations (Unity game only has 2 simulations)
      for (let i = 1; i <= 2; i++) {
        const gameLessonProgress = progress[`lesson${i}`] || {};
        const gameSimulation = normalizeSimulation(gameLessonProgress.simulation || {});
        // If student has any simulation data (attempts or completion), it's a real simulation
        if (gameSimulation.attempts > 0 || gameSimulation.completed) {
          realSimulationLessonIds.add(i);
        }
      }
    }
    const realSimulationsTotal = realSimulationLessonIds.size;
    
    const students = [];
    
    for (const studentId of studentUids) {
      const userRef = db.ref(`${USERS_COLLECTION}/${studentId}`);
      const userSnapshot = await userRef.once('value');
      const userData = userSnapshot.val() || {};
      
      if (!userData || userData.role !== 'student') continue;
      
      const studentInfo = userData.studentInfo || {};
      
      // Load LMS progress
      const lmsProgressRef = db.ref(`${USERS_COLLECTION}/${studentId}/lmsProgress`);
      const lmsProgressSnapshot = await lmsProgressRef.once('value');
      const lmsProgress = lmsProgressSnapshot.val() || {};
      
      // Load LMS assessment history
      const lmsAssessmentHistoryRef = db.ref(`${USERS_COLLECTION}/${studentId}/lmsAssessmentHistory`);
      const lmsAssessmentHistorySnapshot = await lmsAssessmentHistoryRef.once('value');
      const lmsAssessmentHistory = lmsAssessmentHistorySnapshot.val() || {};
      
      // Load Game progress
      const gameProgressRef = db.ref(`${USERS_COLLECTION}/${studentId}/progress`);
      const gameProgressSnapshot = await gameProgressRef.once('value');
      const gameProgress = gameProgressSnapshot.val() || {};
      
      // Calculate LMS aggregates
      let lmsLessonsCompleted = 0;
      let lmsLessonsTotal = 0;
      let lmsTotalProgress = 0;
      let lmsAssessmentsCompleted = 0;
      let lmsAssessmentsTotal = 0;
      let lmsTotalAssessmentScore = 0;
      
      for (let slot = 1; slot <= 6; slot++) {
        const slotKey = String(slot);
        const lessonMeta = lmsLessonsMeta[slotKey] || {};
        const rawStatus = (lessonMeta.status || '').toString().toLowerCase();
        const isPublished = rawStatus === 'published';
        
        if (!isPublished) continue;
        
        lmsLessonsTotal += 1;
        const lmsLessonData = lmsLessonsData[slotKey] || {};
        const pages = lmsLessonData.pages || {};
        const totalPages = Object.keys(pages).length;
        
        const lessonProgress = lmsProgress[`lesson${slot}`] || {};
        const completedPages = lessonProgress.completedPages || {};
        const completedPagesCount = Object.keys(completedPages).filter(
          key => completedPages[key] === true
        ).length;
        
        const progressPercent = totalPages > 0 
          ? Math.round((completedPagesCount / totalPages) * 100) 
          : 0;
        lmsTotalProgress += progressPercent;
        
        if (totalPages > 0 && completedPagesCount >= totalPages) {
          lmsLessonsCompleted += 1;
        }
        
        // Count LMS assessments
        for (const [pageId, pageData] of Object.entries(pages)) {
          const assessments = pageData.assessments || {};
          if (Object.keys(assessments).length === 0) continue;
          
          lmsAssessmentsTotal += Object.keys(assessments).length;
          
          // Check if student has attempted this page's assessments
          const pageHistoryKey = `page_${pageId}`;
          const pageHistory = lmsAssessmentHistory[`lesson${slot}`]?.[pageHistoryKey] || {};
          const attemptKeys = Object.keys(pageHistory).filter(key => key.startsWith('attempt_'));
          const attempts = attemptKeys.map(key => pageHistory[key]).filter(Boolean);
          
          if (attempts.length > 0) {
            lmsAssessmentsCompleted += Object.keys(assessments).length;
            const scores = attempts.map(a => Number(a.scorePercent || 0)).filter(Number.isFinite);
            const bestScore = scores.length > 0 ? Math.max(...scores) : 0;
            lmsTotalAssessmentScore += bestScore;
          }
        }
      }
      
      const lmsAvgProgressPercent = lmsLessonsTotal > 0 
        ? Math.round(lmsTotalProgress / lmsLessonsTotal) 
        : 0;
      const lmsAvgAssessmentScorePercent = lmsAssessmentsCompleted > 0
        ? Math.round(lmsTotalAssessmentScore / lmsAssessmentsCompleted)
        : 0;
      
      // Calculate Game aggregates
      let gameTotalQuizScore = 0;
      let gameQuizCount = 0;
      let gameQuizzesTotal = 6;
      let gameSimulationsPassed = 0;
      
      for (let i = 1; i <= 6; i++) {
        const gameLessonProgress = gameProgress[`lesson${i}`] || {};
        const gameQuiz = normalizeQuiz(gameLessonProgress.quiz || {});
        const gameSimulation = normalizeSimulation(gameLessonProgress.simulation || {});
        
        if (gameQuiz.attempts > 0 && gameQuiz.highestScore > 0) {
          gameTotalQuizScore += gameQuiz.highestScore;
          gameQuizCount += 1;
        }
        
        // Only count simulations for lessons 1 and 2 (Unity game only has 2 simulations)
        if ((i === 1 || i === 2) && realSimulationLessonIds.has(i) && gameSimulation.completed && gameSimulation.passed) {
          gameSimulationsPassed += 1;
        }
      }
      
      const gameAvgQuizScore = gameQuizCount > 0 
        ? Math.round((gameTotalQuizScore / gameQuizCount) * 10) / 10 
        : 0;
      
      // Calculate Task aggregates
      let tasksGraded = 0;
      let tasksTotal = taskPosts.length;
      let taskTotalScorePercent = 0;
      
      for (const taskPost of taskPosts) {
        const submission = taskSubmissionsData[taskPost.postId]?.[studentId];
        if (submission && submission.score !== null && submission.score !== undefined) {
          tasksGraded += 1;
          const score = Number(submission.score);
          const scorePercent = (score / taskPost.maxScore) * 100;
          taskTotalScorePercent += scorePercent;
        }
      }
      
      const taskAvgScorePercent = tasksGraded > 0
        ? Math.round((taskTotalScorePercent / tasksGraded) * 100) / 100
        : 0;
      
      // Calculate status (at-risk logic)
      const gameSimulationCompletion = realSimulationsTotal > 0 
        ? gameSimulationsPassed / realSimulationsTotal 
        : 0;
      const taskCompletionRate = tasksTotal > 0 
        ? tasksGraded / tasksTotal 
        : 0;
      
      let status = 'ON_TRACK';
      if (gameAvgQuizScore < 6 ||
          gameSimulationCompletion < 0.7 ||
          (tasksTotal > 0 && (taskCompletionRate < 0.7 || taskAvgScorePercent < 60))) {
        status = 'AT_RISK';
      }
      
      students.push({
        uid: studentId,
        name: userData.name || userData.fullName || 'Student',
        email: userData.email || '',
        studentNumber: studentInfo.studentNumber || '',
        lms: {
          lessonsCompleted: lmsLessonsCompleted,
          lessonsTotal: lmsLessonsTotal,
          avgProgressPercent: lmsAvgProgressPercent,
          assessmentsCompleted: lmsAssessmentsCompleted,
          assessmentsTotal: lmsAssessmentsTotal,
          avgAssessmentScorePercent: lmsAvgAssessmentScorePercent
        },
        game: {
          avgQuizScore: gameAvgQuizScore,
          quizzesTaken: gameQuizCount,
          quizzesTotal: gameQuizzesTotal,
          simulationsPassed: gameSimulationsPassed,
          simulationsTotal: realSimulationsTotal
        },
        tasks: {
          tasksGraded: tasksGraded,
          tasksTotal: tasksTotal,
          avgTaskScorePercent: taskAvgScorePercent
        },
        status: status
      });
    }
    
    res.json({
      success: true,
      students
    });
  } catch (error) {
    console.error('Error getting gradebook data:', error);
    res.status(500).json({ error: 'Failed to fetch gradebook data' });
  }
});

/**
 * GET /api/instructor/assessment/students/:studentId
 * Returns detailed assessment record for a specific student
 * Includes LMS lessons, assessments, game quizzes, simulations, and tasks
 */
router.get('/assessment/students/:studentId', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { studentId } = req.params;
    
    // Find instructor's class
    const classesRef = db.ref('classes');
    const classesSnapshot = await classesRef.once('value');
    const classesData = classesSnapshot.val() || {};
    
    let classId = null;
    let classData = null;
    for (const [cid, cd] of Object.entries(classesData)) {
      if (cd && cd.instructorId === instructorId) {
        classId = cid;
        classData = cd;
        break;
      }
    }
    
    if (!classId || !classData) {
      return res.status(404).json({ error: 'Class not found' });
    }
    
    // Verify student belongs to this class
    const studentIds = classData.studentIds || {};
    if (!studentIds[studentId]) {
      return res.status(403).json({ error: 'Student not in your class' });
    }
    
    // Get student data
    const userRef = db.ref(`${USERS_COLLECTION}/${studentId}`);
    const userSnapshot = await userRef.once('value');
    const userData = userSnapshot.val() || {};
    
    if (!userData || userData.role !== 'student') {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    const studentInfo = userData.studentInfo || {};
    
    // Load all progress data
    const [lmsProgressSnapshot, gameProgressSnapshot, lmsAssessmentHistorySnapshot] = await Promise.all([
      db.ref(`${USERS_COLLECTION}/${studentId}/lmsProgress`).once('value'),
      db.ref(`${USERS_COLLECTION}/${studentId}/progress`).once('value'),
      db.ref(`${USERS_COLLECTION}/${studentId}/lmsAssessmentHistory`).once('value')
    ]);
    
    const lmsProgress = lmsProgressSnapshot.val() || {};
    const gameProgress = gameProgressSnapshot.val() || {};
    const lmsAssessmentHistory = lmsAssessmentHistorySnapshot.val() || {};
    
    // Load LMS lesson metadata and pages
    const [lmsLessonsMetaSnapshot, lmsLessonsSnapshot] = await Promise.all([
      db.ref('lessons').once('value'),
      db.ref('lmsLessons').once('value')
    ]);
    const lmsLessonsMeta = lmsLessonsMetaSnapshot.val() || {};
    const lmsLessonsData = lmsLessonsSnapshot.val() || {};
    
    // Get task posts and submissions
    const [postsSnapshot, taskSubmissionsSnapshot] = await Promise.all([
      db.ref(`classPosts/${classId}`).once('value'),
      db.ref(`classTaskSubmissions/${classId}`).once('value')
    ]);
    const postsData = postsSnapshot.val() || {};
    const taskSubmissionsData = taskSubmissionsSnapshot.val() || {};
    
    // Identify real game simulations (those with data from any student in the class)
    // CRITICAL: Only lessons 1 and 2 have simulations in the Unity game
    // For per-student detail, we need to check all students in the class to determine which simulations exist
    // But we only check lessons 1 and 2 (the actual simulations in Unity)
    const realSimulationLessonIds = new Set();
    
    // Get all students in class to identify real simulations (only check lessons 1 and 2)
    const allStudentUids = Object.keys(studentIds);
    
    for (const sid of allStudentUids) {
      const sRef = db.ref(`${USERS_COLLECTION}/${sid}/progress`);
      const sSnapshot = await sRef.once('value');
      const sProgress = sSnapshot.val() || {};
      
      // Only check lessons 1 and 2 for simulations (Unity game only has 2 simulations)
      for (let i = 1; i <= 2; i++) {
        const sLessonProgress = sProgress[`lesson${i}`] || {};
        const sSimulation = normalizeSimulation(sLessonProgress.simulation || {});
        if (sSimulation.attempts > 0 || sSimulation.completed) {
          realSimulationLessonIds.add(i);
        }
      }
    }
    const realSimulationsTotal = realSimulationLessonIds.size;
    
    // Game lesson names
    const gameLessonNames = {
      1: 'Monitoring Vital Signs',
      2: 'Medication Assistance',
      3: 'Meal Preparation & Feeding',
      4: 'Personal Care & Hygiene',
      5: 'Safety & Emergencies',
      6: 'Communication & Documentation'
    };
    
    // Build LMS lessons detail
    const lmsLessons = [];
    let lmsLessonsCompleted = 0;
    let lmsLessonsTotal = 0;
    let lmsTotalProgress = 0;
    
    for (let slot = 1; slot <= 6; slot++) {
      const slotKey = String(slot);
      const lessonMeta = lmsLessonsMeta[slotKey] || {};
      const rawStatus = (lessonMeta.status || '').toString().toLowerCase();
      const isPublished = rawStatus === 'published';
      
      if (!isPublished) continue;
      
      lmsLessonsTotal += 1;
      const lessonTitle = lessonMeta.lessonTitle || lessonMeta.lessonName || `LMS Lesson ${slot}`;
      const lmsLessonData = lmsLessonsData[slotKey] || {};
      const pages = lmsLessonData.pages || {};
      const totalPages = Object.keys(pages).length;
      
      const lessonProgress = lmsProgress[`lesson${slot}`] || {};
      const completedPages = lessonProgress.completedPages || {};
      const completedPagesCount = Object.keys(completedPages).filter(
        key => completedPages[key] === true
      ).length;
      
      const progressPercent = totalPages > 0 
        ? Math.round((completedPagesCount / totalPages) * 100) 
        : 0;
      lmsTotalProgress += progressPercent;
      
      const completed = totalPages > 0 && completedPagesCount >= totalPages;
      if (completed) {
        lmsLessonsCompleted += 1;
      }
      
      lmsLessons.push({
        lessonId: slot,
        lessonTitle,
        pagesCompleted: completedPagesCount,
        totalPages,
        progressPercent,
        completed
      });
    }
    
    const lmsAvgProgressPercent = lmsLessonsTotal > 0 
      ? Math.round(lmsTotalProgress / lmsLessonsTotal) 
      : 0;
    
    // Build LMS assessments detail
    const lmsAssessments = [];
    let lmsAssessmentsCompleted = 0;
    let lmsAssessmentsTotal = 0;
    let lmsTotalAssessmentScore = 0;
    
    for (let slot = 1; slot <= 6; slot++) {
      const slotKey = String(slot);
      const lessonMeta = lmsLessonsMeta[slotKey] || {};
      const rawStatus = (lessonMeta.status || '').toString().toLowerCase();
      const isPublished = rawStatus === 'published';
      
      if (!isPublished) continue;
      
      const lessonTitle = lessonMeta.lessonTitle || lessonMeta.lessonName || `LMS Lesson ${slot}`;
      const lmsLessonData = lmsLessonsData[slotKey] || {};
      const pages = lmsLessonData.pages || {};
      
      for (const [pageId, pageData] of Object.entries(pages)) {
        const assessments = pageData.assessments || {};
        if (Object.keys(assessments).length === 0) continue;
        
        const pageHistoryKey = `page_${pageId}`;
        const pageHistory = lmsAssessmentHistory[`lesson${slot}`]?.[pageHistoryKey] || {};
        const attemptKeys = Object.keys(pageHistory).filter(key => key.startsWith('attempt_'));
        const attempts = attemptKeys.map(key => pageHistory[key]).filter(Boolean);
        
        for (const [assessmentId, assessmentData] of Object.entries(assessments)) {
          lmsAssessmentsTotal += 1;
          
          let bestScorePercent = 0;
          let attemptsCount = 0;
          let passed = false;
          let lastAttemptAt = null;
          
          if (attempts.length > 0) {
            lmsAssessmentsCompleted += 1;
            attemptsCount = attempts.length;
            const scores = attempts.map(a => Number(a.scorePercent || 0)).filter(Number.isFinite);
            bestScorePercent = scores.length > 0 ? Math.max(...scores) : 0;
            passed = attempts.some(a => Boolean(a.passed));
            const lastAttempt = attempts[attempts.length - 1];
            lastAttemptAt = lastAttempt?.submittedAt || null;
            lmsTotalAssessmentScore += bestScorePercent;
          }
          
          lmsAssessments.push({
            assessmentId,
            title: assessmentData.question || `Assessment ${assessmentId}`,
            lessonId: slot,
            lessonTitle,
            bestScorePercent,
            attempts: attemptsCount,
            passed,
            lastAttemptAt
          });
        }
      }
    }
    
    const lmsAvgAssessmentScorePercent = lmsAssessmentsCompleted > 0
      ? Math.round(lmsTotalAssessmentScore / lmsAssessmentsCompleted)
      : 0;
    
    // Build Game quizzes detail
    const gameQuizzes = [];
    let gameTotalQuizScore = 0;
    let gameQuizCount = 0;
    
    for (let i = 1; i <= 6; i++) {
      const gameLessonProgress = gameProgress[`lesson${i}`] || {};
      const gameQuiz = normalizeQuiz(gameLessonProgress.quiz || {});
      const gameLessonTitle = gameLessonNames[i] || `Game Lesson ${i}`;
      
      gameQuizzes.push({
        lessonKey: `lesson${i}`,
        lessonTitle: gameLessonTitle,
        bestScore: gameQuiz.highestScore || 0,
        attempts: gameQuiz.attempts || 0
      });
      
      if (gameQuiz.attempts > 0 && gameQuiz.highestScore > 0) {
        gameTotalQuizScore += gameQuiz.highestScore;
        gameQuizCount += 1;
      }
    }
    
    const gameAvgQuizScore = gameQuizCount > 0 
      ? Math.round((gameTotalQuizScore / gameQuizCount) * 10) / 10 
      : 0;
    
    // Build Game simulations detail (only real ones)
    // CRITICAL: Only lessons 1 and 2 have simulations in the Unity game
    const gameSimulations = [];
    let gameSimulationsPassed = 0;
    
    // Only check lessons 1 and 2 for simulations (Unity game only has 2 simulations)
    for (let i = 1; i <= 2; i++) {
      if (!realSimulationLessonIds.has(i)) continue;
      
      const gameLessonProgress = gameProgress[`lesson${i}`] || {};
      const gameSimulation = normalizeSimulation(gameLessonProgress.simulation || {});
      const gameLessonTitle = gameLessonNames[i] || `Game Lesson ${i}`;
      
      // Only count simulations for lessons 1 and 2 (Unity game only has 2 simulations)
      if (gameSimulation.completed && gameSimulation.passed) {
        gameSimulationsPassed += 1;
      }
      
      gameSimulations.push({
        simulationKey: `lesson${i}`,
        simulationTitle: gameLessonTitle,
        completed: gameSimulation.completed || false,
        passed: gameSimulation.passed || false,
        attempts: gameSimulation.attempts || 0
      });
    }
    
    // Build Tasks detail
    const tasks = [];
    let tasksGraded = 0;
    let tasksTotal = 0;
    let taskTotalScorePercent = 0;
    
    for (const [postId, postData] of Object.entries(postsData)) {
      if (postData && postData.type === 'task') {
        tasksTotal += 1;
        const maxScore = postData.taskMeta?.maxScore || postData.maxScore || 10;
        const submission = taskSubmissionsData[postId]?.[studentId];
        
        let status = 'missing';
        let score = null;
        let scorePercent = 0;
        let submittedAt = null;
        
        if (submission) {
          submittedAt = submission.submittedAt || null;
          if (submission.score !== null && submission.score !== undefined) {
            status = 'graded';
            score = Number(submission.score);
            scorePercent = (score / maxScore) * 100;
            tasksGraded += 1;
            taskTotalScorePercent += scorePercent;
          } else {
            status = 'submitted';
          }
          
          // Check if late
          if (submittedAt && postData.taskMeta?.dueDate) {
            const dueDate = new Date(postData.taskMeta.dueDate);
            const submitDate = new Date(submittedAt);
            if (submitDate > dueDate) {
              status = status === 'graded' ? 'late' : 'late';
            }
          }
        }
        
        tasks.push({
          postId,
          title: postData.title || 'Untitled Task',
          dueDate: postData.taskMeta?.dueDate || postData.dueDate || null,
          score,
          maxScore: Number(maxScore),
          scorePercent: Math.round(scorePercent * 100) / 100,
          submittedAt,
          status
        });
      }
    }
    
    const taskAvgScorePercent = tasksGraded > 0
      ? Math.round((taskTotalScorePercent / tasksGraded) * 100) / 100
      : 0;
    
    // Calculate status
    const gameSimulationCompletion = realSimulationsTotal > 0 
      ? gameSimulationsPassed / realSimulationsTotal 
      : 0;
    const taskCompletionRate = tasksTotal > 0 
      ? tasksGraded / tasksTotal 
      : 0;
    
    let status = 'ON_TRACK';
    if (gameAvgQuizScore < 6 ||
        gameSimulationCompletion < 0.7 ||
        (tasksTotal > 0 && (taskCompletionRate < 0.7 || taskAvgScorePercent < 60))) {
      status = 'AT_RISK';
    }
    
    // Build summary
    const summary = {
      lmsLessonsCompleted,
      lmsLessonsTotal,
      lmsAvgProgressPercent,
      lmsAssessmentsCompleted,
      lmsAssessmentsTotal,
      lmsAvgAssessmentScorePercent,
      gameAvgQuizScore,
      quizzesTaken: gameQuizCount,
      gameQuizzesTotal: 6,
      gameSimulationsPassed,
      gameSimulationsTotal: realSimulationsTotal,
      tasksGraded,
      tasksTotal,
      taskAvgScorePercent,
      status
    };
    
    res.json({
      success: true,
      student: {
        uid: studentId,
        name: userData.name || userData.fullName || 'Student',
        email: userData.email || '',
        studentNumber: studentInfo.studentNumber || '',
        class: {
          classId,
          className: classData.name || classData.courseName || 'Class'
        }
      },
      lmsLessons,
      lmsAssessments,
      gameQuizzes,
      gameSimulations,
      tasks,
      summary
    });
  } catch (error) {
    console.error('Error getting student assessment detail:', error);
    res.status(500).json({ error: 'Failed to fetch student assessment detail' });
  }
});

module.exports = router;

// INSTRUCTOR SIDE COMPLETION:
// - Normalized navigation across instructor HTML pages to a single, consistent tab set.
// - Added /api/public/lessons to expose published lesson metadata used by the instructor dashboard table.
// - Implemented a full instructor class feed UI (list, filters, details, and post creation) backed by
//   /api/instructor/class, /api/instructor/class/posts, and /api/instructor/class/upload-attachment.
// - Kept existing instructor flows for Students, Assessments, Certificates, Announcements, Student Progress,
//   and Profile intact while avoiding changes to Admin and Student portals.
