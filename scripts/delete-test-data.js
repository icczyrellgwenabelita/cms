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
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Firebase initialization error:', error);
  process.exit(1);
}

const db = admin.database();

async function deleteTestData() {
  try {
    console.log('Starting to delete test data...');

    // 1. Delete class statistics
    await db.ref('classStats/lessons').remove();
    console.log('✓ Deleted class statistics');

    // 2. Get all students and delete their lesson progress
    const studentsRef = db.ref('students');
    const studentsSnapshot = await studentsRef.once('value');
    const students = studentsSnapshot.val() || {};
    
    if (Object.keys(students).length > 0) {
      console.log(`\nFound ${Object.keys(students).length} student(s)`);
      
      for (const studentId of Object.keys(students)) {
        // Delete lesson progress for each student
        await db.ref(`students/${studentId}/lessonProgress`).remove();
        console.log(`✓ Deleted lesson progress for student: ${studentId}`);
        
        // Delete test certificates for each student
        await db.ref(`students/${studentId}/certificates`).remove();
        console.log(`✓ Deleted certificates for student: ${studentId}`);
      }
    } else {
      console.log('\n⚠ No students found in database.');
    }

    console.log('\n✅ Test data deleted successfully!');
    console.log('Note: Lessons data (lesson names and descriptions) were kept in the database.');
    console.log('Only test progress data, class stats, and certificates were removed.');
    
    process.exit(0);
  } catch (error) {
    console.error('Error deleting test data:', error);
    process.exit(1);
  }
}

deleteTestData();

