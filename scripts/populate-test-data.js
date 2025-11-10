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
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Firebase initialization error:', error);
  process.exit(1);
}

const db = admin.database();

async function populateTestData() {
  try {
    console.log('Starting to populate test data...');

    const lessonsData = {
      1: {
        lessonName: 'Monitoring Vital Signs',
        lessonDescription: 'Learn how to accurately measure and monitor vital signs including temperature, blood pressure, pulse, and respiration rate.'
      },
      2: {
        lessonName: 'Medication Assistance',
        lessonDescription: 'Master safe medication assistance practices, dosage verification, and proper administration techniques.'
      },
      3: {
        lessonName: 'Meal Preparation and Feeding',
        lessonDescription: 'Understand proper meal preparation, dietary requirements, and safe feeding techniques for elderly patients.'
      },
      4: {
        lessonName: 'Safe Patient Transfer',
        lessonDescription: 'Learn safe techniques for transferring patients, proper body mechanics, and preventing injuries during transfers.'
      },
      5: {
        lessonName: 'Bathing and Grooming the Elderly',
        lessonDescription: 'Master gentle and respectful bathing techniques, grooming practices, and maintaining personal hygiene for elderly patients.'
      },
      6: {
        lessonName: 'Emergency Response',
        lessonDescription: 'Develop skills in responding to medical emergencies, including CPR, first aid protocols, and crisis management procedures.'
      }
    };

    await db.ref('lessons').set(lessonsData);
    console.log('✓ Created 6 lessons');

    const classStats = {
      1: {
        avgQuizGrade: 85,
        highestQuizGrade: 98,
        avgQuizTime: 15,
        avgSimTime: 25
      },
      2: {
        avgQuizGrade: 82,
        highestQuizGrade: 95,
        avgQuizTime: 18,
        avgSimTime: 30
      },
      3: {
        avgQuizGrade: 88,
        highestQuizGrade: 100,
        avgQuizTime: 20,
        avgSimTime: 35
      },
      4: {
        avgQuizGrade: 80,
        highestQuizGrade: 92,
        avgQuizTime: 16,
        avgSimTime: 28
      },
      5: {
        avgQuizGrade: 87,
        highestQuizGrade: 97,
        avgQuizTime: 22,
        avgSimTime: 40
      },
      6: {
        avgQuizGrade: 83,
        highestQuizGrade: 94,
        avgQuizTime: 14,
        avgSimTime: 22
      }
    };

    await db.ref('classStats/lessons').set(classStats);
    console.log('✓ Created class statistics');

    const studentsRef = db.ref('students');
    const studentsSnapshot = await studentsRef.once('value');
    const students = studentsSnapshot.val() || {};
    
    if (Object.keys(students).length > 0) {
      const firstStudentId = Object.keys(students)[0];
      console.log(`\nAdding progress for student: ${firstStudentId}`);
      
      const studentProgress = {
        [`students/${firstStudentId}/lessonProgress`]: {
          1: {
            status: 'completed',
            quizScore: 92
          },
          2: {
            status: 'completed',
            quizScore: 88
          },
          3: {
            status: 'in_progress',
            quizScore: 75
          },
          4: {
            status: 'not_started',
            quizScore: null
          },
          5: {
            status: 'not_started',
            quizScore: null
          },
          6: {
            status: 'not_started',
            quizScore: null
          }
        }
      };
      
      for (const [path, data] of Object.entries(studentProgress)) {
        await db.ref(path).set(data);
      }
      console.log('✓ Added student progress data');
      
      const certificates = [
        {
          id: 'cert-001',
          title: 'Patient Care Fundamentals Certificate',
          date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          description: 'Completed Introduction to Patient Care module'
        },
        {
          id: 'cert-002',
          title: 'Vital Signs Mastery Certificate',
          date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          description: 'Completed Vital Signs Monitoring module'
        }
      ];
      
      await db.ref(`students/${firstStudentId}/certificates`).set(certificates);
      console.log('✓ Added test certificates');
    } else {
      console.log('\n⚠ No students found in database. Student progress will be empty until a student logs in.');
    }

    console.log('\n✅ Test data populated successfully!');
    console.log('You can now view the lessons on the student dashboard.');
    
    process.exit(0);
  } catch (error) {
    console.error('Error populating test data:', error);
    process.exit(1);
  }
}

populateTestData();