const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  console.log('Firebase Admin initialized successfully\n');
} catch (error) {
  console.error('Firebase initialization error:', error);
  process.exit(1);
}

const db = admin.database();

async function fetchProgressRecords() {
  try {
    console.log('='.repeat(60));
    console.log('FETCHING ALL PROGRESS RECORDS');
    console.log('='.repeat(60));
    console.log(`Database URL: ${process.env.FIREBASE_DATABASE_URL}\n`);

    // Get all users
    const usersRef = db.ref('users');
    const usersSnapshot = await usersRef.once('value');
    const users = usersSnapshot.val() || {};

    if (Object.keys(users).length === 0) {
      console.log('⚠ No users found in database.');
      process.exit(0);
    }

    console.log(`Found ${Object.keys(users).length} user(s) in database\n`);

    // Process each user's progress
    for (const [userId, userData] of Object.entries(users)) {
      console.log(`${'='.repeat(60)}`);
      console.log(`👤 USER: ${userId}`);
      console.log(`   Email: ${userData.email || 'N/A'}`);
      console.log(`   Name: ${userData.name || 'N/A'}`);
      console.log('='.repeat(60));

      const progress = userData.progress || {};
      
      if (!progress || Object.keys(progress).length === 0) {
        console.log('   ⚠ No progress records found for this user\n');
        continue;
      }

      // Process each lesson (lesson1, lesson2, etc.)
      for (let i = 1; i <= 6; i++) {
        const lessonKey = `lesson${i}`;
        const lessonProgress = progress[lessonKey];

        if (!lessonProgress) {
          console.log(`\n📚 Lesson ${i}: No progress data`);
          continue;
        }

        console.log(`\n📚 Lesson ${i}:`);
        console.log(`   ${'-'.repeat(50)}`);

        // Quiz progress
        const quiz = lessonProgress.quiz || {};
        const quizCompleted = quiz.completed || false;
        const quizAttempts = quiz.attempts || 0;
        const quizHighestScore = quiz.highestScore || 0;
        const quizLatestScore = quiz.latestScore || 0;
        const quizAvgTime = quiz.avgTime || 0;

        console.log(`   📝 Quiz:`);
        console.log(`      Status: ${quizCompleted ? '✅ Completed' : '❌ Incomplete'}`);
        console.log(`      Attempts: ${quizAttempts}`);
        console.log(`      Highest Score: ${quizHighestScore}/10`);
        console.log(`      Latest Score: ${quizLatestScore}/10`);
        console.log(`      Avg Time: ${quizAvgTime.toFixed(2)}s`);

        // Simulation progress
        const simulation = lessonProgress.simulation || {};
        const simCompleted = simulation.completed || false;
        const simAttempts = simulation.attempts || 0;
        const simAvgTime = simulation.avgTime || 0;

        console.log(`   🎮 Simulation:`);
        console.log(`      Status: ${simCompleted ? '✅ Completed' : '❌ Incomplete'}`);
        console.log(`      Attempts: ${simAttempts}`);
        console.log(`      Avg Time: ${simAvgTime.toFixed(2)}s`);

        // Overall status: Both quiz AND simulation must be completed for "Completed"
        const overallStatus = (quizCompleted && simCompleted) ? '✅ Completed' : '🔄 In Progress';
        console.log(`\n   📊 Overall Status: ${overallStatus}`);
        if (!quizCompleted || !simCompleted) {
          const missing = [];
          if (!quizCompleted) missing.push('Quiz');
          if (!simCompleted) missing.push('Simulation');
          console.log(`      ⚠ Missing: ${missing.join(' and ')}`);
        }
      }

      // Summary for this user
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📊 PROGRESS SUMMARY FOR ${userData.email || userId}:`);
      console.log('='.repeat(60));
      
      let completedLessons = 0;
      let inProgressLessons = 0;
      let notStartedLessons = 0;

      for (let i = 1; i <= 6; i++) {
        const lessonKey = `lesson${i}`;
        const lessonProgress = progress[lessonKey];
        
        if (!lessonProgress) {
          notStartedLessons++;
          continue;
        }

        const quiz = lessonProgress.quiz || {};
        const simulation = lessonProgress.simulation || {};
        const quizCompleted = quiz.completed || false;
        const simCompleted = simulation.completed || false;

        if (quizCompleted && simCompleted) {
          completedLessons++;
        } else if (quizCompleted || simCompleted || quiz.attempts > 0 || simulation.attempts > 0) {
          inProgressLessons++;
        } else {
          notStartedLessons++;
        }
      }

      console.log(`   ✅ Completed Lessons: ${completedLessons}/6 (both quiz & simulation completed)`);
      console.log(`   🔄 In Progress Lessons: ${inProgressLessons}/6 (one or both incomplete)`);
      console.log(`   ⚪ Not Started Lessons: ${notStartedLessons}/6`);
      console.log(`   📈 Completion Rate: ${((completedLessons / 6) * 100).toFixed(1)}%`);
      console.log('');
    }

    // Overall database summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 DATABASE PROGRESS SUMMARY');
    console.log('='.repeat(60));
    
    let totalUsers = Object.keys(users).length;
    let totalCompletedLessons = 0;
    let totalInProgressLessons = 0;
    let totalNotStartedLessons = 0;

    for (const [userId, userData] of Object.entries(users)) {
      const progress = userData.progress || {};
      
      for (let i = 1; i <= 6; i++) {
        const lessonKey = `lesson${i}`;
        const lessonProgress = progress[lessonKey];
        
        if (!lessonProgress) {
          totalNotStartedLessons++;
          continue;
        }

        const quiz = lessonProgress.quiz || {};
        const simulation = lessonProgress.simulation || {};
        const quizCompleted = quiz.completed || false;
        const simCompleted = simulation.completed || false;

        if (quizCompleted && simCompleted) {
          totalCompletedLessons++;
        } else if (quizCompleted || simCompleted || quiz.attempts > 0 || simulation.attempts > 0) {
          totalInProgressLessons++;
        } else {
          totalNotStartedLessons++;
        }
      }
    }

    console.log(`   Total Users: ${totalUsers}`);
    console.log(`   Total Completed Lessons (all users): ${totalCompletedLessons}`);
    console.log(`   Total In Progress Lessons: ${totalInProgressLessons}`);
    console.log(`   Total Not Started Lessons: ${totalNotStartedLessons}`);
    console.log(`   Average Completion per User: ${(totalCompletedLessons / totalUsers).toFixed(1)} lessons`);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ Progress records fetch completed!');
    console.log('='.repeat(60));
    console.log('\n📌 Note: Overall status is "Completed" only when BOTH quiz AND simulation are completed.');
    console.log('   If either is incomplete, status remains "In Progress".');
    console.log('='.repeat(60));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fetching progress records:', error);
    process.exit(1);
  }
}

fetchProgressRecords();



