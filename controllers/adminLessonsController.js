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

exports.uploadToolModel = async (req, res) => {
  try {
    if (!bucket || !storageBucketName) {
      return res.status(503).json({
        error: '3D model uploads are temporarily unavailable. Configure FIREBASE_STORAGE_BUCKET to enable this feature.',
      });
    }

    const slot = parseInt(req.params.slot, 10);
    const { toolId } = req.params;
    const { fileName, contentType, data } = req.body || {};

    if (Number.isNaN(slot) || slot < 1) {
      return res.status(400).json({ error: 'Invalid lesson slot' });
    }

    if (!toolId || !fileName || !data) {
      return res.status(400).json({ error: 'toolId, fileName, and data are required' });
    }

    // Validate slot and toolId exist
    const lessonRef = db.ref(`lessons/${slot}`);
    const lessonSnapshot = await lessonRef.once('value');
    if (!lessonSnapshot.exists()) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const lessonData = lessonSnapshot.val() || {};
    const tools = lessonData.tools || {};
    if (!tools[toolId]) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    const existingTool = tools[toolId];
    let oldStoragePath = existingTool.storagePath || existingTool.modelStoragePath || null;

    const dataString = data.startsWith('data:')
      ? data
      : `data:${contentType || 'application/octet-stream'};base64,${data}`;

    const { buffer, contentType: inferredType } = decodeBase64File(
      dataString,
      contentType || 'application/octet-stream',
    );

    if (buffer.length > MAX_MODEL_FILE_SIZE) {
      return res.status(413).json({ error: '3D model file is too large (max 50MB)' });
    }

    const extensionMatch = fileName.match(/\.[^/.]+$/);
    const originalExtension = extensionMatch ? extensionMatch[0] : '';
    const safeFileName = sanitizeFileName(fileName, originalExtension || '.glb');
    const storagePath = `tools/${slot}/${toolId}/model/${Date.now()}-${safeFileName}`;
    const file = bucket.file(storagePath);

    // Upload new file FIRST
    await file.save(buffer, {
      contentType: contentType || inferredType || 'application/octet-stream',
      resumable: false,
      metadata: {
        cacheControl: 'public,max-age=31536000',
      },
    });

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: '01-01-2100',
    });

    // Update DB with new model metadata
    const updatedTool = {
      ...existingTool,
      modelUrl: signedUrl,
      modelType: (originalExtension.replace('.', '') || 'glb').toLowerCase(),
      storagePath: storagePath,
      fileName: safeFileName,
      contentType: contentType || inferredType || 'application/octet-stream',
    };

    await lessonRef.child(`tools/${toolId}`).update(updatedTool);

    // THEN delete old model file (best effort, no crash if missing)
    if (oldStoragePath) {
      try {
        const oldFile = bucket.file(oldStoragePath);
        const [exists] = await oldFile.exists();
        if (exists) {
          await oldFile.delete();
        }
      } catch (deleteError) {
        // Log but don't fail the request
        console.warn('Failed to delete old model file:', oldStoragePath, deleteError.message);
      }
    }

    res.json({
      success: true,
      modelUrl: signedUrl,
      storagePath,
      fileName: safeFileName,
      contentType: contentType || inferredType || 'application/octet-stream',
      fileSize: buffer.length,
    });
  } catch (error) {
    console.error('Upload tool model error:', error);
    res.status(500).json({ error: 'Failed to upload 3D model' });
  }
};

exports.deleteToolModel = async (req, res) => {
  try {
    if (!bucket || !storageBucketName) {
      return res.status(503).json({
        error: '3D model deletion is temporarily unavailable. Configure FIREBASE_STORAGE_BUCKET to enable this feature.',
      });
    }

    const slot = parseInt(req.params.slot, 10);
    const { toolId } = req.params;

    if (Number.isNaN(slot) || slot < 1) {
      return res.status(400).json({ error: 'Invalid lesson slot' });
    }

    if (!toolId) {
      return res.status(400).json({ error: 'toolId is required' });
    }

    // Validate slot and toolId exist
    const lessonRef = db.ref(`lessons/${slot}`);
    const lessonSnapshot = await lessonRef.once('value');
    if (!lessonSnapshot.exists()) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const lessonData = lessonSnapshot.val() || {};
    const tools = lessonData.tools || {};
    if (!tools[toolId]) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    const tool = tools[toolId];
    const storagePath = tool.storagePath || tool.modelStoragePath;

    // Delete file from storage if it exists (best effort)
    if (storagePath) {
      try {
        const file = bucket.file(storagePath);
        const [exists] = await file.exists();
        if (exists) {
          await file.delete();
        }
      } catch (deleteError) {
        // Log but don't fail the request if file already missing
        console.warn('Failed to delete model file (may already be deleted):', storagePath, deleteError.message);
      }
    }

    // Remove model fields from tool in database
    const updatedTool = { ...tool };
    delete updatedTool.modelUrl;
    delete updatedTool.modelType;
    delete updatedTool.storagePath;
    delete updatedTool.modelStoragePath;
    delete updatedTool.fileName;
    delete updatedTool.modelFileName;
    delete updatedTool.contentType;
    delete updatedTool.modelContentType;

    await lessonRef.child(`tools/${toolId}`).update(updatedTool);

    res.json({
      success: true,
      message: '3D model deleted successfully',
    });
  } catch (error) {
    console.error('Delete tool model error:', error);
    res.status(500).json({ error: 'Failed to delete 3D model' });
  }
};

