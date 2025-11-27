const express = require('express');
const router = express.Router();
const { verifyAdminToken } = require('../middleware/auth');
const { db, auth } = require('../config/firebase');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logActivity } = require('../utils/activityLogger');
const { sendEmail, isEmailConfigured } = require('../utils/email');

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
  const base = process.env.PUBLIC_HOST || 'http://localhost:3000';
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
  const [primarySnap, legacySnap] = await Promise.all([
    usersRef().once('value').catch(() => null),
    legacyUsersRef().once('value').catch(() => null)
  ]);
  const primary = (primarySnap && primarySnap.val()) || {};
  const legacy = (legacySnap && legacySnap.val()) || {};
  // Merge so that canonical /users overrides legacy /system/users when keys collide
  return { ...legacy, ...primary };
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
    const snapshot = await usersRef().once('value');
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

module.exports = router;