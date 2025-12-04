const { db } = require('../config/firebase');

const ACTIVITY_LOG_PATH = 'activityLog';
const ACTIVITY_MAX_ENTRIES = 200;

function getTimestamp(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

async function trimActivityLog() {
  try {
    const snapshot = await db.ref(ACTIVITY_LOG_PATH)
      .orderByChild('timestamp')
      .once('value');
    const entries = snapshot.val() || {};
    const keys = Object.keys(entries);
    if (keys.length <= ACTIVITY_MAX_ENTRIES) {
      return;
    }
    const keysToRemove = keys
      .sort((a, b) => new Date(entries[a].timestamp) - new Date(entries[b].timestamp))
      .slice(0, keys.length - ACTIVITY_MAX_ENTRIES);
    const updates = {};
    keysToRemove.forEach(key => {
      updates[key] = null;
    });
    if (Object.keys(updates).length > 0) {
      await db.ref(ACTIVITY_LOG_PATH).update(updates);
    }
  } catch (error) {
    console.error('Failed to trim activity log:', error.message);
  }
}

async function logActivity(event) {
  try {
    const payload = {
      type: event.type || 'system',
      action: event.action || '',
      description: event.description || '',
      actorType: event.actorType || 'system',
      actorId: event.actorId || null,
      actorName: event.actorName || 'System',
      relatedLesson: event.relatedLesson || null,
      metadata: event.metadata || {},
      timestamp: getTimestamp(event.timestamp)
    };
    const ref = db.ref(ACTIVITY_LOG_PATH).push();
    await ref.set(payload);
    trimActivityLog();
  } catch (error) {
    console.error('Failed to log activity:', error.message);
  }
}

module.exports = { logActivity };









