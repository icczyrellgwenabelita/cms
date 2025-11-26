const express = require('express');
const router = express.Router();
const { verifyAdminToken } = require('../middleware/auth');
const { db, auth } = require('../config/firebase');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { logActivity } = require('../utils/activityLogger');
const { sendEmail } = require('../utils/email');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const ONLINE_THRESHOLD_MINUTES = 10;
let backupInProgress = false;
let restoreInProgress = false;
const USERS_COLLECTION = 'system/users';
const LEGACY_USERS_COLLECTION = 'users';

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

ensureBackupDir();

const usersRef = () => db.ref(USERS_COLLECTION);
const legacyUsersRef = () => db.ref(LEGACY_USERS_COLLECTION);
const userRef = (uid) => db.ref(`${USERS_COLLECTION}/${uid}`);
const legacyUserRef = (uid) => db.ref(`${LEGACY_USERS_COLLECTION}/${uid}`);

function normalizeStudentInfo(info = {}) {
  return {
    studentNumber: info.studentNumber || '',
    batch: info.batch || '',
    contactNumber: info.contactNumber || '',
    birthday: info.birthday || '',
    address: info.address || ''
  };
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
    birthday: data.birthday || data.studentInfo?.birthday || ''
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
  await legacyUserRef(uid).set(baseData);

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
  // Merge so that primary (/system/users) overrides legacy (/users) when keys collide
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
      ...data,
      verified: true,
      active: true,
      inviteStatus: 'completed',
      updatedAt: new Date().toISOString()
    };
    await userRef(uid).set(updates);
    await legacyUserRef(uid).set(updates);
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
    const now = new Date();
    const inviteCreatedAt = now.toISOString();
    const inviteExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const updated = {
      ...data,
      inviteStatus: 'pending',
      inviteCreatedAt,
      inviteExpiresAt
    };
    await userRef(uid).set(updated);
    await legacyUserRef(uid).set(updated);
    const link = await auth.generatePasswordResetLink(data.email, {
      url: process.env.PUBLIC_HOST
        ? `${process.env.PUBLIC_HOST}/create-password`
        : 'http://localhost:3000/create-password',
      handleCodeInApp: true
    });

    await sendEmail({
      to: data.email,
      subject: 'CareSim - Password Invite Link',
      text: `Hello ${data.fullName || data.name || ''},\n\nHere is your updated link to set your CareSim password:\n\n${link}\n\nThis link will expire in 24 hours.\n\nIf you did not expect this email, you can ignore it.`,
      html: `<p>Hello ${data.fullName || data.name || ''},</p>
             <p>Here is your updated link to set your <strong>CareSim</strong> password.</p>
             <p>This link will expire in 24 hours.</p>
             <p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#2563EB;color:#ffffff;text-decoration:none;border-radius:6px;">Set Your Password</a></p>
             <p>If the button does not work, copy and paste this URL into your browser:</p>
             <p><a href="${link}">${link}</a></p>`
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Resend invite error:', error);
    res.status(500).json({ error: 'Failed to resend invite' });
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

    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        const tempPassword = Math.random().toString(36).slice(-10) + 'Aa1!';
        userRecord = await auth.createUser({
          email,
          password: tempPassword,
          displayName: name,
          emailVerified: false
        });
      } else {
        throw err;
      }
    }

    const uid = userRecord.uid;
    const now = new Date();
    const inviteCreatedAt = now.toISOString();
    const inviteExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    const normalizedStudentInfo = normalizeStudentInfo(studentInfo);
    const userPayload = {
      uid,
      name,
      fullName: name,
      email,
      role: 'student',
      verified: false,
      active: false,
      inviteStatus: 'pending',
      inviteCreatedAt,
      inviteExpiresAt,
      studentInfo: normalizedStudentInfo,
      updatedAt: inviteCreatedAt,
      createdAt: userRecord.metadata?.creationTime || inviteCreatedAt,
      progress: {}
    };

    await userRef(uid).set(userPayload);
    await legacyUserRef(uid).set(userPayload);

    const link = await auth.generatePasswordResetLink(email, {
      url: process.env.PUBLIC_HOST
        ? `${process.env.PUBLIC_HOST}/create-password`
        : 'http://localhost:3000/create-password',
      handleCodeInApp: true
    });

    await sendEmail({
      to: email,
      subject: 'CareSim - Set Your Password',
      text: `Hello ${name},\n\nYou have been invited to CareSim as a student. Please click the link below to set your password:\n\n${link}\n\nThis link will expire in 24 hours.\n\nIf you did not expect this email, you can ignore it.`,
      html: `<p>Hello ${name},</p>
             <p>You have been invited to <strong>CareSim</strong> as a student.</p>
             <p>Please click the button below to set your password. This link will expire in 24 hours.</p>
             <p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#2563EB;color:#ffffff;text-decoration:none;border-radius:6px;">Set Your Password</a></p>
             <p>If the button does not work, copy and paste this URL into your browser:</p>
             <p><a href="${link}">${link}</a></p>
             <p>If you did not expect this email, you can ignore it.</p>`
    });

    await logActivity({
      type: 'auth',
      action: 'student_invited',
      description: 'Student invited to set password',
      actorType: 'admin',
      actorId: req.admin?.adminId || null,
      actorName: req.admin?.email || 'Admin',
      metadata: { uid, email }
    });

    res.json({ success: true, uid });
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
      birthday,
      address,
      contactNumber,
      assignedInstructor
    } = req.body || {};

    if (!uid || !studentNumber || !batch || !birthday || !address || !assignedInstructor) {
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
      studentInfo,
      assignedInstructor,
      contactNumber,
      address,
      birthday,
      archived
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

    if (archived !== undefined) {
      updatedData.archived = archived;
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
  res.status(410).json({ error: 'User status toggling is no longer supported' });
});

/**
 * GET /api/admin/instructors
 * Returns list of all instructors for dropdown/selection
 */
router.get('/instructors', verifyAdminToken, async (req, res) => {
  try {
    const adminsRef = db.ref('admins');
    const snapshot = await adminsRef.once('value');
    const adminsData = snapshot.val() || {};
    
    const instructors = [];
    for (const [id, admin] of Object.entries(adminsData)) {
      if (admin && (admin.role === 'instructor' || admin.role === 'admin')) {
        instructors.push({
          id,
          name: admin.name || '',
          email: admin.email || '',
          role: admin.role || 'instructor',
          department: admin.department || ''
        });
      }
    }
    
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

router.get('/quizzes/:lesson', verifyAdminToken, async (req, res) => {
  try {
    const lesson = parseInt(req.params.lesson);
    console.log(`Admin: Fetching quizzes for lesson ${lesson}`);
    
    if (isNaN(lesson) || lesson < 1 || lesson > 6) {
      return res.status(400).json({ error: 'Invalid lesson number (1-6)' });
    }
    const questionsRef = db.ref(`lessons/lesson${lesson}/questions`);
    const snapshot = await questionsRef.once('value');
    let questions = snapshot.val() || {};
    
    console.log(`Admin: Raw questions data for lesson ${lesson}:`, JSON.stringify(questions, null, 2));
    console.log(`Admin: Questions keys:`, questions ? Object.keys(questions) : 'none');
    const quizzesArray = [];
    for (let i = 0; i < 10; i++) {
      const questionData = questions[i];
      const slot = i + 1;
      
      if (questionData) {
        const choices = questionData.choices || [];
        const correctIndex = questionData.correctIndex !== undefined ? questionData.correctIndex : -1;
        const correctAnswer = correctIndex >= 0 && correctIndex <= 3 ? ['A', 'B', 'C', 'D'][correctIndex] : '';
        
        console.log(`Admin: Processing question ${i}:`, {
          questionText: questionData.questionText,
          choices: choices,
          correctIndex: correctIndex,
          correctAnswer: correctAnswer
        });
        
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
    console.log(`Admin: Returning ${quizzesArray.length} quizzes for lesson ${lesson}`);
    res.json({ success: true, lesson: lesson, quizzes: quizzesArray });
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
router.put('/quizzes/:lesson/:slot', verifyAdminToken, async (req, res) => {
  try {
    const lesson = parseInt(req.params.lesson);
    const slot = parseInt(req.params.slot);
    
    if (lesson < 1 || lesson > 6) {
      return res.status(400).json({ error: 'Invalid lesson number (1-6)' });
    }
    if (slot < 1 || slot > 10) {
      return res.status(400).json({ error: 'Invalid quiz slot number (1-10)' });
    }
    const { question, answerA, answerB, answerC, answerD, correctAnswer, explanation } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }
    const questionIndex = slot - 1;
    const correctIndexMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
    const correctIndex = correctIndexMap[correctAnswer] !== undefined ? correctIndexMap[correctAnswer] : -1;
    
    const choices = [
      answerA || '',
      answerB || '',
      answerC || '',
      answerD || ''
    ];
    const questionRef = db.ref(`lessons/lesson${lesson}/questions/${questionIndex}`);
    const snapshot = await questionRef.once('value');
    const existing = snapshot.val() || {};
    await questionRef.set({
      questionText: question || existing.questionText || '',
      choices: choices,
      correctIndex: correctIndex !== -1 ? correctIndex : (existing.correctIndex !== undefined ? existing.correctIndex : 0),
      explanation: explanation !== undefined ? explanation : (existing.explanation || ''),
      updatedAt: new Date().toISOString()
    });
    res.json({ success: true, message: 'Quiz updated successfully' });
  } catch (error) {
    console.error('Update quiz error:', error);
    res.status(500).json({ error: 'Failed to update quiz' });
  }
});
module.exports = router;