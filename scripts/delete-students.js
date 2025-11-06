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

async function deleteStudents() {
  try {
    console.log('='.repeat(60));
    console.log('DELETING STUDENTS FROM DATABASE');
    console.log('='.repeat(60));
    console.log(`Database URL: ${process.env.FIREBASE_DATABASE_URL}\n`);

    // Get all students before deletion
    const studentsRef = db.ref('students');
    const studentsSnapshot = await studentsRef.once('value');
    const students = studentsSnapshot.val() || {};

    const studentCount = Object.keys(students).length;
    
    if (studentCount === 0) {
      console.log('⚠ No students found in database. Nothing to delete.');
      process.exit(0);
    }

    console.log(`Found ${studentCount} student(s) in database:`);
    for (const [studentId, studentData] of Object.entries(students)) {
      console.log(`  - ${studentId}: ${studentData.email || studentData.fullName || 'No email/name'}`);
    }

    console.log(`\n⚠ WARNING: This will delete ALL ${studentCount} student(s) from the database!`);
    console.log('⚠ Users database will remain untouched.\n');

    // Delete all students
    await studentsRef.remove();
    
    console.log('✅ Successfully deleted all students from database!');
    console.log(`✅ Deleted ${studentCount} student(s)`);
    console.log('✅ Users database remains intact');
    
    // Verify deletion
    const verifySnapshot = await studentsRef.once('value');
    const remainingStudents = verifySnapshot.val();
    
    if (!remainingStudents || Object.keys(remainingStudents).length === 0) {
      console.log('\n✅ Verification: Students collection is now empty');
    } else {
      console.log('\n⚠ Warning: Some students may still exist in database');
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ Deletion completed!');
    console.log('='.repeat(60));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error deleting students:', error);
    process.exit(1);
  }
}

deleteStudents();

