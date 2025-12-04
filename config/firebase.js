// config/firebase.js
const admin = require('firebase-admin');
require('dotenv').config();

// Basic sanity check for required envs
if (
  !process.env.FIREBASE_PROJECT_ID ||
  !process.env.FIREBASE_CLIENT_EMAIL ||
  !process.env.FIREBASE_PRIVATE_KEY ||
  !process.env.FIREBASE_DATABASE_URL
) {
  console.warn('⚠️  Firebase env vars missing. Some features may not work.');
  console.warn(
    'Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL'
  );
}

if (!process.env.FIREBASE_STORAGE_BUCKET) {
  console.warn(
    '⚠️  FIREBASE_STORAGE_BUCKET is not set. Storage uploads will fail until this is configured.'
  );
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    // 👇 tell Admin SDK what the default bucket is
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
  console.log('✅ Firebase Admin initialized');
}

// Realtime DB + Auth
const db = admin.database();
const auth = admin.auth();

// 👇 uses the default bucket from initializeApp()
const bucket = admin.storage().bucket();

console.log('✅ Firebase Storage bucket:', bucket.name);

module.exports = { admin, auth, db, bucket };
