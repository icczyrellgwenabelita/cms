const express = require('express');
const router = express.Router();
const { verifyAdminToken } = require('../middleware/auth');
const { db } = require('../config/firebase');

// Get all lessons (6 slots)
router.get('/lessons', verifyAdminToken, async (req, res) => {
  try {
    const lessonsRef = db.ref('lessons');
    const snapshot = await lessonsRef.once('value');
    let lessons = snapshot.val() || {};

    // Ensure we have 6 slots
    const lessonsArray = [];
    for (let i = 1; i <= 6; i++) {
      lessonsArray.push(lessons[i] || {
        slot: i,
        lessonName: '',
        lessonDescription: ''
      });
    }

    res.json({ success: true, lessons: lessonsArray });
  } catch (error) {
    console.error('Get lessons error:', error);
    res.status(500).json({ error: 'Failed to fetch lessons' });
  }
});

// Update a lesson
router.put('/lessons/:slot', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    if (slot < 1 || slot > 6) {
      return res.status(400).json({ error: 'Invalid slot number (1-6)' });
    }

    const { lessonName, lessonDescription } = req.body;
    
    if (!lessonName && !lessonDescription) {
      return res.status(400).json({ error: 'Lesson name or description required' });
    }

    const lessonRef = db.ref(`lessons/${slot}`);
    const snapshot = await lessonRef.once('value');
    const existing = snapshot.val() || {};

    await lessonRef.set({
      slot,
      lessonName: lessonName !== undefined ? lessonName : existing.lessonName || '',
      lessonDescription: lessonDescription !== undefined ? lessonDescription : existing.lessonDescription || '',
      updatedAt: new Date().toISOString()
    });

    res.json({ success: true, message: 'Lesson updated successfully' });
  } catch (error) {
    console.error('Update lesson error:', error);
    res.status(500).json({ error: 'Failed to update lesson' });
  }
});

// Get all quizzes for a specific lesson (10 quizzes per lesson)
// NOTE: This route MUST come before /quizzes to ensure proper matching
router.get('/quizzes/:lesson', verifyAdminToken, async (req, res) => {
  try {
    const lesson = parseInt(req.params.lesson);
    console.log(`Admin: Fetching quizzes for lesson ${lesson}`);
    
    if (isNaN(lesson) || lesson < 1 || lesson > 6) {
      return res.status(400).json({ error: 'Invalid lesson number (1-6)' });
    }

    const quizzesRef = db.ref(`quizzes/lesson${lesson}`);
    const snapshot = await quizzesRef.once('value');
    let quizzes = snapshot.val() || {};

    // Ensure we have 10 quiz slots per lesson
    const quizzesArray = [];
    for (let i = 1; i <= 10; i++) {
      quizzesArray.push(quizzes[i] || {
        lesson: lesson,
        slot: i,
        question: '',
        answerA: '',
        answerB: '',
        answerC: '',
        answerD: '',
        correctAnswer: ''
      });
    }

    console.log(`Admin: Returning ${quizzesArray.length} quizzes for lesson ${lesson}`);
    res.json({ success: true, lesson: lesson, quizzes: quizzesArray });
  } catch (error) {
    console.error('Get quizzes error:', error);
    res.status(500).json({ error: 'Failed to fetch quizzes', details: error.message });
  }
});

// Get all quizzes for all lessons (for overview)
// NOTE: This route must come AFTER /quizzes/:lesson
router.get('/quizzes', verifyAdminToken, async (req, res) => {
  try {
    const allQuizzes = {};
    
    // Fetch quizzes for each lesson (1-6)
    for (let lesson = 1; lesson <= 6; lesson++) {
      const quizzesRef = db.ref(`quizzes/lesson${lesson}`);
      const snapshot = await quizzesRef.once('value');
      let quizzes = snapshot.val() || {};

      // Ensure we have 10 quiz slots per lesson
      const quizzesArray = [];
      for (let i = 1; i <= 10; i++) {
        quizzesArray.push(quizzes[i] || {
          lesson: lesson,
          slot: i,
          question: '',
          answerA: '',
          answerB: '',
          answerC: '',
          answerD: '',
          correctAnswer: ''
        });
      }
      allQuizzes[lesson] = quizzesArray;
    }

    res.json({ success: true, quizzes: allQuizzes });
  } catch (error) {
    console.error('Get all quizzes error:', error);
    res.status(500).json({ error: 'Failed to fetch quizzes' });
  }
});

// Update a quiz for a specific lesson
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

    const { question, answerA, answerB, answerC, answerD, correctAnswer } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const quizRef = db.ref(`quizzes/lesson${lesson}/${slot}`);
    const snapshot = await quizRef.once('value');
    const existing = snapshot.val() || {};

    await quizRef.set({
      lesson: lesson,
      slot: slot,
      question: question || existing.question || '',
      answerA: answerA !== undefined ? answerA : existing.answerA || '',
      answerB: answerB !== undefined ? answerB : existing.answerB || '',
      answerC: answerC !== undefined ? answerC : existing.answerC || '',
      answerD: answerD !== undefined ? answerD : existing.answerD || '',
      correctAnswer: correctAnswer || existing.correctAnswer || '',
      updatedAt: new Date().toISOString()
    });

    res.json({ success: true, message: 'Quiz updated successfully' });
  } catch (error) {
    console.error('Update quiz error:', error);
    res.status(500).json({ error: 'Failed to update quiz' });
  }
});

module.exports = router;

