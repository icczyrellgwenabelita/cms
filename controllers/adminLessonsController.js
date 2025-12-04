const { db, bucket, storageBucketName } = require('../config/firebase');

const MAX_MODEL_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const sanitizeFileName = (name = '', fallbackExt = '.glb') => {
  const safeName =
    name
      .trim()
      .replace(/[^\w.\-]/g, '_')
      .substring(0, 120) || 'model';
  if (safeName.includes('.')) {
    return safeName;
  }
  const normalizedExt = fallbackExt
    ? fallbackExt.startsWith('.')
      ? fallbackExt
      : `.${fallbackExt}`
    : '.glb';
  return `${safeName}${normalizedExt}`;
};

const decodeBase64File = (dataUrl = '', fallbackContentType = 'application/octet-stream') => {
  const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matches) {
    return {
      buffer: Buffer.from(dataUrl, 'base64'),
      contentType: fallbackContentType,
    };
  }
  return {
    buffer: Buffer.from(matches[2], 'base64'),
    contentType: matches[1] || fallbackContentType,
  };
};

const formatLesson = (slot, lesson) => ({
  slot,
  lessonTitle: lesson.lessonTitle || lesson.lessonName || '',
  lessonName: lesson.lessonName || lesson.lessonTitle || '',
  description: lesson.description || lesson.lessonDescription || '',
  lessonDescription: lesson.lessonDescription || lesson.description || '',
  body: lesson.body || '',
  images: lesson.images || [],
  tools: lesson.tools || {},
  createdAt: lesson.createdAt,
  updatedAt: lesson.updatedAt,
});

exports.getLessons = async (req, res) => {
  try {
    const lessonsSnapshot = await db.ref('lessons').once('value');
    const lessonsData = lessonsSnapshot.val() || {};

    const lessons = Object.entries(lessonsData)
      .filter(([key, lesson]) => {
        const slot = parseInt(key, 10);
        return !Number.isNaN(slot) && lesson && (lesson.lessonTitle || lesson.lessonName);
      })
      .map(([key, lesson]) => formatLesson(parseInt(key, 10), lesson))
      .sort((a, b) => a.slot - b.slot);

    res.json({ success: true, lessons });
  } catch (error) {
    console.error('Get lessons error:', error);
    res.status(500).json({ error: 'Failed to fetch lessons' });
  }
};

exports.updateLesson = async (req, res) => {
  try {
    const slot = parseInt(req.params.slot, 10);
    if (Number.isNaN(slot) || slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }

    const {
      lessonTitle,
      lessonName,
      description,
      lessonDescription,
      body,
      images,
      tools,
    } = req.body;

    const finalTitle =
      lessonTitle !== undefined ? lessonTitle : lessonName !== undefined ? lessonName : '';
    const finalDescription =
      description !== undefined
        ? description
        : lessonDescription !== undefined
          ? lessonDescription
          : '';

    if (!finalTitle && !finalDescription) {
      return res.status(400).json({ error: 'Lesson title or description required' });
    }

    const lessonRef = db.ref(`lessons/${slot}`);
    const snapshot = await lessonRef.once('value');
    const existing = snapshot.val() || {};
    const existingQuestions = existing.questions || {};

    const updateData = {
      slot,
      lessonTitle: finalTitle,
      lessonName: finalTitle,
      description: finalDescription,
      lessonDescription: finalDescription,
      updatedAt: new Date().toISOString(),
    };

    if (body !== undefined) {
      updateData.body = body;
    } else if (existing.body !== undefined) {
      updateData.body = existing.body;
    }

    if (images !== undefined) {
      updateData.images = Array.isArray(images) ? images : [];
    } else if (existing.images !== undefined) {
      updateData.images = existing.images;
    } else {
      updateData.images = [];
    }

    if (tools !== undefined) {
      updateData.tools = tools || {};
    } else if (existing.tools !== undefined) {
      updateData.tools = existing.tools;
    } else {
      updateData.tools = {};
    }

    if (Object.keys(existingQuestions).length > 0) {
      updateData.questions = existingQuestions;
    }

    if (!existing.createdAt) {
      updateData.createdAt = new Date().toISOString();
    } else {
      updateData.createdAt = existing.createdAt;
    }

    await lessonRef.set(updateData);

    res.json({
      success: true,
      message: 'Lesson updated successfully',
      lesson: updateData,
    });
  } catch (error) {
    console.error('Update lesson error:', error);
    res.status(500).json({ error: 'Failed to update lesson' });
  }
};

/*
 * 3D Model functions temporarily disabled as per feature simplification request.
 * 
 * exports.uploadToolModel = async (req, res) => {
 *   // ... (original 3D upload logic)
 * };
 * 
 * exports.deleteToolModel = async (req, res) => {
 *   // ... (original 3D delete logic)
 * };
 */

