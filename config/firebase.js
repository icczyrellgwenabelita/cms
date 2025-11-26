const admin = require('firebase-admin');
require('dotenv').config();

let app;
let auth = null;
let db = null;

try {
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_DATABASE_URL) {
    console.warn('⚠️  Firebase environment variables are missing. Some features may not work.');
    console.warn('Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL');
  } else {
    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined,
    });
    console.log('✅ Firebase Admin initialized successfully');
    auth = admin.auth();
    db = admin.database();
  }
} catch (error) {
  console.error('❌ Firebase initialization error:', error.message);
  console.error('Stack:', error.stack);
}

let bucket = null;
const storageBucketName = process.env.FIREBASE_STORAGE_BUCKET;
if (!storageBucketName) {
  console.warn('FIREBASE_STORAGE_BUCKET is not set. 3D uploads will be disabled until a bucket is configured.');
} else {
  try {
    bucket = admin.storage().bucket(storageBucketName);
  } catch (error) {
    console.error('Failed to initialize Firebase Storage bucket:', error?.message || error);
    bucket = null;
  }
}

module.exports = { admin, auth, db, bucket, storageBucketName };

