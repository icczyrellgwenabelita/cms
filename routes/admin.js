const express = require('express');
const router = express.Router();
const { verifyAdminToken } = require('../middleware/auth');
const { db, auth, bucket } = require('../config/firebase');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logActivity } = require('../utils/activityLogger');
const { sendEmail, isEmailConfigured } = require('../utils/email');
const multer = require('multer');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const ONLINE_THRESHOLD_MINUTES = 10;
let backupInProgress = false;
let restoreInProgress = false;
const USERS_COLLECTION = 'users';
const LEGACY_USERS_COLLECTION = 'system/users';

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

ensureBackupDir();

const usersRef = () => db.ref(USERS_COLLECTION);
const legacyUsersRef = () => db.ref(LEGACY_USERS_COLLECTION);
const adminsRef = () => db.ref('admins');
const userRef = (uid) => db.ref(`${USERS_COLLECTION}/${uid}`);

function normalizeStudentInfo(info = {}) {
  return {
    studentNumber: info.studentNumber || '',
    batch: info.batch || '',
    contactNumber: info.contactNumber || '',
    birthday: info.birthday || '',
    address: info.address || ''
  };
}

function generateTemporaryPassword(length = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const bytes = crypto.randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += chars[bytes[i] % chars.length];
  }
  // Ensure password complexity
  if (!/[A-Z]/.test(password)) password += 'A';
  if (!/[a-z]/.test(password)) password += 'a';
  if (!/[0-9]/.test(password)) password += '1';
  if (!/[!@#$%^&*]/.test(password)) password += '!';
  return password;
}

function getPasswordSetupUrl() {
  const base = process.env.PUBLIC_HOST || 'https://asat-caresim.online';
  return `${base.replace(/\/$/, '')}/create-password`;
}

function sanitizeUserRecord(uid, data = {}) {
  const role = data.role || 'public';
  return {
    uid,
    name: data.name || data.fullName || '',
    fullName: data.fullName || data.name || '',
    email: data.email || '',
    role,
    verified: data.verified ?? false,
    active: data.active !== undefined ? data.active : true,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    lastLogin: data.lastLogin || null,
    lastActiveAt: data.lastActiveAt || null,
    loginCount: data.loginCount || 0,
    assignedInstructor: data.assignedInstructor || null,
    studentInfo: role === 'student' ? normalizeStudentInfo(data.studentInfo) : data.studentInfo || null,
    progress: data.progress || {},
    contactNumber: data.contactNumber || data.studentInfo?.contactNumber || '',
    address: data.address || data.studentInfo?.address || '',
    birthday: data.birthday || data.studentInfo?.birthday || '',
    archived: !!data.archived,
    inviteStatus: data.inviteStatus || null,
    inviteCreatedAt: data.inviteCreatedAt || null,
    inviteExpiresAt: data.inviteExpiresAt || null,
    department: data.department || data.instructorInfo?.department || ''
  };
}

async function persistAdminDirectoryRecord(uid, role, payload = {}) {
  if (role !== 'admin' && role !== 'instructor') {
    return;
  }
  const adminPayload = {
    name: payload.name || '',
    email: payload.email || '',
    role,
    createdAt: payload.createdAt || new Date().toISOString(),
    department: payload.department || '',
    idNumber: payload.idNumber || '',
    passwordHash: payload.passwordHash || ''
  };
  await db.ref(`admins/${uid}`).set(adminPayload);
}

async function createLmsUser({ name, email, password, role, studentInfo = {}, metadata = {}, actor = {} }) {
  const normalizedRole = role || 'public';
  const allowedRoles = ['student', 'instructor', 'admin', 'public'];
  if (!allowedRoles.includes(normalizedRole)) {
    throw new Error('Invalid role specified');
  }
  const now = new Date().toISOString();
  const userRecord = await auth.createUser({
    email,
    password,
    displayName: name
  });
  const uid = userRecord.uid;
  const baseData = {
        uid,
        name,
    fullName: name,
        email,
    role: normalizedRole,
    verified: normalizedRole !== 'public',
    active: true,
    createdAt: now,
    updatedAt: now,
    lastLogin: null,
    lastActiveAt: null,
    loginCount: 0,
    assignedInstructor: null,
    studentInfo: normalizedRole === 'student' ? normalizeStudentInfo(studentInfo) : null,
    progress: {}
  };
  await userRef(uid).set(baseData);

  if (normalizedRole === 'admin' || normalizedRole === 'instructor') {
    const passwordHash = await bcrypt.hash(password, 10);
    await persistAdminDirectoryRecord(uid, normalizedRole, {
      name,
      email,
      createdAt: now,
      department: metadata.department || '',
      idNumber: metadata.idNumber || '',
      passwordHash
    });
  }

  await logActivity({
    type: 'auth',
    action: `${normalizedRole}_created`,
    description: `Admin created new ${normalizedRole}`,
    actorType: 'admin',
    actorId: actor.adminId || null,
    actorName: actor.email || 'Admin',
    metadata: { uid, email }
  });

  return baseData;
}

function getLessonPageCounts(lmsLessons = {}) {
  const counts = {};
  Object.entries(lmsLessons).forEach(([slot, lesson]) => {
    const pages = lesson?.pages || {};
    counts[slot] = Object.keys(pages).length;
  });
  return counts;
}

function countAssessments(lmsLessons = {}) {
  let total = 0;
  Object.values(lmsLessons).forEach(lesson => {
    const pages = lesson?.pages || {};
    Object.values(pages).forEach(page => {
      const assessments = page?.assessments || {};
      total += Object.keys(assessments).length;
    });
  });
  return total;
}

function computeCompletionMetrics(usersData = {}, lessonPageCounts = {}) {
  const lessonSlots = Object.entries(lessonPageCounts).filter(([, count]) => count > 0);
  if (lessonSlots.length === 0) {
    return { avgCompletion: 0, lessonsCompleted: 0 };
  }
  let completionSum = 0;
  let userCount = 0;
  let lessonsCompleted = 0;
  Object.values(usersData).forEach(user => {
    const progress = user.lmsProgress || {};
    let completedPages = 0;
    let totalPages = 0;
    lessonSlots.forEach(([slot, pageCount]) => {
      const progressKey = `lesson${slot}`;
      const completed = progress[progressKey]?.completedPages || {};
      const completedCount = Object.values(completed).filter(Boolean).length;
      completedPages += completedCount;
      totalPages += pageCount;
      if (pageCount > 0 && completedCount >= pageCount) {
        lessonsCompleted += 1;
      }
    });
    if (totalPages > 0) {
      completionSum += (completedPages / totalPages) * 100;
      userCount += 1;
    }
  });
      return {
    avgCompletion: userCount > 0 ? completionSum / userCount : 0,
    lessonsCompleted
  };
}

function computeQuizMetrics(usersData = {}) {
  let totalScore = 0;
  let totalAttempts = 0;
  Object.values(usersData).forEach(user => {
    const quizzes = user.history?.quizzes || {};
    Object.values(quizzes).forEach(quiz => {
      if (quiz && typeof quiz.score === 'number') {
        totalScore += quiz.score;
        totalAttempts += 1;
      }
    });
  });
  return {
    avgQuizScore: totalAttempts > 0 ? totalScore / totalAttempts : 0,
    totalQuizAttempts: totalAttempts
  };
}

function countNewUsersThisWeek(usersData = {}) {
  const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  return Object.values(usersData).reduce((count, user = {}) => {
    const createdAt = user.createdAt ? new Date(user.createdAt).getTime() : 0;
    if (createdAt && createdAt >= oneWeekAgo) {
      return count + 1;
    }
    return count;
  }, 0);
}

async function getBackupInventory() {
  ensureBackupDir();
  const files = await fs.promises.readdir(BACKUP_DIR);
  const entries = await Promise.all(files
    .filter(file => file.endsWith('.json'))
    .map(async file => {
      const filePath = path.join(BACKUP_DIR, file);
      const stats = await fs.promises.stat(filePath);
      return {
        id: file,
        name: file.replace('.json', '').replace(/-/g, ' '),
        fileName: file,
        createdAt: stats.birthtime.toISOString(),
        size: stats.size
      };
    }));
  return entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getAllUsersData() {
  const [primarySnap, legacySnap, adminsSnap] = await Promise.all([
    usersRef().once('value').catch(() => null),
    legacyUsersRef().once('value').catch(() => null),
    adminsRef().once('value').catch(() => null)
  ]);
  const primary = (primarySnap && primarySnap.val()) || {};
  const legacy = (legacySnap && legacySnap.val()) || {};
  const admins = (adminsSnap && adminsSnap.val()) || {};
  
  // Merge so that admins overrides canonical /users, which overrides legacy /system/users
  return { ...legacy, ...primary, ...admins };
}

router.get('/users/invite-status', verifyAdminToken, async (req, res) => {
  try {
    const { email } = req.query || {};
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }
    const usersData = await getAllUsersData();
    const entry = Object.values(usersData).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
    if (!entry) {
      return res.status(404).json({ error: 'Invite not found' });
    }
    res.json({
      success: true,
      inviteStatus: entry.inviteStatus || null,
      inviteCreatedAt: entry.inviteCreatedAt || null,
      inviteExpiresAt: entry.inviteExpiresAt || null
    });
  } catch (error) {
    console.error('Invite status error:', error);
    res.status(500).json({ error: 'Failed to fetch invite status' });
  }
});

router.post('/users/complete-invite', verifyAdminToken, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }
    const usersData = await getAllUsersData();
    const pair = Object.entries(usersData).find(([, u]) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (!pair) {
      return res.status(404).json({ error: 'User not found' });
    }
    const [uid, data] = pair;
    const updates = {
        verified: true,
        active: true,
      inviteStatus: 'completed',
      updatedAt: new Date().toISOString()
    };
    await userRef(uid).update(updates);
    await auth.updateUser(uid, { emailVerified: true });
    res.json({ success: true });
  } catch (error) {
    console.error('Complete invite error:', error);
    res.status(500).json({ error: 'Failed to complete invite' });
  }
});

router.post('/users/:uid/resend-invite', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const snapshot = await userRef(uid).once('value');
    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }
    const data = snapshot.val() || {};
    if (!data.email) {
      return res.status(400).json({ error: 'User email missing' });
    }
    if (data.archived) {
      return res.status(400).json({ error: 'Cannot resend invite to an archived student' });
    }
    const now = new Date();
    const inviteCreatedAt = now.toISOString();
    const inviteExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const updates = {
      inviteStatus: 'pending',
      inviteCreatedAt,
      inviteExpiresAt,
      updatedAt: inviteCreatedAt
    };
    await userRef(uid).update(updates);
    res.json({ success: true });

    (async () => {
      try {
        const linkStart = Date.now();
        const firebaseLink = await auth.generatePasswordResetLink(data.email, {
          url: getPasswordSetupUrl(),
          handleCodeInApp: true
        });
        
        const urlObj = new URL(firebaseLink);
        const oobCode = urlObj.searchParams.get('oobCode');
        const mode = urlObj.searchParams.get('mode') || 'resetPassword';
        const customLink = `${getPasswordSetupUrl()}?mode=${encodeURIComponent(mode)}&oobCode=${encodeURIComponent(oobCode)}`;

        console.log(`[ResendInvite] Link generated in ${Date.now() - linkStart}ms for ${data.email}`);
        const name = data.name || data.fullName || data.email;

        const emailStart = Date.now();
        const emailResult = await sendEmail({
          to: data.email,
          subject: 'CareSim - Invitation reminder',
          html: `
            <p>Hello ${name},</p>
            <p>This is a friendly reminder to complete your CareSim student account setup. Use the link below to set your password:</p>
            <p><a href="${customLink}" style="color:#2563EB;">Set your password</a></p>
            <p>This link will expire in 24 hours.</p>
          `,
          text: `Hello ${name},\n\nUse the link below to complete your CareSim student account setup (expires in 24 hours):\n\n${customLink}`
        });
        console.log(`[ResendInvite] Email send result for ${data.email}: ${emailResult.success ? 'success' : emailResult.error || 'failed'} in ${Date.now() - emailStart}ms`);
      } catch (err) {
        console.error('[ResendInvite] Post-response email error:', err);
      }
    })();

    await logActivity({
      type: 'auth',
      action: 'student_invite_resent',
      description: 'Student invite resent',
      actorType: 'admin',
      actorId: req.admin?.adminId || null,
      actorName: req.admin?.email || 'Admin',
      metadata: { uid: uid, email: data.email }
    });
  } catch (error) {
    console.error('Resend invite error:', error);
    res.status(500).json({ error: 'Failed to resend invite' });
  }
});

router.post('/users/archive-batch', verifyAdminToken, async (req, res) => {
  try {
    const { uids } = req.body || {};
    if (!Array.isArray(uids) || uids.length === 0) {
      return res.status(400).json({ error: 'No users selected' });
    }

    const updatedAt = new Date().toISOString();
    let archivedCount = 0;

    for (const uid of uids) {
      const snapshot = await userRef(uid).once('value');
      if (snapshot.exists()) {
        const user = snapshot.val();
        // Only archive students
        if (user.role === 'student') {
          await userRef(uid).update({
            archived: true,
            active: false,
            updatedAt
          });
          archivedCount++;

          await logActivity({
            type: 'user',
            action: 'student_archived',
            description: 'Student archived (batch)',
            actorType: 'admin',
            actorId: req.admin?.adminId || null,
            actorName: req.admin?.email || 'Admin',
            metadata: { uid, email: user.email }
          });
        }
      }
    }

    res.json({ success: true, count: archivedCount });
  } catch (error) {
    console.error('Batch archive error:', error);
    res.status(500).json({ error: 'Failed to archive students' });
  }
});

router.post('/users/assign-instructor-batch', verifyAdminToken, async (req, res) => {
  try {
    const { uids, instructorId } = req.body || {};
    if (!Array.isArray(uids) || uids.length === 0) {
      return res.status(400).json({ error: 'No users selected' });
    }

    // If instructorId is provided, validate it exists and is an instructor/admin
    if (instructorId) {
      const instructorRef = db.ref(`admins/${instructorId}`);
      const instructorSnapshot = await instructorRef.once('value');
      if (!instructorSnapshot.exists()) {
        return res.status(400).json({ error: 'Instructor not found' });
      }
      const instructorData = instructorSnapshot.val();
      if (!instructorData.role || (instructorData.role !== 'instructor' && instructorData.role !== 'admin')) {
        return res.status(400).json({ error: 'Invalid instructor' });
      }
    }

    let updatedCount = 0;
    for (const uid of uids) {
      const snapshot = await userRef(uid).once('value');
      if (snapshot.exists()) {
        const user = snapshot.val();
        if (user.role === 'student') {
          const oldInstructorId = user.assignedInstructor;
          
          // Remove from old instructor if different
          if (oldInstructorId && oldInstructorId !== instructorId) {
            await db.ref(`admins/${oldInstructorId}/assignedStudents/${uid}`).remove();
          }

          if (instructorId) {
            await userRef(uid).update({ assignedInstructor: instructorId });
            await db.ref(`admins/${instructorId}/assignedStudents/${uid}`).set(true);
          } else {
            // Unassign
            await userRef(uid).update({ assignedInstructor: null });
          }
          
          updatedCount++;
        }
      }
    }

    res.json({ success: true, count: updatedCount });
  } catch (error) {
    console.error('Batch assign instructor error:', error);
    res.status(500).json({ error: 'Failed to assign instructor to students' });
  }
});

router.post('/users/:uid/archive', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const snapshot = await userRef(uid).once('value');
    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }
    const data = snapshot.val() || {};
    if ((data.role || '').toLowerCase() !== 'student') {
      return res.status(400).json({ error: 'Only students can be archived' });
    }
    if (data.archived) {
      return res.status(400).json({ error: 'Student is already archived' });
    }
    const updatedAt = new Date().toISOString();
    const updates = {
      archived: true,
      active: false,
      updatedAt
    };
    await userRef(uid).update(updates);

    await logActivity({
      type: 'user',
      action: 'student_archived',
      description: 'Student archived',
      actorType: 'admin',
      actorId: req.admin?.adminId || null,
      actorName: req.admin?.email || 'Admin',
      metadata: { uid, email: data.email }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Archive student error:', error);
    res.status(500).json({ error: 'Failed to archive student' });
  }
});

router.post('/users/:uid/restore', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const snapshot = await userRef(uid).once('value');
    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }
    const data = snapshot.val() || {};
    if ((data.role || '').toLowerCase() !== 'student') {
      return res.status(400).json({ error: 'Only students can be restored' });
    }
    if (!data.archived) {
      return res.status(400).json({ error: 'Student is not archived' });
    }
    const updatedAt = new Date().toISOString();
    const updates = {
      archived: false,
      updatedAt
    };
    await userRef(uid).update(updates);

    await logActivity({
      type: 'user',
      action: 'student_restored',
      description: 'Student restored from archive',
      actorType: 'admin',
      actorId: req.admin?.adminId || null,
      actorName: req.admin?.email || 'Admin',
      metadata: { uid, email: data.email }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Restore student error:', error);
    res.status(500).json({ error: 'Failed to restore student' });
  }
});

function isUserOnline(user = {}) {
  const lastActive = user.lastActiveAt || user.updatedAt || user.createdAt;
  if (!lastActive) return false;
  const lastActiveMs = new Date(lastActive).getTime();
  if (Number.isNaN(lastActiveMs)) return false;
  return Date.now() - lastActiveMs <= ONLINE_THRESHOLD_MINUTES * 60 * 1000;
}

/**
 * Admin Dashboard & Management Routes
 */

router.get('/dashboard/summary', verifyAdminToken, async (req, res) => {
  try {
    const [usersData, lessonsSnapshot, lmsLessonsSnapshot] = await Promise.all([
      getAllUsersData(),
      db.ref('lessons').once('value'),
      db.ref('lmsLessons').once('value')
    ]);
    const lessonsData = lessonsSnapshot.val() || {};
    const lmsLessons = lmsLessonsSnapshot.val() || {};
    const lessonPageCounts = getLessonPageCounts(lmsLessons);
    const totalUsers = Object.keys(usersData).length;
    const totalLmsLessons = Object.keys(lmsLessons).length;
    const totalAssessments = countAssessments(lmsLessons);
    const totalUnityLessons = Object.keys(lessonsData)
      .filter(key => !Number.isNaN(parseInt(key, 10))).length;
    const totalQuizzes = Object.values(lessonsData).reduce((sum, lesson = {}) => {
      const questions = lesson.questions || {};
      return sum + Object.keys(questions).length;
    }, 0);
    const activeUsers = Object.values(usersData).filter(isUserOnline).length;
    const { avgCompletion, lessonsCompleted } = computeCompletionMetrics(usersData, lessonPageCounts);
    const { avgQuizScore, totalQuizAttempts } = computeQuizMetrics(usersData);
    const totalLogins = Object.values(usersData).reduce((sum, user) => sum + (user.loginCount || 0), 0);
    const newUsersWeek = countNewUsersThisWeek(usersData);
    const activePercent = totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0;
    const stats = {
      totalUsers,
      totalLessons: totalLmsLessons,
      totalAssessments,
      totalQuizzes,
      activeUsers,
      avgCompletion: Math.round(avgCompletion || 0),
      avgQuizScore: Number((avgQuizScore || 0).toFixed(1)),
      totalQuizAttempts,
      totalLogins,
      lessonsCompleted,
      activeSessions: activeUsers,
      newUsersWeek,
      activePercent
    };
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ error: 'Failed to load dashboard summary' });
  }
});

router.get('/dashboard/activity', verifyAdminToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 8;
    const snapshot = await db.ref('activityLog')
      .orderByChild('timestamp')
      .limitToLast(limit)
      .once('value');
    const activities = [];
    snapshot.forEach(child => {
      activities.push({
        id: child.key,
        ...child.val()
      });
    });
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json({ success: true, activities });
  } catch (error) {
    console.error('Dashboard activity error:', error);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

router.get('/dashboard/recent-users', verifyAdminToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const usersData = await getAllUsersData();
    const now = Date.now();
    const windowMs = ONLINE_THRESHOLD_MINUTES * 60 * 1000;

    const normalizeUser = (uid, user = {}) => {
      const lastActiveAt = user.lastActiveAt || user.updatedAt || user.createdAt || null;
      const lastActiveMs = lastActiveAt ? new Date(lastActiveAt).getTime() : 0;
      const online = lastActiveMs && (now - lastActiveMs) <= windowMs;
      return {
        uid,
        name: user.name || user.fullName || 'Unnamed',
        email: user.email || 'N/A',
        role: user.role || 'public',
        inviteStatus: user.inviteStatus || null,
        inviteExpiresAt: user.inviteExpiresAt || null,
        lastActiveAt,
        createdAt: user.createdAt || null,
        status: online ? 'online' : 'offline'
      };
    };

    const combined = Object.entries(usersData).map(([uid, data]) => normalizeUser(uid, data));

    combined.sort((a, b) => {
      const dateA = new Date(a.lastActiveAt || a.createdAt || 0).getTime();
      const dateB = new Date(b.lastActiveAt || b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    res.json({ success: true, users: combined.slice(0, limit) });
  } catch (error) {
    console.error('Dashboard recent users error:', error);
    res.status(500).json({ error: 'Failed to load recent users' });
  }
});

router.get('/health', verifyAdminToken, async (req, res) => {
  const status = {
    database: { status: 'ok', message: 'Connected' },
    api: { status: 'ok', message: 'Running' },
    storage: { status: 'ok', message: 'Available' },
    backup: {
      inProgress: backupInProgress,
      restoreInProgress,
      lastBackupAt: null,
      lastBackupBy: null,
      lastBackupFile: null,
      lastRestoreAt: null,
      lastRestoreBy: null,
      lastRestoreFile: null
    }
  };
  try {
    await db.ref('.info/connected').once('value');
  } catch (error) {
    status.database = { status: 'error', message: 'Unavailable' };
  }
  try {
    ensureBackupDir();
    fs.accessSync(BACKUP_DIR, fs.constants.W_OK);
  } catch (error) {
    status.storage = { status: 'error', message: 'Storage not writable' };
  }
  try {
    const backupSnapshot = await db.ref('system/backup').once('value');
    const backupData = backupSnapshot.val() || {};
    status.backup.lastBackupAt = backupData.lastBackupAt || null;
    status.backup.lastBackupBy = backupData.lastBackupBy || null;
    status.backup.lastBackupFile = backupData.lastBackupFile || null;
    status.backup.lastRestoreAt = backupData.lastRestoreAt || null;
    status.backup.lastRestoreBy = backupData.lastRestoreBy || null;
    status.backup.lastRestoreFile = backupData.lastRestoreFile || null;
  } catch (error) {
    console.error('Health backup metadata error:', error);
  }
  const overallOnline = status.database.status === 'ok' && status.storage.status === 'ok' && status.api.status === 'ok';
  status.overall = overallOnline ? 'online' : 'degraded';
  res.json({ success: true, status });
});

router.post('/backup', verifyAdminToken, async (req, res) => {
  if (backupInProgress) {
    return res.status(429).json({ error: 'Backup already in progress' });
  }
  backupInProgress = true;
  try {
    ensureBackupDir();
    const timestamp = new Date().toISOString();
    const [usersData, lessonsSnapshot, lmsSnapshot, activitySnapshot] = await Promise.all([
      getAllUsersData(),
      db.ref('lessons').once('value'),
      db.ref('lmsLessons').once('value'),
      db.ref('activityLog').once('value')
    ]);
    const payload = {
      timestamp,
      triggeredBy: req.admin?.email || 'Admin',
      data: {
        users: usersData || {},
        lessons: lessonsSnapshot.val() || {},
        lmsLessons: lmsSnapshot.val() || {},
        activityLog: activitySnapshot.val() || {}
      }
    };
    const safeTimestamp = timestamp.replace(/[:.]/g, '-');
    const fileName = `backup-${safeTimestamp}.json`;
    const filePath = path.join(BACKUP_DIR, fileName);
    await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    await db.ref('system/backup').set({
      lastBackupAt: timestamp,
      lastBackupBy: req.admin?.email || 'Admin',
      lastBackupFile: fileName
    });
    await logActivity({
      type: 'system',
      action: 'backup_completed',
      description: 'Manual backup completed',
      actorType: 'admin',
      actorId: req.admin?.adminId || null,
      actorName: req.admin?.email || 'Admin',
      metadata: { fileName },
      timestamp
    });
    res.json({ success: true, lastBackupAt: timestamp });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ error: 'Backup failed', details: error.message });
  } finally {
    backupInProgress = false;
  }
});

router.get('/dashboard/backups', verifyAdminToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const backups = await getBackupInventory();
    res.json({ success: true, backups: backups.slice(0, limit) });
  } catch (error) {
    console.error('List backups error:', error);
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

router.post('/backup/restore', verifyAdminToken, async (req, res) => {
  if (restoreInProgress) {
    return res.status(429).json({ error: 'Restore already in progress' });
  }
  const { fileName } = req.body || {};
  if (!fileName) {
    return res.status(400).json({ error: 'fileName is required' });
  }
  const filePath = path.join(BACKUP_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Backup not found' });
  }
  restoreInProgress = true;
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const payload = JSON.parse(raw);
    const backupData = payload.data || {};
    await Promise.all([
      usersRef().set(backupData.users || {}),
      db.ref('lessons').set(backupData.lessons || {}),
      db.ref('lmsLessons').set(backupData.lmsLessons || {}),
      db.ref('activityLog').set(backupData.activityLog || {})
    ]);
    const restoreMeta = {
      lastRestoreAt: new Date().toISOString(),
      lastRestoreBy: req.admin?.email || 'Admin',
      lastRestoreFile: fileName
    };
    await db.ref('system/backup').update(restoreMeta);
    await logActivity({
      type: 'system',
      action: 'backup_restored',
      description: `Backup ${fileName} restored`,
      actorType: 'admin',
      actorId: req.admin?.adminId || null,
      actorName: req.admin?.email || 'Admin',
      metadata: { fileName }
    });
    res.json({ success: true, restore: restoreMeta });
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ error: 'Restore failed', details: error.message });
  } finally {
    restoreInProgress = false;
  }
});

router.get('/users', verifyAdminToken, async (req, res) => {
  try {
    const usersData = await getAllUsersData();
    const users = Object.entries(usersData).map(([uid, data = {}]) => sanitizeUserRecord(uid, data));
    res.json({ success: true, users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/create-user', verifyAdminToken, async (req, res) => {
  try {
    const { name, email, password, role, studentInfo = {}, metadata = {} } = req.body || {};
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'name, email, password, and role are required' });
    }
    const userData = await createLmsUser({
      name,
      email,
      password,
      role,
      studentInfo,
      metadata,
      actor: req.admin || {}
    });
    res.json({ success: true, user: userData });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user', details: error.message });
  }
});

router.post('/users/invite-student', verifyAdminToken, async (req, res) => {
  try {
    const { name, email, studentInfo = {} } = req.body || {};
    if (!name || !email) {
      return res.status(400).json({ error: 'name and email are required' });
    }

    const normalizedStudentInfo = normalizeStudentInfo(studentInfo);
    if (!normalizedStudentInfo.studentNumber || !normalizedStudentInfo.batch) {
      return res.status(400).json({ error: 'studentNumber and batch are required' });
    }

    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        userRecord = await auth.createUser({
          email,
          password: generateTemporaryPassword(20),
          displayName: name,
          emailVerified: false
        });
      } else {
        throw err;
      }
    }

    const uid = userRecord.uid;
    const snapshot = await userRef(uid).once('value').catch(() => null);
    const existingUser = (snapshot && snapshot.val()) || {};

    if (existingUser.archived) {
      return res.status(400).json({ error: 'User is archived. Restore the student before sending a new invite.' });
    }

    if (existingUser.verified && existingUser.inviteStatus === 'completed') {
      return res.status(400).json({ error: 'User is already an active student' });
    }

    const now = new Date();
    const inviteCreatedAt = now.toISOString();
    const inviteExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    const mergedStudentInfo = {
      ...normalizeStudentInfo(existingUser.studentInfo || {}),
      ...normalizedStudentInfo
    };

    const resolvedName = name || existingUser.name || existingUser.fullName || '';

    const userPayload = {
      ...existingUser,
      uid,
      name: resolvedName,
      fullName: resolvedName,
      email,
      role: 'student',
      verified: false,
      active: false,
      archived: false,
      inviteStatus: 'pending',
      inviteCreatedAt,
      inviteExpiresAt,
      studentInfo: mergedStudentInfo,
      updatedAt: inviteCreatedAt,
      createdAt: existingUser.createdAt || userRecord.metadata?.creationTime || inviteCreatedAt
    };

    await userRef(uid).set(userPayload);

    res.json({ success: true, uid });

    (async () => {
      try {
        const linkStart = Date.now();
        const firebaseLink = await auth.generatePasswordResetLink(email, {
          url: getPasswordSetupUrl(),
          handleCodeInApp: true
        });
        
        const urlObj = new URL(firebaseLink);
        const oobCode = urlObj.searchParams.get('oobCode');
        const mode = urlObj.searchParams.get('mode') || 'resetPassword';
        const customLink = `${getPasswordSetupUrl()}?mode=${encodeURIComponent(mode)}&oobCode=${encodeURIComponent(oobCode)}`;

        console.log(`[InviteStudent] Link generated in ${Date.now() - linkStart}ms for ${email}`);

        const emailStart = Date.now();
        const emailResult = await sendEmail({
          to: email,
          subject: 'CareSim - Set up your student account',
          html: `
            <p>Hello ${resolvedName || email},</p>
            <p>You have been invited as a student on CareSim. Click the link below to set your password:</p>
            <p><a href="${customLink}" style="color:#2563EB;">Set your password</a></p>
            <p>This link will expire in 24 hours.</p>
          `,
          text: `Hello ${resolvedName || email},\n\nYou have been invited as a student on CareSim. Use the link below to set your password (expires in 24 hours):\n\n${customLink}`
        });
        console.log(`[InviteStudent] Email send result for ${email}: ${emailResult.success ? 'success' : emailResult.error || 'failed'} in ${Date.now() - emailStart}ms`);
      } catch (err) {
        console.error('[InviteStudent] Post-response email error:', err);
      }
    })();

    await logActivity({
      type: 'auth',
      action: 'student_invited',
      description: 'Student invited to set password',
      actorType: 'admin',
      actorId: req.admin?.adminId || null,
      actorName: req.admin?.email || 'Admin',
      metadata: { uid, email }
    });
  } catch (error) {
    console.error('Invite student error:', error);
    res.status(500).json({ error: 'Failed to invite student', details: error.message });
  }
});

router.post('/users/:uid/convert-to-student', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const {
      name,
      studentNumber,
      batch,
      school = '',
      birthday = '',
      address = '',
      contactNumber = ''
    } = req.body || {};

    if (!studentNumber || !batch) {
      return res.status(400).json({ error: 'studentNumber and batch are required' });
    }

    const ref = userRef(uid);
    const snapshot = await ref.once('value');
    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingUser = snapshot.val() || {};

    if ((existingUser.role || 'public') !== 'public') {
      return res.status(400).json({ error: 'User is not a public user' });
    }

    const updatedData = {
      ...existingUser,
      role: 'student',
      verified: true,
      active: true,
      studentInfo: {
        studentNumber,
        batch,
        school,
        birthday,
        address,
        contactNumber
      }
    };

    if (name !== undefined) {
      updatedData.name = name;
    }

    await ref.set(updatedData);
    await logActivity({
      type: 'auth',
      action: 'user_converted_student',
      description: 'Public user converted to student',
      actorType: 'admin',
      actorId: req.admin?.adminId || null,
      actorName: req.admin?.email || 'Admin',
      metadata: { uid }
    });

    const updatedSnapshot = await ref.once('value');
    const updatedUser = updatedSnapshot.val();

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Convert to student error:', error);
    res.status(500).json({ error: 'Failed to convert user to student' });
  }
});

router.put('/users/:uid/assign-instructor', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const { instructorId } = req.body || {};

    const studentSnapshot = await userRef(uid).once('value');

    if (!studentSnapshot.exists()) {
      return res.status(400).json({ error: 'Student not found' });
    }

    const studentData = studentSnapshot.val() || {};
    if ((studentData.role || 'public') === 'public') {
      return res.status(400).json({ error: 'Student not found' });
    }

    // Handle removal of instructor assignment
    if (!instructorId || instructorId === '') {
      const oldInstructorId = studentData.assignedInstructor;
      if (oldInstructorId) {
        // Remove from old instructor's assignedStudents
        const oldInstructorRef = db.ref(`admins/${oldInstructorId}/assignedStudents/${uid}`);
        await oldInstructorRef.remove();
      }
      await userRef(uid).update({ assignedInstructor: null });
      return res.json({ success: true, studentId: uid, instructorId: null, message: 'Instructor assignment removed' });
    }

    // Validate instructor exists
    const instructorRef = db.ref(`admins/${instructorId}`);
    const instructorSnapshot = await instructorRef.once('value');

    if (!instructorSnapshot.exists()) {
      return res.status(400).json({ error: 'Instructor not found' });
    }

    const instructorData = instructorSnapshot.val() || {};
    if (!instructorData.role || (instructorData.role !== 'instructor' && instructorData.role !== 'admin')) {
      return res.status(400).json({ error: 'Instructor not found' });
    }

    // Remove from old instructor if student was previously assigned
    const oldInstructorId = studentData.assignedInstructor;
    if (oldInstructorId && oldInstructorId !== instructorId) {
      const oldInstructorRef = db.ref(`admins/${oldInstructorId}/assignedStudents/${uid}`);
      await oldInstructorRef.remove();
    }

    // Assign to new instructor
    await userRef(uid).update({ assignedInstructor: instructorId });
    await instructorRef.child(`assignedStudents/${uid}`).set(true);

    res.json({ success: true, studentId: uid, instructorId });
  } catch (error) {
    console.error('Assign instructor error:', error);
    res.status(500).json({ error: 'Failed to assign instructor' });
  }
});

router.post('/users/create-instructor', verifyAdminToken, async (req, res) => {
  try {
    const {
      name,
      email,
      password
    } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required' });
    }

    const user = await createLmsUser({
      name,
      email,
      password,
      role: 'instructor',
      actor: req.admin || {}
    });

    res.json({ success: true, user });
  } catch (error) {
    console.error('Create instructor error:', error);
    res.status(500).json({ error: 'Failed to create instructor', details: error.message });
  }
});

router.post('/users/create-admin', verifyAdminToken, async (req, res) => {
  try {
    const {
      name,
      email,
      password
    } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required' });
    }

    const user = await createLmsUser({
      name,
      email,
      password,
      role: 'admin',
      actor: req.admin || {}
    });

    res.json({ success: true, user });
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ error: 'Failed to create admin', details: error.message });
  }
});

router.post('/users/approve-student', verifyAdminToken, async (req, res) => {
  try {
    const {
      uid,
      studentNumber,
      batch,
      school,
      birthday,
      address,
      contactNumber,
      assignedInstructor
    } = req.body || {};

    if (!uid || !studentNumber || !batch || !school || !birthday || !address || !assignedInstructor) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const ref = userRef(uid);
    const snapshot = await ref.once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingUser = snapshot.val() || {};

    if (existingUser.role && existingUser.role !== 'public') {
      return res.status(400).json({ error: 'User is not pending approval' });
    }

    const updatedData = {
      ...existingUser,
      role: 'student',
      verified: true,
      active: true,
      studentInfo: {
        studentNumber,
        batch,
        school,
        birthday,
        address,
        contactNumber
      },
      assignedInstructor
    };

    await ref.set(updatedData);

    res.json({
      success: true,
      message: 'Student approved',
      uid,
      studentInfo: updatedData.studentInfo
    });
  } catch (error) {
    console.error('Approve student error:', error);
    res.status(500).json({ error: 'Failed to approve student' });
  }
});

router.put('/users/:uid', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const {
      name,
      email,
      role,
      active,
      studentInfo,
      assignedInstructor,
      contactNumber,
      address,
      birthday
    } = req.body || {};

    const hasUpdates = Object.keys(req.body || {}).length > 0;

    if (!hasUpdates) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const ref = userRef(uid);
    const snapshot = await ref.once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingUser = snapshot.val() || {};
    const updatedData = { ...existingUser };

    if (name !== undefined) {
      updatedData.name = name;
    }

    if (email !== undefined) {
      updatedData.email = email;
    }

    if (role !== undefined) {
      updatedData.role = role;
    }

    if (active !== undefined) {
      updatedData.active = active;
    }

    if (studentInfo !== undefined) {
      updatedData.studentInfo = studentInfo;
    }

    if (assignedInstructor !== undefined) {
      updatedData.assignedInstructor = assignedInstructor;
    }
    
    if (contactNumber !== undefined) {
      updatedData.contactNumber = contactNumber;
    }

    if (address !== undefined) {
      updatedData.address = address;
    }

    if (birthday !== undefined) {
      updatedData.birthday = birthday;
    }

    await ref.set(updatedData);

    res.json({
      success: true,
      message: 'User updated',
      uid,
      user: updatedData
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.put('/users/:uid/status', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const { active } = req.body || {};

    if (typeof active !== 'boolean') {
      return res.status(400).json({ error: '"active" must be a boolean' });
    }

    const ref = userRef(uid);
    const snapshot = await ref.once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }

    await ref.update({ active });

    res.json({
      success: true,
      uid,
      active
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

/**
 * GET /api/admin/instructors
 * Returns list of all instructors for dropdown/selection
 */
router.get('/instructors', verifyAdminToken, async (req, res) => {
  try {
    const snapshot = await adminsRef().once('value');
    const users = (snapshot && snapshot.val()) || {};

    const instructors = Object.entries(users)
      .filter(([, data = {}]) => (data.role || '').toLowerCase() === 'instructor')
      .map(([uid, data = {}]) => ({
        id: uid,
        uid,
        name: data.name || data.fullName || '',
        email: data.email || '',
        role: 'instructor',
        department: data.department || data.instructorInfo?.department || '',
        loginCount: data.loginCount || 0,
        lastLogin: data.lastLogin || null,
        createdAt: data.createdAt || null
      }));
    
    res.json({ success: true, instructors });
  } catch (error) {
    console.error('Get instructors error:', error);
    res.status(500).json({ error: 'Failed to fetch instructors' });
  }
});

router.get('/statistics', verifyAdminToken, async (req, res) => {
  try {
    const usersData = await getAllUsersData();

    let totalUsers = 0;
    let totalPublic = 0;
    let totalStudents = 0;
    let totalInstructors = 0;
    let totalAdmins = 0;
    let activeUsers = 0;
    let totalQuizAttempts = 0;
    let totalSimulationAttempts = 0;

    for (const [, data = {}] of Object.entries(usersData)) {
      totalUsers += 1;
      const role = data.role || 'public';

      switch (role) {
        case 'student':
          totalStudents += 1;
          break;
        case 'instructor':
          totalInstructors += 1;
          break;
        case 'admin':
          totalAdmins += 1;
          break;
        default:
          totalPublic += 1;
      }

      if (data.active !== false) {
        activeUsers += 1;
      }

      const history = data.history || {};
      const quizzes = history.quizzes || {};
      const simulations = history.simulations || {};

      totalQuizAttempts += Object.keys(quizzes).length;
      totalSimulationAttempts += Object.keys(simulations).length;
    }

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalPublic,
        totalStudents,
        totalInstructors,
        totalAdmins,
        activeUsers,
        totalQuizAttempts,
        totalSimulationAttempts
      }
    });
  } catch (error) {
    console.error('Admin statistics error:', error);
    res.status(500).json({ error: 'Failed to fetch admin statistics' });
  }
});

router.get('/lessons', verifyAdminToken, async (req, res) => {
  try {
    const lessonsRef = db.ref('lessons');
    const lmsLessonsRef = db.ref('lmsLessons');
    const [lessonsSnapshot, lmsLessonsSnapshot] = await Promise.all([
      lessonsRef.once('value'),
      lmsLessonsRef.once('value')
    ]);
    const lessons = lessonsSnapshot.val() || {};
    const lmsLessons = lmsLessonsSnapshot.val() || {};
    
    // Only return lessons that actually exist in the database
    const lessonsArray = Object.entries(lessons)
      .filter(([key, lesson]) => {
        // Only include numeric keys (slot numbers) and ensure lesson has data
        const slot = parseInt(key);
        return !isNaN(slot) && lesson && (lesson.lessonTitle || lesson.lessonName);
      })
      .map(([key, lesson]) => {
        const slot = parseInt(key);
        const lmsLesson = lmsLessons[slot] || {};
        const pages = lmsLesson.pages || {};
        const pageIds = Object.keys(pages);
        const pageCount = pageIds.length;
        const assessmentCount = pageIds.reduce((total, pageId) => {
          const assessments = pages[pageId]?.assessments || {};
          return total + Object.keys(assessments).length;
        }, 0);
        const status = (lesson.status || 'draft').toLowerCase();
        const lastUpdated = lesson.updatedAt || lesson.createdAt || null;
        return {
          slot,
          lessonTitle: lesson.lessonTitle || lesson.lessonName || '',
          lessonName: lesson.lessonName || lesson.lessonTitle || '', // Keep for backward compatibility
          description: lesson.description || lesson.lessonDescription || '',
          lessonDescription: lesson.lessonDescription || lesson.description || '', // Keep for backward compatibility
          body: lesson.body || '',
          images: lesson.images || [],
          tools: lesson.tools || {},
          createdAt: lesson.createdAt,
          updatedAt: lesson.updatedAt,
          pageCount,
          assessmentCount,
          status,
          lastUpdated
        };
      })
      .sort((a, b) => a.slot - b.slot); // Sort by slot number
    
    res.json({ success: true, lessons: lessonsArray });
  } catch (error) {
    console.error('Get lessons error:', error);
    res.status(500).json({ error: 'Failed to fetch lessons' });
  }
});
/**
 * DELETE /api/admin/lessons/:slot
 * Deletes a lesson and all associated data
 */
router.delete('/lessons/:slot', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    if (slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    // Check if lesson exists
    const lessonRef = db.ref(`lessons/${slot}`);
    const lessonSnapshot = await lessonRef.once('value');
    const lessonData = lessonSnapshot.val();
    
    if (!lessonData) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    
    // Delete intro video from storage if it exists
    if (lessonData.introVideoStoragePath) {
      try {
        const file = bucket.file(lessonData.introVideoStoragePath);
        const [exists] = await file.exists();
        if (exists) {
          await file.delete();
          console.log(`Deleted intro video: ${lessonData.introVideoStoragePath}`);
        }
      } catch (videoError) {
        console.error('Error deleting intro video:', videoError);
        // Continue with lesson deletion even if video deletion fails
      }
    }
    
    // Delete lesson metadata
    await lessonRef.remove();
    
    // Delete LMS lesson pages and assessments
    const lmsLessonsRef = db.ref(`lmsLessons/${slot}`);
    await lmsLessonsRef.remove();
    
    // Delete game quiz questions (if they exist)
    const gameQuestionsRef = db.ref(`lessons/lesson${slot}/questions`);
    await gameQuestionsRef.remove();
    
    // Log the deletion
    await logActivity({
      type: 'lesson',
      action: 'lesson_deleted',
      description: `Lesson ${slot} (${lessonData.lessonTitle || lessonData.lessonName || 'Untitled'}) deleted`,
      actorType: 'admin',
      actorId: req.admin?.adminId || null,
      actorName: req.admin?.email || 'Admin',
      relatedLesson: slot
    });
    
    res.json({ 
      success: true, 
      message: 'Lesson deleted successfully',
      deletedSlot: slot
    });
  } catch (error) {
    console.error('Delete lesson error:', error);
    res.status(500).json({ error: 'Failed to delete lesson' });
  }
});

router.put('/lessons/:slot', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    if (slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    const {
      lessonTitle,
      lessonName, // Backward compatibility
      description,
      lessonDescription, // Backward compatibility
      body,
      images,
      tools,
      status
    } = req.body;
    
    // Use lessonTitle if provided, otherwise fall back to lessonName
    const finalTitle = lessonTitle !== undefined ? lessonTitle : (lessonName !== undefined ? lessonName : '');
    // Use description if provided, otherwise fall back to lessonDescription
    const finalDescription = description !== undefined ? description : (lessonDescription !== undefined ? lessonDescription : '');
    
    if (!finalTitle && !finalDescription) {
      return res.status(400).json({ error: 'Lesson title or description required' });
    }
    
    const lessonRef = db.ref(`lessons/${slot}`);
    const snapshot = await lessonRef.once('value');
    const existing = snapshot.val() || {};
    
    // Preserve existing questions if they exist (for quiz compatibility)
    const existingQuestions = existing.questions || {};
    
    // Build update object
    const finalStatus = status !== undefined ? status : existing.status;
    const normalizedStatus = (finalStatus || 'draft').toLowerCase();
    
    const updateData = {
      slot,
      lessonTitle: finalTitle,
      lessonName: finalTitle, // Keep for backward compatibility
      description: finalDescription,
      lessonDescription: finalDescription, // Keep for backward compatibility
      updatedAt: new Date().toISOString(),
      status: normalizedStatus
    };
    
    // Add body if provided
    if (body !== undefined) {
      updateData.body = body;
    } else if (existing.body !== undefined) {
      updateData.body = existing.body;
    }
    
    // Add images if provided
    if (images !== undefined) {
      updateData.images = Array.isArray(images) ? images : [];
    } else if (existing.images !== undefined) {
      updateData.images = existing.images;
    } else {
      updateData.images = [];
    }
    
    // Add tools if provided
    if (tools !== undefined) {
      updateData.tools = tools || {};
    } else if (existing.tools !== undefined) {
      updateData.tools = existing.tools;
    } else {
      updateData.tools = {};
    }
    
    // Preserve questions (quiz data)
    if (Object.keys(existingQuestions).length > 0) {
      updateData.questions = existingQuestions;
    }
    
    // Set createdAt if this is a new lesson
    if (!existing.createdAt) {
      updateData.createdAt = new Date().toISOString();
    } else {
      updateData.createdAt = existing.createdAt;
    }
    
    await lessonRef.set(updateData);
    await logActivity({
      type: 'lesson',
      action: 'lesson_updated',
      description: `Lesson ${slot} updated`,
      actorType: 'admin',
      actorId: req.admin?.adminId || null,
      actorName: req.admin?.email || 'Admin',
      relatedLesson: slot
    });
    res.json({ success: true, message: 'Lesson updated successfully' });
  } catch (error) {
    console.error('Update lesson error:', error);
    res.status(500).json({ error: 'Failed to update lesson' });
  }
});
// ============================================
// LMS Lesson Pages API (separate from Unity game quizzes)
// ============================================

// Get all pages for a lesson
router.get('/lessons/:slot/pages', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    if (slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    const pagesRef = db.ref(`lmsLessons/${slot}/pages`);
    const snapshot = await pagesRef.once('value');
    const pages = snapshot.val() || {};
    
    const pagesArray = Object.entries(pages)
      .map(([pageId, page]) => ({
        id: pageId,
        title: page.title || '',
        content: page.content || '',
        order: page.order || 0,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt
      }))
      .sort((a, b) => a.order - b.order);
    
    res.json({ success: true, pages: pagesArray });
  } catch (error) {
    console.error('Get lesson pages error:', error);
    res.status(500).json({ error: 'Failed to fetch lesson pages' });
  }
});

// Create a new page for a lesson
router.post('/lessons/:slot/pages', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    if (slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    const { title, content, order } = req.body;
    
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Page title is required' });
    }
    
    // Get existing pages to determine next order if not provided
    const pagesRef = db.ref(`lmsLessons/${slot}/pages`);
    const snapshot = await pagesRef.once('value');
    const existingPages = snapshot.val() || {};
    const pagesArray = Object.values(existingPages);
    const maxOrder = pagesArray.length > 0 ? Math.max(...pagesArray.map(p => p.order || 0)) : -1;
    const finalOrder = order !== undefined ? order : maxOrder + 1;
    
    const newPageRef = pagesRef.push();
    const pageData = {
      title: title.trim(),
      content: content || '',
      order: finalOrder,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await newPageRef.set(pageData);
    
    res.json({ success: true, page: { id: newPageRef.key, ...pageData } });
  } catch (error) {
    console.error('Create lesson page error:', error);
    res.status(500).json({ error: 'Failed to create lesson page' });
  }
});

// Update a page
router.put('/lessons/:slot/pages/:pageId', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    const { pageId } = req.params;
    if (slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    const { title, content, order } = req.body;
    
    const pageRef = db.ref(`lmsLessons/${slot}/pages/${pageId}`);
    const snapshot = await pageRef.once('value');
    const existing = snapshot.val();
    
    if (!existing) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const updateData = {
      ...existing,
      updatedAt: new Date().toISOString()
    };
    
    if (title !== undefined) {
      updateData.title = title.trim();
    }
    if (content !== undefined) {
      updateData.content = content;
    }
    if (order !== undefined) {
      updateData.order = order;
    }
    
    await pageRef.set(updateData);
    
    res.json({ success: true, page: { id: pageId, ...updateData } });
  } catch (error) {
    console.error('Update lesson page error:', error);
    res.status(500).json({ error: 'Failed to update lesson page' });
  }
});

// Delete a page
router.delete('/lessons/:slot/pages/:pageId', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    const { pageId } = req.params;
    if (slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    const pageRef = db.ref(`lmsLessons/${slot}/pages/${pageId}`);
    const snapshot = await pageRef.once('value');
    
    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    // Also delete assessments for this page
    const assessmentsRef = db.ref(`lmsLessons/${slot}/pages/${pageId}/assessments`);
    await assessmentsRef.remove();
    
    await pageRef.remove();
    
    res.json({ success: true, message: 'Page deleted successfully' });
  } catch (error) {
    console.error('Delete lesson page error:', error);
    res.status(500).json({ error: 'Failed to delete lesson page' });
  }
});

// Reorder pages
router.put('/lessons/:slot/pages/reorder', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    const { pageOrders } = req.body; // Array of { pageId, order }
    
    if (slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    if (!Array.isArray(pageOrders)) {
      return res.status(400).json({ error: 'pageOrders must be an array' });
    }
    
    const pagesRef = db.ref(`lmsLessons/${slot}/pages`);
    const updates = {};
    
    for (const { pageId, order } of pageOrders) {
      if (pageId && order !== undefined) {
        updates[`${pageId}/order`] = order;
        updates[`${pageId}/updatedAt`] = new Date().toISOString();
      }
    }
    
    await pagesRef.update(updates);
    
    res.json({ success: true, message: 'Pages reordered successfully' });
  } catch (error) {
    console.error('Reorder pages error:', error);
    res.status(500).json({ error: 'Failed to reorder pages' });
  }
});

// Get assessments for a page
router.get('/lessons/:slot/pages/:pageId/assessments', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    const { pageId } = req.params;
    
    if (slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    const assessmentsRef = db.ref(`lmsLessons/${slot}/pages/${pageId}/assessments`);
    const snapshot = await assessmentsRef.once('value');
    const assessments = snapshot.val() || {};
    
    const assessmentsArray = Object.entries(assessments)
      .map(([assessmentId, assessment]) => ({
        id: assessmentId,
        question: assessment.question || '',
        answerA: assessment.answerA || '',
        answerB: assessment.answerB || '',
        answerC: assessment.answerC || '',
        answerD: assessment.answerD || '',
        correctAnswer: assessment.correctAnswer || '',
        explanation: assessment.explanation || '',
        createdAt: assessment.createdAt,
        updatedAt: assessment.updatedAt
      }));
    
    res.json({ success: true, assessments: assessmentsArray });
  } catch (error) {
    console.error('Get page assessments error:', error);
    res.status(500).json({ error: 'Failed to fetch page assessments' });
  }
});

// Create assessment question for a page
router.post('/lessons/:slot/pages/:pageId/assessments', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    const { pageId } = req.params;
    
    if (slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    const { question, answerA, answerB, answerC, answerD, correctAnswer, explanation } = req.body;
    
    if (!question || !answerA || !answerB || !answerC || !answerD || !correctAnswer) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    const normalizedCorrect = (correctAnswer || '').toUpperCase();
    const validAnswers = ['A', 'B', 'C', 'D'];
    if (!validAnswers.includes(normalizedCorrect)) {
      return res.status(400).json({ error: 'Invalid correct answer (must be A, B, C, or D)' });
    }
    
    const assessmentsRef = db.ref(`lmsLessons/${slot}/pages/${pageId}/assessments`);
    const newAssessmentRef = assessmentsRef.push();
    
    const assessmentData = {
      question: question.trim(),
      answerA: answerA.trim(),
      answerB: answerB.trim(),
      answerC: answerC.trim(),
      answerD: answerD.trim(),
      correctAnswer: normalizedCorrect,
      explanation: explanation || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await newAssessmentRef.set(assessmentData);
    
    res.json({ success: true, assessment: { id: newAssessmentRef.key, ...assessmentData } });
  } catch (error) {
    console.error('Create page assessment error:', error);
    res.status(500).json({ error: 'Failed to create page assessment' });
  }
});

// Update assessment question
router.put('/lessons/:slot/pages/:pageId/assessments/:assessmentId', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    const { pageId, assessmentId } = req.params;
    
    if (slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    const { question, answerA, answerB, answerC, answerD, correctAnswer, explanation } = req.body;
    
    const assessmentRef = db.ref(`lmsLessons/${slot}/pages/${pageId}/assessments/${assessmentId}`);
    const snapshot = await assessmentRef.once('value');
    const existing = snapshot.val();
    
    if (!existing) {
      return res.status(404).json({ error: 'Assessment not found' });
    }
    
    const updateData = {
      ...existing,
      updatedAt: new Date().toISOString()
    };
    
    if (question !== undefined) updateData.question = question.trim();
    if (answerA !== undefined) updateData.answerA = answerA.trim();
    if (answerB !== undefined) updateData.answerB = answerB.trim();
    if (answerC !== undefined) updateData.answerC = answerC.trim();
    if (answerD !== undefined) updateData.answerD = answerD.trim();
    if (correctAnswer !== undefined) {
      const normalizedCorrect = (correctAnswer || '').toUpperCase();
      const validAnswers = ['A', 'B', 'C', 'D'];
      if (!validAnswers.includes(normalizedCorrect)) {
        return res.status(400).json({ error: 'Invalid correct answer (must be A, B, C, or D)' });
      }
      updateData.correctAnswer = normalizedCorrect;
    }
    if (explanation !== undefined) updateData.explanation = explanation;
    
    await assessmentRef.set(updateData);
    
    res.json({ success: true, assessment: { id: assessmentId, ...updateData } });
  } catch (error) {
    console.error('Update page assessment error:', error);
    res.status(500).json({ error: 'Failed to update page assessment' });
  }
});

// Delete assessment question
router.delete('/lessons/:slot/pages/:pageId/assessments/:assessmentId', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    const { pageId, assessmentId } = req.params;
    
    if (slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }
    
    const assessmentRef = db.ref(`lmsLessons/${slot}/pages/${pageId}/assessments/${assessmentId}`);
    const snapshot = await assessmentRef.once('value');
    
    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'Assessment not found' });
    }
    
    await assessmentRef.remove();
    
    res.json({ success: true, message: 'Assessment deleted successfully' });
  } catch (error) {
    console.error('Delete page assessment error:', error);
    res.status(500).json({ error: 'Failed to delete page assessment' });
  }
});

// ============================================
// Unity Game Quizzes API (preserved for Unity game)
// ============================================

// GET /api/admin/game-quizzes - Returns list of 6 Unity game lessons
router.get('/game-quizzes', verifyAdminToken, async (req, res) => {
  try {
    const lessons = [];
    for (let slot = 1; slot <= 6; slot++) {
      const lessonRef = db.ref(`lessons/lesson${slot}`);
      const snapshot = await lessonRef.once('value');
      const lessonData = snapshot.val() || {};
      lessons.push({
        slot,
        key: `lesson${slot}`,
        title: lessonData.lessonTitle || `Lesson ${slot}`
      });
    }
    res.json({ success: true, lessons });
  } catch (error) {
    console.error('Get game quizzes error:', error);
    res.status(500).json({ error: 'Failed to fetch game quizzes', details: error.message });
  }
});

// GET /api/admin/game-quizzes/:slot - Returns questions for a specific lesson slot
router.get('/game-quizzes/:slot', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    if (isNaN(slot) || slot < 1 || slot > 6) {
      return res.status(400).json({ error: 'Invalid lesson slot (1-6)' });
    }
    
    const lessonRef = db.ref(`lessons/lesson${slot}`);
    const lessonSnapshot = await lessonRef.once('value');
    const lessonData = lessonSnapshot.val() || {};
    const lessonTitle = lessonData.lessonTitle || `Lesson ${slot}`;
    
    const questionsRef = db.ref(`lessons/lesson${slot}/questions`);
    const questionsSnapshot = await questionsRef.once('value');
    const questions = questionsSnapshot.val() || {};
    
    // Convert questions object to array, only including actual questions
    const questionsArray = [];
    const questionKeys = Object.keys(questions).map(k => parseInt(k)).filter(k => !isNaN(k)).sort((a, b) => a - b);
    
    questionKeys.forEach((questionIndex) => {
      const questionData = questions[questionIndex];
      if (questionData && questionData.questionText) {
        const choices = questionData.choices || [];
        const correctIndex = questionData.correctIndex !== undefined ? questionData.correctIndex : -1;
        const correctAnswer = correctIndex >= 0 && correctIndex <= 3 ? ['A', 'B', 'C', 'D'][correctIndex] : '';
        
        questionsArray.push({
          index: questionIndex,
          questionText: questionData.questionText || '',
          answerA: choices[0] || '',
          answerB: choices[1] || '',
          answerC: choices[2] || '',
          answerD: choices[3] || '',
          correctAnswer: correctAnswer,
          correctIndex: correctIndex,
          explanation: questionData.explanation || ''
        });
      }
    });
    
    res.json({ 
      success: true, 
      slot,
      lessonTitle,
      questions: questionsArray 
    });
  } catch (error) {
    console.error('Get game quiz error:', error);
    res.status(500).json({ error: 'Failed to fetch quiz', details: error.message });
  }
});

// GET /api/admin/quizzes/:lesson - Legacy endpoint, redirects to game-quizzes
router.get('/quizzes/:lesson', verifyAdminToken, async (req, res) => {
  try {
    const lesson = parseInt(req.params.lesson);
    if (isNaN(lesson) || lesson < 1 || lesson > 6) {
      return res.status(400).json({ error: 'Invalid lesson number (1-6)' });
    }
    
    const lessonRef = db.ref(`lessons/lesson${lesson}`);
    const lessonSnapshot = await lessonRef.once('value');
    const lessonData = lessonSnapshot.val() || {};
    const lessonTitle = lessonData.lessonTitle || `Lesson ${lesson}`;
    
    const questionsRef = db.ref(`lessons/lesson${lesson}/questions`);
    const questionsSnapshot = await questionsRef.once('value');
    const questions = questionsSnapshot.val() || {};
    
    // Return only actual questions (not empty slots)
    const quizzesArray = [];
    const questionKeys = Object.keys(questions).map(k => parseInt(k)).filter(k => !isNaN(k)).sort((a, b) => a - b);
      
    questionKeys.forEach((questionIndex) => {
      const questionData = questions[questionIndex];
      if (questionData && questionData.questionText) {
        const choices = questionData.choices || [];
        const correctIndex = questionData.correctIndex !== undefined ? questionData.correctIndex : -1;
        const correctAnswer = correctIndex >= 0 && correctIndex <= 3 ? ['A', 'B', 'C', 'D'][correctIndex] : '';
        
        quizzesArray.push({
          lesson: lesson,
          slot: questionIndex + 1, // UI uses 1-based slot
          question: questionData.questionText || '',
          answerA: choices[0] || '',
          answerB: choices[1] || '',
          answerC: choices[2] || '',
          answerD: choices[3] || '',
          correctAnswer: correctAnswer,
          explanation: questionData.explanation || ''
        });
      }
    });
    
    res.json({ success: true, lesson: lesson, lessonTitle, quizzes: quizzesArray });
  } catch (error) {
    console.error('Get quizzes error:', error);
    res.status(500).json({ error: 'Failed to fetch quizzes', details: error.message });
  }
});
router.get('/quizzes', verifyAdminToken, async (req, res) => {
  try {
    const allQuizzes = {};
    
    for (let lesson = 1; lesson <= 6; lesson++) {
      const questionsRef = db.ref(`lessons/lesson${lesson}/questions`);
      const snapshot = await questionsRef.once('value');
      let questions = snapshot.val() || {};
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
// PUT /api/admin/game-quizzes/:slot - Update or add a question for a lesson slot
router.put('/game-quizzes/:slot', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    if (slot < 1 || slot > 6) {
      return res.status(400).json({ error: 'Invalid lesson slot (1-6)' });
    }
    
    const { questionIndex, questionText, answerA, answerB, answerC, answerD, correctAnswer, explanation } = req.body;
    
    if (!questionText) {
      return res.status(400).json({ error: 'Question text is required' });
    }
    
    const correctIndexMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
    const correctIndex = correctIndexMap[correctAnswer] !== undefined ? correctIndexMap[correctAnswer] : -1;
    
    if (correctIndex === -1) {
      return res.status(400).json({ error: 'Invalid correct answer (must be A, B, C, or D)' });
    }
    
    const choices = [
      answerA || '',
      answerB || '',
      answerC || '',
      answerD || ''
    ];
    
    // If questionIndex is provided, update that specific question
    // Otherwise, find the next available index
    let targetIndex;
    if (questionIndex !== undefined && questionIndex !== null) {
      targetIndex = parseInt(questionIndex);
    } else {
      // Find next available index
      const questionsRef = db.ref(`lessons/lesson${slot}/questions`);
      const snapshot = await questionsRef.once('value');
      const questions = snapshot.val() || {};
      const existingIndices = Object.keys(questions).map(k => parseInt(k)).filter(k => !isNaN(k));
      targetIndex = existingIndices.length > 0 ? Math.max(...existingIndices) + 1 : 0;
    }
    
    const questionRef = db.ref(`lessons/lesson${slot}/questions/${targetIndex}`);
    await questionRef.set({
      questionText: questionText,
      choices: choices,
      correctIndex: correctIndex,
      explanation: explanation || '',
      updatedAt: new Date().toISOString()
    });
    
    res.json({ success: true, message: 'Question saved successfully', questionIndex: targetIndex });
  } catch (error) {
    console.error('Update game quiz error:', error);
    res.status(500).json({ error: 'Failed to update quiz', details: error.message });
  }
});

// PUT /api/admin/quizzes/:lesson/:slot - Legacy endpoint for updating a question
router.put('/quizzes/:lesson/:slot', verifyAdminToken, async (req, res) => {
  try {
    const lesson = parseInt(req.params.lesson);
    const slot = parseInt(req.params.slot);
    
    if (lesson < 1 || lesson > 6) {
      return res.status(400).json({ error: 'Invalid lesson number (1-6)' });
    }
    
    const { question, answerA, answerB, answerC, answerD, correctAnswer, explanation } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }
    
    const questionIndex = slot - 1; // Convert 1-based slot to 0-based index
    const correctIndexMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
    const correctIndex = correctIndexMap[correctAnswer] !== undefined ? correctIndexMap[correctAnswer] : -1;
    
    if (correctIndex === -1) {
      return res.status(400).json({ error: 'Invalid correct answer (must be A, B, C, or D)' });
    }
    
    const choices = [
      answerA || '',
      answerB || '',
      answerC || '',
      answerD || ''
    ];
    
    const questionRef = db.ref(`lessons/lesson${lesson}/questions/${questionIndex}`);
    await questionRef.set({
      questionText: question,
      choices: choices,
      correctIndex: correctIndex,
      explanation: explanation || '',
      updatedAt: new Date().toISOString()
    });
    
    res.json({ success: true, message: 'Quiz updated successfully' });
  } catch (error) {
    console.error('Update quiz error:', error);
    res.status(500).json({ error: 'Failed to update quiz', details: error.message });
  }
});

// DELETE /api/admin/game-quizzes/:slot/:questionIndex - Delete a question and reindex
router.delete('/game-quizzes/:slot/:questionIndex', verifyAdminToken, async (req, res) => {
  try {
    const slot = parseInt(req.params.slot);
    const questionIndex = parseInt(req.params.questionIndex);
    
    if (slot < 1 || slot > 6) {
      return res.status(400).json({ error: 'Invalid lesson slot (1-6)' });
    }
    
    if (isNaN(questionIndex) || questionIndex < 0) {
      return res.status(400).json({ error: 'Invalid question index' });
    }
    
    const questionsRef = db.ref(`lessons/lesson${slot}/questions`);
    const snapshot = await questionsRef.once('value');
    const questions = snapshot.val() || {};
    
    // Delete the question at the specified index
    const questionToDeleteRef = db.ref(`lessons/lesson${slot}/questions/${questionIndex}`);
    await questionToDeleteRef.remove();
    
    // Reindex remaining questions to keep indices dense (0, 1, 2, ...)
    const remainingQuestions = [];
    const questionKeys = Object.keys(questions).map(k => parseInt(k)).filter(k => !isNaN(k) && k !== questionIndex).sort((a, b) => a - b);
    
    for (let i = 0; i < questionKeys.length; i++) {
      const oldIndex = questionKeys[i];
      const newIndex = i;
      
      if (oldIndex !== newIndex) {
        const oldQuestionRef = db.ref(`lessons/lesson${slot}/questions/${oldIndex}`);
        const oldQuestionSnapshot = await oldQuestionRef.once('value');
        const oldQuestionData = oldQuestionSnapshot.val();
        
        if (oldQuestionData) {
          const newQuestionRef = db.ref(`lessons/lesson${slot}/questions/${newIndex}`);
          await newQuestionRef.set(oldQuestionData);
          await oldQuestionRef.remove();
        }
      }
    }
    
    res.json({ success: true, message: 'Question deleted and reindexed successfully' });
  } catch (error) {
    console.error('Delete game quiz error:', error);
    res.status(500).json({ error: 'Failed to delete question', details: error.message });
  }
});
// ============================================
// Lesson Intro Video Upload
// ============================================

router.post('/lessons/upload-intro', verifyAdminToken, upload.single('videoFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    if (!bucket) {
      return res.status(503).json({ 
        error: 'Storage bucket not configured. Please set FIREBASE_STORAGE_BUCKET in .env or check server logs.' 
      });
    }

    const lessonSlot = req.body.lessonSlot || 'unassigned';
    
    // Determine extension
    const originalName = req.file.originalname || 'video';
    const extMatch = originalName.match(/\.(\w+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'mp4';

    // Basic validation - allow video formats
    const allowedExts = ['mp4', 'webm', 'ogg', 'mov'];
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({ error: `Unsupported video format: .${ext}. Allowed: mp4, webm, ogg, mov.` });
    }

    const timestamp = Date.now();
    const filePath = `lessons/${lessonSlot}/intro-video/${timestamp}.${ext}`;
    const file = bucket.file(filePath);

    console.log(`[uploadLessonIntro] Uploading ${req.file.size} bytes to ${filePath}...`);

    await file.save(req.file.buffer, {
      contentType: req.file.mimetype || 'video/mp4',
      resumable: false
    });

    // Make public for simple access
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(filePath)}`;

    console.log('[uploadLessonIntro] Success. URL:', publicUrl);

    return res.json({
      success: true,
      introVideoUrl: publicUrl,
      introVideoStoragePath: filePath
    });
  } catch (err) {
    console.error('[uploadLessonIntro] Error uploading video:', err);
    res.status(500).json({ 
      error: 'Failed to upload intro video',
      details: err.message 
    });
  }
});

// ============================================
// Global Videos Management
// ============================================

// Get all videos
router.get('/videos', verifyAdminToken, async (req, res) => {
  try {
    const videosRef = db.ref('videos');
    const snapshot = await videosRef.once('value');
    const videosData = snapshot.val() || {};
    
    const videos = Object.keys(videosData).map(id => ({
      id,
      ...videosData[id]
    }));
    
    res.json({ success: true, videos });
  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// Create new video
router.post('/videos', verifyAdminToken, async (req, res) => {
  try {
    const { title, description, downloadUrl, storagePath, order } = req.body;
    
    console.log('[createVideo] Request body:', { title, description, downloadUrl: downloadUrl ? 'present' : 'missing', storagePath: storagePath ? 'present' : 'missing', order });
    
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    if (!downloadUrl) {
      console.error('[createVideo] Missing downloadUrl in request body');
      return res.status(400).json({ error: 'Video URL is required. Please upload a video file first.' });
    }
    
    const videosRef = db.ref('videos');
    const newVideoRef = videosRef.push();
    
    const videoData = {
      title: title.trim(),
      description: (description || '').trim(),
      downloadUrl,
      storagePath: storagePath || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // Only add order if it's provided and valid
    if (order !== undefined && order !== null && order !== '') {
      const orderNum = parseInt(order, 10);
      if (!isNaN(orderNum)) {
        videoData.order = orderNum;
      }
    }
    
    console.log('[createVideo] Creating video with data:', { ...videoData, downloadUrl: 'present' });
    
    await newVideoRef.set(videoData);
    
    console.log('[createVideo] Video created successfully with ID:', newVideoRef.key);
    
    res.json({ success: true, video: { id: newVideoRef.key, ...videoData } });
  } catch (error) {
    console.error('[createVideo] Error creating video:', error);
    console.error('[createVideo] Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to create video',
      details: error.message 
    });
  }
});

// Update video
router.put('/videos/:videoId', verifyAdminToken, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { title, description, downloadUrl, storagePath, order } = req.body;
    
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    const videoRef = db.ref(`videos/${videoId}`);
    const snapshot = await videoRef.once('value');
    
    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    const existingData = snapshot.val();
    const updateData = {
      title: title.trim(),
      description: (description || '').trim(),
      updatedAt: new Date().toISOString()
    };
    
    // Only add order if it's provided and valid
    if (order !== undefined && order !== null && order !== '') {
      const orderNum = parseInt(order, 10);
      if (!isNaN(orderNum)) {
        updateData.order = orderNum;
      }
    }
    
    // Only update downloadUrl/storagePath if provided (from new upload)
    if (downloadUrl) {
      updateData.downloadUrl = downloadUrl;
    }
    if (storagePath) {
      updateData.storagePath = storagePath;
    }
    
    // Preserve existing URL/path if not updating
    if (!downloadUrl && existingData.downloadUrl) {
      updateData.downloadUrl = existingData.downloadUrl;
    }
    if (!storagePath && existingData.storagePath) {
      updateData.storagePath = existingData.storagePath;
    }
    
    // Preserve createdAt
    if (existingData.createdAt) {
      updateData.createdAt = existingData.createdAt;
    }
    
    await videoRef.update(updateData);
    
    res.json({ success: true, video: { id: videoId, ...updateData } });
  } catch (error) {
    console.error('Update video error:', error);
    res.status(500).json({ error: 'Failed to update video' });
  }
});

// Delete video
router.delete('/videos/:videoId', verifyAdminToken, async (req, res) => {
  try {
    const { videoId } = req.params;
    
    const videoRef = db.ref(`videos/${videoId}`);
    const snapshot = await videoRef.once('value');
    
    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    const videoData = snapshot.val();
    
    // Delete from Storage if path exists
    if (videoData.storagePath && bucket) {
      try {
        const file = bucket.file(videoData.storagePath);
        const [exists] = await file.exists();
        if (exists) {
          await file.delete();
          console.log(`[deleteVideo] Deleted storage file: ${videoData.storagePath}`);
        }
      } catch (storageError) {
        console.error('[deleteVideo] Error deleting storage file:', storageError);
        // Continue with DB deletion even if storage deletion fails
      }
    }
    
    // Delete from database
    await videoRef.remove();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Upload video file
router.post('/videos/upload', verifyAdminToken, upload.single('videoFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    if (!bucket) {
      return res.status(503).json({ 
        error: 'Storage bucket not configured. Please set FIREBASE_STORAGE_BUCKET in .env or check server logs.' 
      });
    }

    const videoId = req.body.videoId || `video_${Date.now()}`;
    
    // Determine extension
    const originalName = req.file.originalname || 'video';
    const extMatch = originalName.match(/\.(\w+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'mp4';

    // Basic validation - allow video formats
    const allowedExts = ['mp4', 'webm', 'ogg', 'mov'];
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({ error: `Unsupported video format: .${ext}. Allowed: mp4, webm, ogg, mov.` });
    }

    const timestamp = Date.now();
    const filePath = `videos/${videoId}_${timestamp}.${ext}`;
    const file = bucket.file(filePath);

    console.log(`[uploadVideo] Uploading ${req.file.size} bytes to ${filePath}...`);

    await file.save(req.file.buffer, {
      contentType: req.file.mimetype || 'video/mp4',
      resumable: false
    });

    // Make public for simple access
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(filePath)}`;

    console.log('[uploadVideo] Success. URL:', publicUrl);

    return res.json({
      success: true,
      downloadUrl: publicUrl,
      storagePath: filePath
    });
  } catch (err) {
    console.error('[uploadVideo] Error uploading video:', err);
    res.status(500).json({ 
      error: 'Failed to upload video',
      details: err.message 
    });
  }
});

// ============================================
// Tool 3D Model Upload
// ============================================

router.post('/tools/upload-model', verifyAdminToken, upload.single('modelFile'), async (req, res) => {
  try {
    if (!req.file) {
      console.error('[uploadToolModel] No file provided');
      return res.status(400).json({ error: 'No model file provided' });
    }

    if (!bucket) {
      console.error('[uploadToolModel] Storage bucket not configured (bucket is null)');
      return res.status(503).json({ 
        error: 'Storage bucket not configured. Please set FIREBASE_STORAGE_BUCKET in .env or check server logs.' 
      });
    }

    const lessonSlot = req.body.lessonSlot || 'unassigned';
    const toolId = req.body.toolId || `tool_${Date.now()}`;

    // Determine extension
    const originalName = req.file.originalname || 'model';
    const extMatch = originalName.match(/\.(\w+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'bin';

    // Basic validation – allow glb, gltf, fbx, obj
    const allowedExts = ['glb', 'gltf', 'fbx', 'obj'];
    if (!allowedExts.includes(ext)) {
      console.error('[uploadToolModel] Unsupported extension:', ext);
      return res.status(400).json({ error: `Unsupported 3D format: .${ext}. Allowed: glb, gltf, fbx, obj.` });
    }

    const filePath = `tools/lesson${lessonSlot}/${toolId}.${ext}`;
    const file = bucket.file(filePath);

    console.log(`[uploadToolModel] Uploading ${req.file.size} bytes to ${filePath}...`);

    await file.save(req.file.buffer, {
      contentType: req.file.mimetype || 'application/octet-stream',
      resumable: false
    });

    // Make public for simple access
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(filePath)}`;

    console.log('[uploadToolModel] Success. URL:', publicUrl);

    return res.json({
      success: true,
      modelUrl: publicUrl,
      storagePath: filePath,
      format: ext
    });
  } catch (err) {
    console.error('[uploadToolModel] Error uploading 3D model:', err);
    res.status(500).json({ 
      error: 'Failed to upload 3D model',
      details: err.message 
    });
  }
});

// ============================================
// Tool 3D Model Streaming (Proxy)
// ============================================

router.get('/tools/model', async (req, res) => {
  try {
    const { path: modelPath } = req.query;

    if (!modelPath) {
      return res.status(400).json({ error: 'Missing model path.' });
    }

    // Basic security check to ensure we only serve files from the tools directory
    if (!modelPath.startsWith('tools/')) {
        return res.status(400).json({ error: 'Invalid model path. Access denied.' });
    }

    if (!bucket) {
       return res.status(503).json({ error: 'Storage bucket not configured.' });
    }

    const file = bucket.file(modelPath);
    const [exists] = await file.exists();

    if (!exists) {
      return res.status(404).json({ error: 'Model file not found.' });
    }

    // Determine Content-Type
    let contentType = 'application/octet-stream';
    if (modelPath.endsWith('.glb')) contentType = 'model/gltf-binary';
    else if (modelPath.endsWith('.gltf')) contentType = 'model/gltf+json';
    else if (modelPath.endsWith('.fbx')) contentType = 'application/octet-stream'; // FBX often served as octet-stream
    else if (modelPath.endsWith('.obj')) contentType = 'text/plain';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const readStream = file.createReadStream();

    readStream.on('error', (err) => {
      console.error('[streamToolModel] Error streaming model:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream model file.' });
      } else {
        res.end();
      }
    });

    readStream.pipe(res);

  } catch (error) {
    console.error('[streamToolModel] Unexpected error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error streaming model.' });
    }
  }
});

// ============================================
// Certificate Notification Endpoints
// ============================================

router.post('/certificates/notify-student', verifyAdminToken, async (req, res) => {
  try {
    const { uid, email, fullName } = req.body || {};

    if (!uid || !email || !fullName) {
      return res.status(400).json({ success: false, error: 'uid, email, and fullName are required' });
    }

    if (!isEmailConfigured) {
      return res.status(503).json({ success: false, error: 'Email service not configured', details: 'SMTP settings are missing. Please configure email service in environment variables.' });
    }

    const certificateUrl = `${process.env.PUBLIC_HOST || 'https://asat-caresim.online'}/student-certificates.html`;

    const emailResult = await sendEmail({
      to: email,
      subject: "You're now eligible for your CareSim LMS Certificate",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
          <h2 style="color: #C19A6B; border-bottom: 2px solid #C19A6B; padding-bottom: 10px;">Congratulations!</h2>
          <p>Dear ${fullName},</p>
          <p>You have successfully completed all required lessons and are now eligible to generate your CareSim LMS Certificate.</p>
          <p>Click the button below to access your certificate page:</p>
          
          <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
             <a href="${certificateUrl}" style="display: inline-block; background-color: #C19A6B; color: white; font-weight: bold; text-decoration: none; padding: 12px 24px; border-radius: 6px;">View Certificate Page</a>
          </div>

          <p>Best regards,<br>The CareSim Team</p>
        </div>
      `,
      text: `Dear ${fullName},\n\nYou have successfully completed all required lessons and are now eligible to generate your CareSim LMS Certificate.\n\nAccess your certificate here: ${certificateUrl}\n\nBest regards,\nThe CareSim Team`
    });

    if (emailResult.success) {
      // Store notification timestamp in user record
      const now = new Date().toISOString();
      await db.ref(`users/${uid}/certificateNotificationSentAt`).set(now);
      
      await logActivity({
        type: 'certificate',
        action: 'student_notified',
        description: `Notified student ${fullName} about certificate eligibility`,
        actorType: 'admin',
        actorId: req.admin?.adminId || null,
        actorName: req.admin?.email || 'Admin',
        metadata: { uid, email }
      });

      res.json({ success: true, message: 'Notification email sent successfully' });
    } else {
      console.error('Failed to send notification email:', emailResult.error);
      res.status(500).json({ success: false, error: 'Failed to send email', details: emailResult.error || 'Unknown email error' });
    }

  } catch (error) {
    console.error('Notify student endpoint error:', error);
    res.status(500).json({ success: false, error: 'Internal server error', details: error.message });
  }
});

// ============================================
// Game Certificate Issuance (Generic)
// ============================================

router.post('/issue-game-certificate', verifyAdminToken, async (req, res) => {
  try {
    const { uid, email, name, certId } = req.body || {};

    if (!uid || !email || !name || !certId) {
      return res.status(400).json({ error: 'uid, email, name, and certId are required' });
    }

    // Verify email config first
    if (!isEmailConfigured) {
       // If we can't send email, should we fail? The frontend asks to issue AND email.
       // We'll try to send, if fails we log it but maybe not block if the DB write happened on frontend?
       // Actually, frontend does DB writes first, then calls this.
       // If this fails, we return error, frontend shows alert.
       return res.status(503).json({ error: 'Email service not configured' });
    }

    const verifyUrl = `${process.env.PUBLIC_HOST || 'https://asat-caresim.online'}/generic-certificate.html?certId=${certId}`;

    const emailResult = await sendEmail({
      to: email,
      subject: 'Your CareSim Game Certificate',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
          <h2 style="color: #C19A6B; border-bottom: 2px solid #C19A6B; padding-bottom: 10px;">Certificate of Completion</h2>
          <p>Dear ${name},</p>
          <p>Congratulations! You have successfully completed the CareSim Virtual Simulation Training Program game modules.</p>
          <p>We are pleased to issue you a Certificate of Completion.</p>
          
          <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
             <a href="${verifyUrl}" style="display: inline-block; background-color: #C19A6B; color: white; font-weight: bold; text-decoration: none; padding: 12px 24px; border-radius: 6px;">View & Download Certificate</a>
             <p style="margin-top: 15px; font-size: 14px; color: #64748B;">Certificate ID: <strong>${certId}</strong></p>
          </div>

          <p>You can verify the authenticity of this certificate at any time by scanning the QR code on the document or visiting our verification page.</p>
          <p>Best regards,<br>The CareSim Team</p>
        </div>
      `,
      text: `Dear ${name},\n\nCongratulations on completing the CareSim game modules! Your certificate (ID: ${certId}) is ready.\n\nAccess it here: ${verifyUrl}\n\nBest regards,\nThe CareSim Team`
    });

    if (emailResult.success) {
      await logActivity({
        type: 'certificate',
        action: 'game_certificate_issued',
        description: `Issued game certificate ${certId} to ${name}`,
        actorType: 'admin',
        actorId: req.admin?.adminId || null,
        actorName: req.admin?.email || 'Admin',
        metadata: { uid, email, certId }
      });

      res.json({ success: true });
    } else {
      console.error('Failed to send certificate email:', emailResult.error);
      res.status(500).json({ error: 'Failed to send email', details: emailResult.error });
    }

  } catch (error) {
    console.error('Issue certificate endpoint error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// ============================================
// Email Test Endpoint
// ============================================

router.get('/test-email', verifyAdminToken, async (req, res) => {
  try {
    
    // Check if email is configured
    if (!isEmailConfigured) {
      return res.status(503).json({
        success: false,
        error: 'Email not configured: missing SMTP_* environment variables. Please set SMTP_HOST, SMTP_USER, and SMTP_PASS in your .env file.'
      });
    }

    // Get recipient email from query parameter
    let to = req.query.to;
    
    // If no 'to' parameter, try to get admin email from token
    if (!to) {
      // JWT token contains email (see routes/auth.js admin login)
      to = req.admin?.email;
      
      if (!to) {
        return res.status(400).json({
          success: false,
          error: 'Missing recipient email. Please provide ?to=email@example.com or ensure your admin account has an email address.'
        });
      }
    }

    // Validate email format (basic check)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email address format'
      });
    }

    // Send test email
    const result = await sendEmail({
      to,
      subject: 'CareSim Email Test',
      text: 'This is a test email from the CareSim backend. If you received this, email configuration is working correctly!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #C19A6B;">CareSim Email Test</h2>
          <p>This is a <strong>test email</strong> from the CareSim backend.</p>
          <p>If you received this email, your SMTP configuration is working correctly! ✅</p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;">
          <p style="color: #64748B; font-size: 12px;">This is an automated test email. No action is required.</p>
        </div>
      `
    });

    if (result.success) {
      res.json({
        success: true,
        message: `Test email sent successfully to ${to}`,
        messageId: result.messageId
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to send test email'
      });
    }
  } catch (error) {
    console.error('Test email endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error while sending test email'
    });
  }
});

// ============================================
// Admin HTML Page Routes
// ============================================

// Inject isDev flag into admin pages
router.use((req, res, next) => {
  // Check if user is admin and email is admin@gmail.com
  if (req.admin && req.admin.email === 'admin@gmail.com') {
    req.isDev = true;
  } else {
    req.isDev = false;
  }
  next();
});

// We need to intercept the sendFile calls in app.js or handle data injection.
// Since we are using static HTML files, we can't easily inject server-side data without a template engine.
// HOWEVER, we can expose an endpoint that the frontend calls to check config/status.

router.get('/config', verifyAdminToken, (req, res) => {
  const isDev = req.admin?.email === 'admin@gmail.com';
  res.json({
    success: true,
    config: {
      isDev: isDev,
      adminEmail: req.admin?.email
    }
  });
});

// ============================================
// Dev Tools Endpoints
// ============================================

// Helper: Load and verify demo user
async function getDemoUserOrThrow(req, uid) {
  // 1) Verify current admin is super admin
  const isDev = req.admin?.email === 'admin@gmail.com';
  if (!isDev) {
    const error = new Error('Dev mode only');
    error.status = 403;
    throw error;
  }

  // 2) Verify this is a demo user
  const demoUserSnapshot = await db.ref(`devTools/demoUsers/${uid}`).once('value');
  if (!demoUserSnapshot.exists()) {
    const error = new Error('Demo user not found');
    error.status = 404;
    throw error;
  }

  // 3) Load user data
  const userSnapshot = await userRef(uid).once('value');
  const userData = userSnapshot.val() || {};

  return { uid, user: userData };
}

router.post('/dev/create-lms-student', verifyAdminToken, async (req, res) => {
  const isDev = req.admin?.email === 'admin@gmail.com';
  if (!isDev) return res.status(403).json({ error: 'Dev mode only' });

  try {
    const timestamp = Date.now();
    // Use provided details or defaults
    const email = req.body.email || `demo.lms.${timestamp}@example.com`;
    const password = req.body.password || 'DemoPass123!';
    const name = req.body.name || `Demo LMS Student ${timestamp}`;

    // Check if user exists (Auth) - although createUser does this, we want a clear error
    try {
      await auth.getUserByEmail(email);
      return res.status(409).json({ error: 'Email already exists. Please use a different email.' });
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }

    // Create Auth User
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
      emailVerified: true
    });

    const uid = userRecord.uid;
    const now = new Date().toISOString();

    // Create User Record with FULL PROGRESS
    const userData = {
      uid,
      name,
      fullName: name,
      email,
      role: 'student',
      verified: true,
      active: true,
      createdAt: now,
      updatedAt: now,
      studentInfo: {
        studentNumber: `DEV-${timestamp}`,
        batch: '2025',
        contactNumber: '0000000000',
        birthday: '2000-01-01',
        address: 'Dev Address'
      },
      lmsProgress: {}
    };

    // Fill 6 lessons
    for (let i = 1; i <= 6; i++) {
      userData.lmsProgress[`lesson${i}`] = {
        completedPages: { p1: true, p2: true, p3: true }, // Mock pages
        quiz: {
          completed: true,
          highestScore: 10, // 10/10
          attempts: 1,
          lastAttempt: now
        },
        simulation: {
          completed: true,
          passed: true,
          score: 100,
          lastAttempt: now
        }
      };
    }

    await userRef(uid).set(userData);

    // Write to /devTools/demoUsers
    await db.ref(`devTools/demoUsers/${uid}`).set({
      email,
      password,
      type: 'lms',
      createdAt: now
    });

    res.json({ success: true, message: 'Created Demo LMS Student', email, password, uid });
  } catch (error) {
    console.error('Dev create LMS student error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/dev/create-game-user', verifyAdminToken, async (req, res) => {
  const isDev = req.admin?.email === 'admin@gmail.com';
  if (!isDev) return res.status(403).json({ error: 'Dev mode only' });

  try {
    const timestamp = Date.now();
    const email = req.body.email || `demo.game.${timestamp}@example.com`;
    const password = req.body.password || 'DemoPass123!';
    const name = req.body.name || `Demo Game User ${timestamp}`;

    // Check if user exists (Auth)
    try {
      await auth.getUserByEmail(email);
      return res.status(409).json({ error: 'Email already exists. Please use a different email.' });
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }

    // Create Auth User (Public role usually doesn't strictly need auth but consistent)
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: name
    });

    const uid = userRecord.uid;
    const now = new Date().toISOString();

    // Create Public User with Game Progress (using same schema as LMS students)
    // Initialize progress with correct structure: progress.lesson{N}.quiz and progress.lesson{N}.simulation
    const progress = {};
    for (let i = 1; i <= 6; i++) {
      progress[`lesson${i}`] = {
        quiz: {
          attempts: 0,
          avgTime: 0,
          completed: false,
          highestScore: 0,
          latestScore: 0
        },
        simulation: {
          attempts: 0,
          avgTime: 0,
          completed: false
        }
      };
    }

    const userData = {
      uid,
      name,
      fullName: name,
      email,
      role: 'public', // Public user
      active: true,
      createdAt: now,
      updatedAt: now,
      progress
    };

    await userRef(uid).set(userData);

    // Write to /devTools/demoUsers
    await db.ref(`devTools/demoUsers/${uid}`).set({
      email,
      password,
      type: 'game',
      createdAt: now
    });

    res.json({ success: true, message: 'Created Demo Game User', email, password, uid });
  } catch (error) {
    console.error('Dev create Game user error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/dev/demo-users', verifyAdminToken, async (req, res) => {
  const isDev = req.admin?.email === 'admin@gmail.com';
  if (!isDev) return res.status(403).json({ error: 'Dev mode only' });

  try {
    const snapshot = await db.ref('devTools/demoUsers').once('value');
    const demoUsers = [];
    
    snapshot.forEach(child => {
      demoUsers.push({
        uid: child.key,
        ...child.val()
      });
    });

    // Enrich with progress counts
    for (const user of demoUsers) {
      const userSnapshot = await userRef(user.uid).once('value');
      const userData = userSnapshot.val() || {};
      
      // Calculate LMS lessons completed (if role is student or type is lms)
      let lmsLessonsCompleted = 0;
      if (user.type === 'lms' || userData.role === 'student') {
        const progress = userData.lmsProgress || {};
        for (let i = 1; i <= 6; i++) {
          const lessonKey = `lesson${i}`;
          const lessonData = progress[lessonKey] || {};
          const completedPages = lessonData.completedPages || {};
          const hasPages = Object.keys(completedPages).length > 0;
          const quiz = lessonData.quiz || {};
          const quizCompleted = quiz.completed === true;
          const quizScoreOk = (quiz.highestScore || 0) >= 7;
          const sim = lessonData.simulation || {};
          const simOk = sim.completed === true && sim.passed === true;
          
          if (hasPages && quizCompleted && quizScoreOk && simOk) {
            lmsLessonsCompleted += 1;
          }
        }
      }
      
      // Calculate Game lessons completed (if role is public or type is game)
      let gameLessonsCompleted = 0;
      if (user.type === 'game' || userData.role === 'public') {
        if (typeof userData.lessonsCompleted === 'number') {
          gameLessonsCompleted = Math.min(6, Math.max(0, userData.lessonsCompleted));
        } else if (userData.gameProgress && typeof userData.gameProgress.lessonsCompleted === 'number') {
          gameLessonsCompleted = Math.min(6, Math.max(0, userData.gameProgress.lessonsCompleted));
        } else if (userData.progress && userData.progress.gameLessons) {
          gameLessonsCompleted = Object.values(userData.progress.gameLessons).filter(l => l && l.completed === true).length;
        }
      }
      
      user.lmsLessonsCompleted = lmsLessonsCompleted;
      user.gameLessonsCompleted = gameLessonsCompleted;
    }

    // Sort by createdAt descending (newest first)
    demoUsers.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    res.json({ success: true, users: demoUsers });
  } catch (error) {
    console.error('Dev get demo users error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/dev/update-demo-progress', verifyAdminToken, async (req, res) => {
  const isDev = req.admin?.email === 'admin@gmail.com';
  if (!isDev) return res.status(403).json({ error: 'Dev mode only' });

  try {
    const { uid, lmsLessonsCompleted, gameLessonsCompleted, lmsQuizScore, gameQuizScore } = req.body;
    if (!uid) return res.status(400).json({ error: 'UID is required' });

    // Verify this is a demo user
    const demoUserSnapshot = await db.ref(`devTools/demoUsers/${uid}`).once('value');
    if (!demoUserSnapshot.exists()) {
      return res.status(404).json({ error: 'Demo user not found' });
    }

    const userSnapshot = await userRef(uid).once('value');
    const userData = userSnapshot.val() || {};
    const now = new Date().toISOString();

    // Clamp values
    const lmsCount = lmsLessonsCompleted !== undefined ? Math.min(6, Math.max(0, parseInt(lmsLessonsCompleted) || 0)) : undefined;
    const gameCount = gameLessonsCompleted !== undefined ? Math.min(6, Math.max(0, parseInt(gameLessonsCompleted) || 0)) : undefined;
    const lmsQuiz = lmsQuizScore !== undefined ? Math.min(10, Math.max(0, parseInt(lmsQuizScore) || 8)) : 8;
    const gameQuiz = gameQuizScore !== undefined ? Math.min(10, Math.max(0, parseInt(gameQuizScore) || 8)) : 8;

    // Update LMS Progress
    if (lmsCount !== undefined) {
      const lmsProgress = {};
      
      // Try to get real page IDs from lmsLessons
      let firstPageId = 'demoPage';
      try {
        const pagesSnapshot = await db.ref('lmsLessons/1/pages').once('value');
        const pages = pagesSnapshot.val() || {};
        const pageIds = Object.keys(pages);
        if (pageIds.length > 0) {
          firstPageId = pageIds[0];
        }
      } catch (e) {
        // Use default if can't fetch
      }

      for (let i = 1; i <= 6; i++) {
        if (i <= lmsCount) {
          // Set lesson as complete
          lmsProgress[`lesson${i}`] = {
            completedPages: { [firstPageId]: true },
            quiz: {
              completed: true,
              highestScore: lmsQuiz,
              attempts: 1,
              lastAttempt: now
            },
            simulation: {
              completed: true,
              passed: true,
              score: 100,
              lastAttempt: now
            },
            lastAssessment: now
          };
        } else {
          // Clear lesson progress
          lmsProgress[`lesson${i}`] = {};
        }
      }

      await userRef(uid).update({ lmsProgress });
    }

    // Update Game Progress
    if (gameCount !== undefined) {
      // Set top-level counter
      await userRef(uid).update({ lessonsCompleted: gameCount });
      
      // Update gameProgress/lessonsCompleted
      const gameProgressRef = db.ref(`users/${uid}/gameProgress`);
      const existingGameProgress = (await gameProgressRef.once('value')).val() || {};
      await gameProgressRef.set({ ...existingGameProgress, lessonsCompleted: gameCount });

      // Update gameLessons map
      const gameLessonsRef = db.ref(`users/${uid}/progress/gameLessons`);
      const existingGameLessons = (await gameLessonsRef.once('value')).val() || {};
      
      // Remove all existing lessons first
      for (let j = 1; j <= 6; j++) {
        await db.ref(`users/${uid}/progress/gameLessons/lesson${j}`).remove();
      }
      
      // Add completed lessons
      const newGameLessons = {};
      for (let j = 1; j <= gameCount; j++) {
        newGameLessons[`lesson${j}`] = { completed: true };
      }
      if (Object.keys(newGameLessons).length > 0) {
        await gameLessonsRef.update(newGameLessons);
      }

      // Update per-lesson quiz/simulation under progress/lesson{j}
      const existingProgress = userData.progress || {};
      
      for (let j = 1; j <= 6; j++) {
        const lessonRef = db.ref(`users/${uid}/progress/lesson${j}`);
        if (j <= gameCount) {
          // Set quiz and simulation
          const existingLesson = existingProgress[`lesson${j}`] || {};
          await lessonRef.update({
            ...existingLesson,
            quiz: {
              completed: true,
              highestScore: gameQuiz,
              attempts: 1,
              lastAttempt: now
            },
            simulation: {
              completed: true,
              passed: true,
              score: 100,
              lastAttempt: now
            }
          });
        } else {
          // Remove quiz and simulation, but keep other data if exists
          const existingLesson = (await lessonRef.once('value')).val() || {};
          if (existingLesson.quiz) {
            await db.ref(`users/${uid}/progress/lesson${j}/quiz`).remove();
          }
          if (existingLesson.simulation) {
            await db.ref(`users/${uid}/progress/lesson${j}/simulation`).remove();
          }
        }
      }
    }

    res.json({ 
      success: true, 
      message: 'Demo user progress updated successfully',
      updated: {
        lmsLessonsCompleted: lmsCount !== undefined ? lmsCount : userData.lmsLessonsCompleted,
        gameLessonsCompleted: gameCount !== undefined ? gameCount : userData.gameLessonsCompleted
      }
    });
  } catch (error) {
    console.error('Dev update demo progress error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/dev/demo-user/:uid/progress', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const { uid: verifiedUid, user } = await getDemoUserOrThrow(req, uid);

    const lms = {};
    const game = {};

    // Load LMS Progress
    const lmsProgress = user.lmsProgress || {};
    for (let i = 1; i <= 6; i++) {
      const lessonKey = `lesson${i}`;
      const lessonData = lmsProgress[lessonKey] || {};
      const completedPages = lessonData.completedPages || {};
      const completedPagesCount = Object.keys(completedPages).length;
      const hasPages = completedPagesCount > 0;
      // LMS only tracks pages and assessments (not quiz/simulation - those are in Game)
      lms[String(i)] = {
        completedPagesCount,
        hasPages,
        lastAssessment: lessonData.lastAssessment || null
      };
    }

    // Load Game Progress
    const progress = user.progress || {};
    let gameLessonsCompleted = 0;
    
    // Calculate summary (same logic as admin-game-certificates)
    if (typeof user.lessonsCompleted === 'number') {
      gameLessonsCompleted = Math.min(6, Math.max(0, user.lessonsCompleted));
    } else if (user.gameProgress && typeof user.gameProgress.lessonsCompleted === 'number') {
      gameLessonsCompleted = Math.min(6, Math.max(0, user.gameProgress.lessonsCompleted));
    } else if (progress.gameLessons) {
      gameLessonsCompleted = Object.values(progress.gameLessons).filter(l => l && l.completed === true).length;
    }

    for (let i = 1; i <= 6; i++) {
      const lessonKey = `lesson${i}`;
      const lessonProgress = progress[lessonKey] || {};
      const quiz = lessonProgress.quiz || {};
      const simulation = lessonProgress.simulation || {};
      const completed = quiz.completed && simulation.completed && simulation.passed;

      game[String(i)] = {
        completed,
        quiz: {
          completed: quiz.completed || false,
          bestScore: quiz.highestScore || quiz.bestScore || null,
          attempts: quiz.attempts || 0,
          lastAttempt: quiz.lastAttempt || null
        },
        simulation: {
          completed: simulation.completed || false,
          passed: simulation.passed || false,
          score: simulation.score || null,
          lastAttempt: simulation.lastAttempt || null
        }
      };
    }

    game.summary = {
      lessonsCompleted: gameLessonsCompleted
    };

    res.json({
      success: true,
      user: {
        uid: verifiedUid,
        email: user.email || '',
        name: user.name || user.fullName || '',
        role: user.role || '',
        demoType: user.demoType || null
      },
      lms,
      game
    });
  } catch (error) {
    console.error('Dev get demo user progress error:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/dev/demo-user/:uid/update-lesson', verifyAdminToken, async (req, res) => {
  try {
    const { uid } = req.params;
    const { system, lesson, lmsData, gameData } = req.body;

    await getDemoUserOrThrow(req, uid);

    // Validate lesson
    const lessonNum = parseInt(lesson);
    if (isNaN(lessonNum) || lessonNum < 1 || lessonNum > 6) {
      return res.status(400).json({ error: 'Lesson must be 1-6' });
    }

    const now = new Date().toISOString();
    const lessonKey = `lesson${lessonNum}`;

    if (system === 'lms') {
      const lessonRef = db.ref(`users/${uid}/lmsProgress/${lessonKey}`);
      const existingLesson = (await lessonRef.once('value')).val() || {};

      let updatedLesson = { ...existingLesson };

      // Handle pages (LMS only tracks pages and assessments, not quiz/simulation)
      if (lmsData.hasPages === true) {
        // Get real page ID if possible
        let firstPageId = '_devPage';
        try {
          const pagesSnapshot = await db.ref(`lmsLessons/${lessonNum}/pages`).once('value');
          const pages = pagesSnapshot.val() || {};
          const pageIds = Object.keys(pages);
          if (pageIds.length > 0) {
            firstPageId = pageIds[0];
          }
        } catch (e) {
          // Use default
        }
        updatedLesson.completedPages = { [firstPageId]: true };
        updatedLesson.lastAssessment = now;
      } else if (lmsData.hasPages === false) {
        updatedLesson.completedPages = {};
        // Keep lastAssessment timestamp if it exists, but clear pages
      }

      // Save the lesson
      await lessonRef.set(updatedLesson);

      // Return updated snapshot
      const updatedSnapshot = await lessonRef.once('value');
      res.json({
        success: true,
        lms: {
          [String(lessonNum)]: updatedSnapshot.val() || {}
        }
      });
    } else if (system === 'game') {
      const lessonProgressRef = db.ref(`users/${uid}/progress/${lessonKey}`);
      const gameLessonsRef = db.ref(`users/${uid}/progress/gameLessons/${lessonKey}`);

      // Handle completed shorthand
      if (gameData.completed === true) {
        // Set all fields to passing defaults
        await lessonProgressRef.update({
          quiz: {
            completed: true,
            highestScore: gameData.quizBestScore !== undefined ? Math.min(10, Math.max(0, parseInt(gameData.quizBestScore) || 8)) : 8,
            attempts: gameData.quizAttempts !== undefined ? Math.max(0, parseInt(gameData.quizAttempts) || 1) : 1,
            lastAttempt: now
          },
          simulation: {
            completed: true,
            passed: true,
            score: gameData.simulationScore !== undefined ? Math.min(100, Math.max(0, parseInt(gameData.simulationScore) || 100)) : 100,
            lastAttempt: now
          }
        });
        await gameLessonsRef.set({ completed: true });
      } else {
        // Update quiz
        if (gameData.quizCompleted !== undefined || gameData.quizBestScore !== undefined || gameData.quizAttempts !== undefined) {
          const existingQuiz = (await db.ref(`users/${uid}/progress/${lessonKey}/quiz`).once('value')).val() || {};
          await db.ref(`users/${uid}/progress/${lessonKey}/quiz`).set({
            completed: gameData.quizCompleted !== undefined ? gameData.quizCompleted : (existingQuiz.completed || false),
            highestScore: gameData.quizBestScore !== undefined ? Math.min(10, Math.max(0, parseInt(gameData.quizBestScore) || 8)) : (existingQuiz.highestScore || existingQuiz.bestScore || 8),
            attempts: gameData.quizAttempts !== undefined ? Math.max(0, parseInt(gameData.quizAttempts) || 1) : (existingQuiz.attempts || 1),
            lastAttempt: now
          });
        }

        // Update simulation
        if (gameData.simulationCompleted !== undefined || gameData.simulationPassed !== undefined || gameData.simulationScore !== undefined) {
          const existingSim = (await db.ref(`users/${uid}/progress/${lessonKey}/simulation`).once('value')).val() || {};
          await db.ref(`users/${uid}/progress/${lessonKey}/simulation`).set({
            completed: gameData.simulationCompleted !== undefined ? gameData.simulationCompleted : (existingSim.completed || false),
            passed: gameData.simulationPassed !== undefined ? gameData.simulationPassed : (existingSim.passed || false),
            score: gameData.simulationScore !== undefined ? Math.min(100, Math.max(0, parseInt(gameData.simulationScore) || 100)) : (existingSim.score || 100),
            lastAttempt: now
          });
        }

        // Update gameLessons based on completion status
        const lessonProgress = (await lessonProgressRef.once('value')).val() || {};
        const quiz = lessonProgress.quiz || {};
        const simulation = lessonProgress.simulation || {};
        const isCompleted = quiz.completed && simulation.completed && simulation.passed;

        if (isCompleted) {
          await gameLessonsRef.set({ completed: true });
        } else {
          await gameLessonsRef.remove();
        }
      }

      // Recompute total game lessons completed
      const allGameLessons = (await db.ref(`users/${uid}/progress/gameLessons`).once('value')).val() || {};
      const completedCount = Object.values(allGameLessons).filter(l => l && l.completed === true).length;
      const clampedCount = Math.min(6, Math.max(0, completedCount));

      await userRef(uid).update({ lessonsCompleted: clampedCount });
      await db.ref(`users/${uid}/gameProgress`).set({ lessonsCompleted: clampedCount });

      // Return updated snapshot
      const updatedProgress = await lessonProgressRef.once('value');
      res.json({
        success: true,
        game: {
          [String(lessonNum)]: updatedProgress.val() || {},
          summary: {
            lessonsCompleted: clampedCount
          }
        }
      });
    } else {
      return res.status(400).json({ error: 'system must be "lms" or "game"' });
    }
  } catch (error) {
    console.error('Dev update lesson error:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/dev/delete-user', verifyAdminToken, async (req, res) => {
  const isDev = req.admin?.email === 'admin@gmail.com';
  if (!isDev) return res.status(403).json({ error: 'Dev mode only' });

  try {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: 'UID is required' });

    // Delete from Auth
    try {
      await auth.deleteUser(uid);
    } catch (e) {
      console.warn(`Failed to delete auth user ${uid}:`, e.message);
      // Continue to delete from DB even if Auth delete fails (e.g. user not found)
    }

    // Delete from RTDB
    await userRef(uid).remove();

    // Also remove from admins if present
    await db.ref(`admins/${uid}`).remove();
    
    // Remove from devTools/demoUsers
    await db.ref(`devTools/demoUsers/${uid}`).remove();

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Dev delete user error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;