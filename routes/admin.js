const express = require('express');
const router = express.Router();
router.use(express.json({ limit: '100mb' }));
router.use(express.urlencoded({ extended: true, limit: '100mb' }));
const { verifyAdminToken } = require('../middleware/auth');
const { db } = require('../config/firebase');
const bcrypt = require('bcryptjs');

/**
 * Admin Routes
 * - GET /api/admin/users
 * - POST /api/admin/users/:uid/convert-to-student
 * - PUT /api/admin/users/:uid/assign-instructor
 * - POST /api/admin/users/create-instructor
 * - POST /api/admin/users/create-admin
 * - POST /api/admin/users/approve-student
 * - PUT /api/admin/users/:uid
 * - PUT /api/admin/users/:uid/status
 * - GET /api/admin/statistics
 */

router.get('/users', verifyAdminToken, async (req, res) => {
  try {
    const usersRef = db.ref('users');
    const usersSnapshot = await usersRef.once('value');
    const usersData = usersSnapshot.val() || {};

    const adminsRef = db.ref('admins');
    const adminsSnapshot = await adminsRef.once('value');
    const adminsData = adminsSnapshot.val() || {};

    const users = Object.entries(usersData).map(([uid, data = {}]) => {
      const {
        name = '',
        email = '',
        role = 'public',
        verified = false,
        active = true,
        studentInfo,
        assignedInstructor
      } = data;

      const summary = {
        uid,
        name,
        email,
        role: role || 'public',
        verified,
        active: active !== undefined ? active : true
      };

      if (studentInfo !== undefined) {
        summary.studentInfo = studentInfo;
      }

      if (assignedInstructor !== undefined) {
        summary.assignedInstructor = assignedInstructor;
      }

      return summary;
    });

    // Add instructors and admins from admins/ collection
    const admins = Object.entries(adminsData).map(([id, data = {}]) => {
      const {
        name = '',
        email = '',
        role = 'instructor',
        department = '',
        idNumber = '',
        createdAt = ''
      } = data;

      return {
        uid: id,
        name,
        email,
        role: role || 'instructor',
        verified: true,
        active: true,
        department,
        idNumber,
        createdAt
      };
    });

    // Combine users and admins
    const allUsers = [...users, ...admins];

    res.json({ success: true, users: allUsers });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/users/:uid/convert-to-student', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const {
      name,
      studentNumber,
      batch,
      school = '',
      birthday = '',
      address = ''
    } = req.body || {};

    if (!studentNumber || !batch) {
      return res.status(400).json({ error: 'studentNumber and batch are required' });
    }

    const userRef = db.ref(`users/${uid}`);
    const snapshot = await userRef.once('value');
    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingUser = snapshot.val() || {};

    if ((existingUser.role || 'public') !== 'public') {
      return res.status(400).json({ error: 'User is not a public user' });
    }

    const updatedData = {
      ...existingUser,
      role: 'student',
      verified: true,
      active: true,
      studentInfo: {
        studentNumber,
        batch,
        school,
        birthday,
        address
      }
    };

    if (name !== undefined) {
      updatedData.name = name;
    }

    await userRef.set(updatedData);

    const updatedSnapshot = await userRef.once('value');
    const updatedUser = updatedSnapshot.val();

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Convert to student error:', error);
    res.status(500).json({ error: 'Failed to convert user to student' });
  }
});

router.put('/users/:uid/assign-instructor', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const { instructorId } = req.body || {};

    const studentRef = db.ref(`users/${uid}`);
    const studentSnapshot = await studentRef.once('value');

    if (!studentSnapshot.exists()) {
      return res.status(400).json({ error: 'Student not found' });
    }

    const studentData = studentSnapshot.val() || {};
    if ((studentData.role || 'public') === 'public') {
      return res.status(400).json({ error: 'Student not found' });
    }

    // Handle removal of instructor assignment
    if (!instructorId || instructorId === '') {
      const oldInstructorId = studentData.assignedInstructor;
      if (oldInstructorId) {
        // Remove from old instructor's assignedStudents
        const oldInstructorRef = db.ref(`admins/${oldInstructorId}/assignedStudents/${uid}`);
        await oldInstructorRef.remove();
      }
      await studentRef.update({ assignedInstructor: null });
      return res.json({ success: true, studentId: uid, instructorId: null, message: 'Instructor assignment removed' });
    }

    // Validate instructor exists
    const instructorRef = db.ref(`admins/${instructorId}`);
    const instructorSnapshot = await instructorRef.once('value');

    if (!instructorSnapshot.exists()) {
      return res.status(400).json({ error: 'Instructor not found' });
    }

    const instructorData = instructorSnapshot.val() || {};
    if (!instructorData.role || (instructorData.role !== 'instructor' && instructorData.role !== 'admin')) {
      return res.status(400).json({ error: 'Instructor not found' });
    }

    // Remove from old instructor if student was previously assigned
    const oldInstructorId = studentData.assignedInstructor;
    if (oldInstructorId && oldInstructorId !== instructorId) {
      const oldInstructorRef = db.ref(`admins/${oldInstructorId}/assignedStudents/${uid}`);
      await oldInstructorRef.remove();
    }

    // Assign to new instructor
    await studentRef.update({ assignedInstructor: instructorId });
    await instructorRef.child(`assignedStudents/${uid}`).set(true);

    res.json({ success: true, studentId: uid, instructorId });
  } catch (error) {
    console.error('Assign instructor error:', error);
    res.status(500).json({ error: 'Failed to assign instructor' });
  }
});

router.post('/users/create-instructor', verifyAdminToken, async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      department = '',
      idNumber = ''
    } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required' });
    }

    const adminsRef = db.ref('admins');
    const snapshot = await adminsRef.once('value');
    const admins = snapshot.val() || {};

    const emailExists = Object.values(admins).some(admin => {
      const adminEmail = (admin && admin.email) ? admin.email.toLowerCase() : null;
      return adminEmail === email.toLowerCase();
    });

    if (emailExists) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newInstructorRef = adminsRef.push();
    const instructorData = {
      name,
      email,
      passwordHash,
      role: 'instructor',
      department,
      idNumber,
      createdAt: new Date().toISOString()
    };

    await newInstructorRef.set(instructorData);

    res.json({
      success: true,
      id: newInstructorRef.key,
      instructor: {
        name,
        email,
        role: 'instructor',
        department,
        idNumber
      }
    });
  } catch (error) {
    console.error('Create instructor error:', error);
    res.status(500).json({ error: 'Failed to create instructor' });
  }
});

router.post('/users/create-admin', verifyAdminToken, async (req, res) => {
  try {
    const {
      name,
      email,
      password
    } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required' });
    }

    const adminsRef = db.ref('admins');
    const snapshot = await adminsRef.once('value');
    const admins = snapshot.val() || {};

    const emailExists = Object.values(admins).some(admin => {
      const adminEmail = (admin && admin.email) ? admin.email.toLowerCase() : null;
      return adminEmail === email.toLowerCase();
    });

    if (emailExists) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newAdminRef = adminsRef.push();
    const adminData = {
      name,
      email,
      passwordHash,
      role: 'admin',
      createdAt: new Date().toISOString()
    };

    await newAdminRef.set(adminData);

    res.json({
      success: true,
      id: newAdminRef.key,
      admin: {
        name,
        email,
        role: 'admin'
      }
    });
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ error: 'Failed to create admin' });
  }
});

router.post('/users/approve-student', verifyAdminToken, async (req, res) => {
  try {
    const {
      uid,
      studentNumber,
      batch,
      school,
      birthday,
      address,
      assignedInstructor
    } = req.body || {};

    if (!uid || !studentNumber || !batch || !school || !birthday || !address || !assignedInstructor) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const userRef = db.ref(`users/${uid}`);
    const snapshot = await userRef.once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingUser = snapshot.val() || {};

    if (existingUser.role && existingUser.role !== 'public') {
      return res.status(400).json({ error: 'User is not pending approval' });
    }

    const updatedData = {
      ...existingUser,
      role: 'student',
      verified: true,
      active: true,
      studentInfo: {
        studentNumber,
        batch,
        school,
        birthday,
        address
      },
      assignedInstructor
    };

    await userRef.set(updatedData);

    res.json({
      success: true,
      message: 'Student approved',
      uid,
      studentInfo: updatedData.studentInfo
    });
  } catch (error) {
    console.error('Approve student error:', error);
    res.status(500).json({ error: 'Failed to approve student' });
  }
});

router.put('/users/:uid', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const {
      name,
      email,
      role,
      active,
      studentInfo,
      assignedInstructor,
      contactNumber,
      address,
      birthday
    } = req.body || {};

    const hasUpdates = Object.keys(req.body || {}).length > 0;

    if (!hasUpdates) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const userRef = db.ref(`users/${uid}`);
    const snapshot = await userRef.once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingUser = snapshot.val() || {};
    const updatedData = { ...existingUser };

    if (name !== undefined) {
      updatedData.name = name;
    }

    if (email !== undefined) {
      updatedData.email = email;
    }

    if (role !== undefined) {
      updatedData.role = role;
    }

    if (active !== undefined) {
      updatedData.active = active;
    }

    if (studentInfo !== undefined) {
      updatedData.studentInfo = studentInfo;
    }

    if (assignedInstructor !== undefined) {
      updatedData.assignedInstructor = assignedInstructor;
    }
    
    if (contactNumber !== undefined) {
      updatedData.contactNumber = contactNumber;
    }

    if (address !== undefined) {
      updatedData.address = address;
    }

    if (birthday !== undefined) {
      updatedData.birthday = birthday;
    }

    await userRef.set(updatedData);

    res.json({
      success: true,
      message: 'User updated',
      uid,
      user: updatedData
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.put('/users/:uid/status', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const { active } = req.body || {};

    if (typeof active !== 'boolean') {
      return res.status(400).json({ error: '"active" must be a boolean' });
    }

    const userRef = db.ref(`users/${uid}`);
    const snapshot = await userRef.once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }

    await userRef.update({ active });

    res.json({
      success: true,
      uid,
      active
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

/**
 * GET /api/admin/instructors
 * Returns list of all instructors for dropdown/selection
 */
router.get('/instructors', verifyAdminToken, async (req, res) => {
  try {
    const adminsRef = db.ref('admins');
    const snapshot = await adminsRef.once('value');
    const adminsData = snapshot.val() || {};
    
    const instructors = [];
    for (const [id, admin] of Object.entries(adminsData)) {
      if (admin && (admin.role === 'instructor' || admin.role === 'admin')) {
        instructors.push({
          id,
          name: admin.name || '',
          email: admin.email || '',
          role: admin.role || 'instructor',
          department: admin.department || ''
        });
      }
    }
    
    res.json({ success: true, instructors });
  } catch (error) {
    console.error('Get instructors error:', error);
    res.status(500).json({ error: 'Failed to fetch instructors' });
  }
});

router.get('/statistics', verifyAdminToken, async (req, res) => {
  try {
    const usersRef = db.ref('users');
    const snapshot = await usersRef.once('value');
    const usersData = snapshot.val() || {};

    let totalUsers = 0;
    let totalPublic = 0;
    let totalStudents = 0;
    let totalInstructors = 0;
    let totalAdmins = 0;
    let activeUsers = 0;
    let totalQuizAttempts = 0;
    let totalSimulationAttempts = 0;

    for (const [, data = {}] of Object.entries(usersData)) {
      totalUsers += 1;
      const role = data.role || 'public';

      switch (role) {
        case 'student':
          totalStudents += 1;
          break;
        case 'instructor':
          totalInstructors += 1;
          break;
        case 'admin':
          totalAdmins += 1;
          break;
        default:
          totalPublic += 1;
      }

      if (data.active !== false) {
        activeUsers += 1;
      }

      const history = data.history || {};
      const quizzes = history.quizzes || {};
      const simulations = history.simulations || {};

      totalQuizAttempts += Object.keys(quizzes).length;
      totalSimulationAttempts += Object.keys(simulations).length;
    }

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalPublic,
        totalStudents,
        totalInstructors,
        totalAdmins,
        activeUsers,
        totalQuizAttempts,
        totalSimulationAttempts
      }
    });
  } catch (error) {
    console.error('Admin statistics error:', error);
    res.status(500).json({ error: 'Failed to fetch admin statistics' });
  }
});

const adminLessonsController = require('../controllers/adminLessonsController');

router.get('/lessons', verifyAdminToken, adminLessonsController.getLessons);
router.put('/lessons/:slot', verifyAdminToken, adminLessonsController.updateLesson);
router.post(
  '/lessons/:slot/tools/:toolId/model',
  verifyAdminToken,
  adminLessonsController.uploadToolModel,
);
router.delete(
  '/lessons/:slot/tools/:toolId/model',
  verifyAdminToken,
  adminLessonsController.deleteToolModel,
);
router.get('/quizzes/:lesson', verifyAdminToken, async (req, res) => {
  try {
    const lesson = parseInt(req.params.lesson);
    console.log(`Admin: Fetching quizzes for lesson ${lesson}`);
    
    if (isNaN(lesson) || lesson < 1 || lesson > 6) {
      return res.status(400).json({ error: 'Invalid lesson number (1-6)' });
    }
    const questionsRef = db.ref(`lessons/lesson${lesson}/questions`);
    const snapshot = await questionsRef.once('value');
    let questions = snapshot.val() || {};
    
    console.log(`Admin: Raw questions data for lesson ${lesson}:`, JSON.stringify(questions, null, 2));
    console.log(`Admin: Questions keys:`, questions ? Object.keys(questions) : 'none');
    const quizzesArray = [];
    for (let i = 0; i < 10; i++) {
      const questionData = questions[i];
      const slot = i + 1;
      
      if (questionData) {
        const choices = questionData.choices || [];
        const correctIndex = questionData.correctIndex !== undefined ? questionData.correctIndex : -1;
        const correctAnswer = correctIndex >= 0 && correctIndex <= 3 ? ['A', 'B', 'C', 'D'][correctIndex] : '';
        
        console.log(`Admin: Processing question ${i}:`, {
          questionText: questionData.questionText,
          choices: choices,
          correctIndex: correctIndex,
          correctAnswer: correctAnswer
        });
        
        quizzesArray.push({
          lesson: lesson,
          slot: slot,
          question: questionData.questionText || '',
          answerA: choices[0] || '',
          answerB: choices[1] || '',
          answerC: choices[2] || '',
          answerD: choices[3] || '',
          correctAnswer: correctAnswer,
          explanation: questionData.explanation || ''
        });
      } else {
        quizzesArray.push({
          lesson: lesson,
          slot: slot,
          question: '',
          answerA: '',
          answerB: '',
          answerC: '',
          answerD: '',
          correctAnswer: '',
          explanation: ''
        });
      }
    }
    console.log(`Admin: Returning ${quizzesArray.length} quizzes for lesson ${lesson}`);
    res.json({ success: true, lesson: lesson, quizzes: quizzesArray });
  } catch (error) {
    console.error('Get quizzes error:', error);
    res.status(500).json({ error: 'Failed to fetch quizzes', details: error.message });
  }
});
router.get('/quizzes', verifyAdminToken, async (req, res) => {
  try {
    const allQuizzes = {};
    
    for (let lesson = 1; lesson <= 6; lesson++) {
      const questionsRef = db.ref(`lessons/lesson${lesson}/questions`);
      const snapshot = await questionsRef.once('value');
      let questions = snapshot.val() || {};
      const quizzesArray = [];
      for (let i = 0; i < 10; i++) {
        const questionData = questions[i];
        const slot = i + 1;
        
        if (questionData) {
          const choices = questionData.choices || [];
          const correctIndex = questionData.correctIndex !== undefined ? questionData.correctIndex : -1;
          const correctAnswer = correctIndex >= 0 && correctIndex <= 3 ? ['A', 'B', 'C', 'D'][correctIndex] : '';
          
          quizzesArray.push({
            lesson: lesson,
            slot: slot,
            question: questionData.questionText || '',
            answerA: choices[0] || '',
            answerB: choices[1] || '',
            answerC: choices[2] || '',
            answerD: choices[3] || '',
            correctAnswer: correctAnswer,
            explanation: questionData.explanation || ''
          });
        } else {
          quizzesArray.push({
            lesson: lesson,
            slot: slot,
            question: '',
            answerA: '',
            answerB: '',
            answerC: '',
            answerD: '',
            correctAnswer: '',
            explanation: ''
          });
        }
      }
      allQuizzes[lesson] = quizzesArray;
    }
    res.json({ success: true, quizzes: allQuizzes });
  } catch (error) {
    console.error('Get all quizzes error:', error);
    res.status(500).json({ error: 'Failed to fetch quizzes' });
  }
});
router.put('/quizzes/:lesson/:slot', verifyAdminToken, async (req, res) => {
  try {
    const lesson = parseInt(req.params.lesson);
    const slot = parseInt(req.params.slot);
    
    if (lesson < 1 || lesson > 6) {
      return res.status(400).json({ error: 'Invalid lesson number (1-6)' });
    }
    if (slot < 1 || slot > 10) {
      return res.status(400).json({ error: 'Invalid quiz slot number (1-10)' });
    }
    const { question, answerA, answerB, answerC, answerD, correctAnswer, explanation } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }
    const questionIndex = slot - 1;
    const correctIndexMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
    const correctIndex = correctIndexMap[correctAnswer] !== undefined ? correctIndexMap[correctAnswer] : -1;
    
    const choices = [
      answerA || '',
      answerB || '',
      answerC || '',
      answerD || ''
    ];
    const questionRef = db.ref(`lessons/lesson${lesson}/questions/${questionIndex}`);
    const snapshot = await questionRef.once('value');
    const existing = snapshot.val() || {};
    await questionRef.set({
      questionText: question || existing.questionText || '',
      choices: choices,
      correctIndex: correctIndex !== -1 ? correctIndex : (existing.correctIndex !== undefined ? existing.correctIndex : 0),
      explanation: explanation !== undefined ? explanation : (existing.explanation || ''),
      updatedAt: new Date().toISOString()
    });
    res.json({ success: true, message: 'Quiz updated successfully' });
  } catch (error) {
    console.error('Update quiz error:', error);
    res.status(500).json({ error: 'Failed to update quiz' });
  }
});
module.exports = router;