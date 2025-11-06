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

    // Fetch from lessons database - questions are nested under lesson1, lesson2, etc.
    const questionsRef = db.ref(`lessons/lesson${lesson}/questions`);
    const snapshot = await questionsRef.once('value');
    let questions = snapshot.val() || {};
    
    console.log(`Admin: Raw questions data for lesson ${lesson}:`, JSON.stringify(questions, null, 2));
    console.log(`Admin: Questions keys:`, questions ? Object.keys(questions) : 'none');

    // Convert database format to UI format
    // Database: questions/{index} with questionText, choices[], correctIndex, explanation
    // UI: slot (1-10), question, answerA/B/C/D, correctAnswer (A/B/C/D), explanation
    const quizzesArray = [];
    for (let i = 0; i < 10; i++) {
      const questionData = questions[i];
      const slot = i + 1; // UI uses 1-10, DB uses 0-9
      
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

// Get all quizzes for all lessons (for overview)
// NOTE: This route must come AFTER /quizzes/:lesson
router.get('/quizzes', verifyAdminToken, async (req, res) => {
  try {
    const allQuizzes = {};
    
    // Fetch quizzes for each lesson (1-6)
    for (let lesson = 1; lesson <= 6; lesson++) {
      const questionsRef = db.ref(`lessons/lesson${lesson}/questions`);
      const snapshot = await questionsRef.once('value');
      let questions = snapshot.val() || {};

      // Convert database format to UI format
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

    const { question, answerA, answerB, answerC, answerD, correctAnswer, explanation } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Convert UI format to database format
    // UI: slot (1-10), question, answerA/B/C/D, correctAnswer (A/B/C/D), explanation
    // Database: questions/{index (0-9)} with questionText, choices[], correctIndex (0-3), explanation
    const questionIndex = slot - 1; // Convert 1-10 to 0-9
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

