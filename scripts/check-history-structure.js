const admin = require('firebase-admin');
require('dotenv').config();

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

async function checkHistoryStructure() {
  try {
    const userId = 'ib9hnz1tBJdDqHPICoE5N5KSgbZ2';
    const userRef = db.ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    const userData = snapshot.val();

    console.log('='.repeat(60));
    console.log('CHECKING HISTORY STRUCTURE');
    console.log('='.repeat(60));
    console.log(`User ID: ${userId}\n`);

    // Check top-level history
    if (userData.history) {
      console.log('Found top-level "history" field:');
      console.log(JSON.stringify(userData.history, null, 2));
      console.log('\n');
    }

    // Check progress/lesson history
    for (let i = 1; i <= 6; i++) {
      const progressRef = db.ref(`users/${userId}/progress/lesson${i}`);
      const progressSnapshot = await progressRef.once('value');
      const progress = progressSnapshot.val();

      if (progress) {
        console.log(`\nLesson ${i} Progress:`);
        console.log(JSON.stringify(progress, null, 2));

        if (progress.quiz) {
          console.log(`\nLesson ${i} Quiz keys:`, Object.keys(progress.quiz));
          if (progress.quiz.history) {
            console.log(`Lesson ${i} Quiz History:`, JSON.stringify(progress.quiz.history, null, 2));
          }
        }
      }
    }

    // Check if history is at users/{userId}/history
    const historyRef = db.ref(`users/${userId}/history`);
    const historySnapshot = await historyRef.once('value');
    const historyData = historySnapshot.val();
    if (historyData) {
      console.log('\n\nFound history at users/{userId}/history:');
      console.log(JSON.stringify(historyData, null, 2));
    }

    process.exit(0);
  } catch (error) {
    console.error('Error checking history:', error);
    process.exit(1);
  }
}

checkHistoryStructure();


