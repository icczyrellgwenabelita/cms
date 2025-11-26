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
async function fetchDatabaseData() {
  try {
    console.log('='.repeat(60));
    console.log('FETCHING DATABASE DATA');
    console.log('='.repeat(60));
    console.log(`Database URL: ${process.env.FIREBASE_DATABASE_URL}\n`);
    const collections = [
      'students',
      'users',
      'lessons',
      'quizzes',
      'admins',
      'classStats'
    ];
    for (const collection of collections) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📦 COLLECTION: ${collection.toUpperCase()}`);
      console.log('='.repeat(60));
      
      const ref = db.ref(collection);
      const snapshot = await ref.once('value');
      const data = snapshot.val();
      if (!data) {
        console.log('  (empty)');
        continue;
      }
      console.log(JSON.stringify(data, null, 2));
    }
    console.log(`\n${'='.repeat(60)}`);
    console.log('📋 DETAILED STUDENT DATA');
    console.log('='.repeat(60));
    
    const studentsRef = db.ref('students');
    const studentsSnapshot = await studentsRef.once('value');
    const students = studentsSnapshot.val() || {};
    if (Object.keys(students).length === 0) {
      console.log('  No students found in database.');
    } else {
      for (const [studentId, studentData] of Object.entries(students)) {
        console.log(`\n  👤 Student ID: ${studentId}`);
        console.log(`  ${'-'.repeat(50)}`);
        
        if (studentData.name) console.log(`  Name: ${studentData.name}`);
        if (studentData.fullName) console.log(`  Full Name: ${studentData.fullName}`);
        if (studentData.email) console.log(`  Email: ${studentData.email}`);
        if (studentData.verified !== undefined) console.log(`  Verified: ${studentData.verified}`);
        if (studentData.isVerified !== undefined) console.log(`  Is Verified: ${studentData.isVerified}`);
        
        if (studentData.lessonProgress) {
          console.log(`  \n  Lesson Progress:`);
          for (const [lessonNum, progress] of Object.entries(studentData.lessonProgress)) {
            console.log(`    Lesson ${lessonNum}: ${progress.status || 'N/A'} (Quiz Score: ${progress.quizScore || 'N/A'})`);
          }
        }
        
        if (studentData.certificates) {
          console.log(`  \n  Certificates (${studentData.certificates.length}):`);
          studentData.certificates.forEach(cert => {
            console.log(`    - ${cert.title} (${cert.date})`);
          });
        }
        
        if (studentData.profilePicture) {
          console.log(`  Profile Picture: ${studentData.profilePicture.length} characters (base64)`);
        }
      }
    }
    console.log(`\n${'='.repeat(60)}`);
    console.log('👥 DETAILED USERS DATA');
    console.log('='.repeat(60));
    
    const usersRef = db.ref('system/users');
    const usersSnapshot = await usersRef.once('value');
    const users = usersSnapshot.val() || {};
    if (Object.keys(users).length === 0) {
      console.log('  No users found in database.');
    } else {
      for (const [userId, userData] of Object.entries(users)) {
        console.log(`\n  👤 User ID: ${userId}`);
        console.log(`  ${'-'.repeat(50)}`);
        
        for (const [key, value] of Object.entries(userData)) {
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            console.log(`  ${key}:`);
            for (const [subKey, subValue] of Object.entries(value)) {
              if (typeof subValue === 'string' && subValue.length > 100) {
                console.log(`    ${subKey}: ${subValue.substring(0, 100)}... (truncated)`);
              } else {
                console.log(`    ${subKey}: ${subValue}`);
              }
            }
          } else if (Array.isArray(value)) {
            console.log(`  ${key}: [Array with ${value.length} items]`);
            if (value.length > 0 && value.length <= 5) {
              value.forEach((item, index) => {
                console.log(`    [${index}]: ${JSON.stringify(item)}`);
              });
            }
          } else if (typeof value === 'string' && value.length > 100) {
            console.log(`  ${key}: ${value.substring(0, 100)}... (truncated, length: ${value.length})`);
          } else {
            console.log(`  ${key}: ${value}`);
          }
        }
      }
    }
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 DATABASE SUMMARY');
    console.log('='.repeat(60));
    
    const lessonsRef = db.ref('lessons');
    const lessonsSnapshot = await lessonsRef.once('value');
    const lessons = lessonsSnapshot.val() || {};
    console.log(`  Lessons: ${Object.keys(lessons).length}`);
    
    const quizzesRef = db.ref('quizzes');
    const quizzesSnapshot = await quizzesRef.once('value');
    const quizzes = quizzesSnapshot.val() || {};
    console.log(`  Quizzes: ${Object.keys(quizzes).length}`);
    
    const adminsRef = db.ref('admins');
    const adminsSnapshot = await adminsRef.once('value');
    const admins = adminsSnapshot.val() || {};
    console.log(`  Admins: ${Object.keys(admins).length}`);
    
    console.log(`  Students: ${Object.keys(students).length}`);
    console.log(`  Users: ${Object.keys(users).length}`);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ Database fetch completed!');
    console.log('='.repeat(60));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fetching database data:', error);
    process.exit(1);
  }
}
fetchDatabaseData();