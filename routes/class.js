const express = require('express');
const router = express.Router();
const { verifyStudentToken, verifyInstructorToken, verifyStudentOrInstructorToken } = require('../middleware/auth');
const { db, bucket } = require('../config/firebase');
const multer = require('multer');
const crypto = require('crypto');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

const USERS_COLLECTION = 'users';

// ============================================
// Helper Functions
// ============================================

async function getUserRole(userId) {
  try {
    const userRef = db.ref(`${USERS_COLLECTION}/${userId}`);
    const userSnapshot = await userRef.once('value');
    const userData = userSnapshot.val();
    
    if (userData && userData.role) {
      return userData.role.toLowerCase();
    }
    
    // Check if it's an admin/instructor
    const adminRef = db.ref(`admins/${userId}`);
    const adminSnapshot = await adminRef.once('value');
    const adminData = adminSnapshot.val();
    
    if (adminData) {
      return (adminData.role || 'instructor').toLowerCase();
    }
    
    return null;
  } catch (error) {
    console.error('Error getting user role:', error);
    return null;
  }
}

async function getStudentClassId(userId) {
  try {
    const userRef = db.ref(`${USERS_COLLECTION}/${userId}`);
    const userSnapshot = await userRef.once('value');
    const userData = userSnapshot.val();
    
    if (userData && userData.classId) {
      return userData.classId;
    }
    
    // Check legacy students path
    const studentRef = db.ref(`students/${userId}`);
    const studentSnapshot = await studentRef.once('value');
    const studentData = studentSnapshot.val();
    
    if (studentData && studentData.classId) {
      return studentData.classId;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting student classId:', error);
    return null;
  }
}

async function ensureInstructorOwnsClass(instructorId, classId) {
  try {
    const classRef = db.ref(`classes/${classId}`);
    const classSnapshot = await classRef.once('value');
    const classData = classSnapshot.val();
    
    if (!classData) {
      return { valid: false, error: 'Class not found' };
    }
    
    if (classData.instructorId !== instructorId) {
      return { valid: false, error: 'Instructor does not own this class' };
    }
    
    return { valid: true, classData };
  } catch (error) {
    console.error('Error checking class ownership:', error);
    return { valid: false, error: error.message };
  }
}

async function ensureStudentBelongsToClass(studentId, classId) {
  try {
    const studentClassId = await getStudentClassId(studentId);
    if (studentClassId !== classId) {
      return { valid: false, error: 'Student does not belong to this class' };
    }
    return { valid: true };
  } catch (error) {
    console.error('Error checking student class membership:', error);
    return { valid: false, error: error.message };
  }
}

// ============================================
// Class Lookup (Shared)
// ============================================

router.get('/me', verifyStudentOrInstructorToken, async (req, res) => {
  try {
    const userId = req.userId;
    const role = await getUserRole(userId);
    
    if (role === 'student') {
      let classId = await getStudentClassId(userId);
      
      // If no classId but student has assignedInstructor, try to find or create class
      if (!classId) {
        const userRef = db.ref(`${USERS_COLLECTION}/${userId}`);
        const userSnapshot = await userRef.once('value');
        const userData = userSnapshot.val() || {};
        const assignedInstructor = userData.assignedInstructor;
        
        if (assignedInstructor) {
          // Try to find existing class for this instructor
          const classesRef = db.ref('classes');
          const classesSnapshot = await classesRef.once('value');
          const classesData = classesSnapshot.val() || {};
          
          // Find first class where instructorId matches
          for (const [existingClassId, classData] of Object.entries(classesData)) {
            if (classData && classData.instructorId === assignedInstructor) {
              classId = existingClassId;
              // Auto-assign student to this class
              await userRef.update({ classId: existingClassId });
              // Add student to class membership
              await db.ref(`classes/${existingClassId}/studentIds/${userId}`).set(true);
              break;
            }
          }
          
          // If still no class found, create one automatically
          if (!classId) {
            // Get instructor info
            const instructorRef = db.ref(`admins/${assignedInstructor}`);
            const instructorSnapshot = await instructorRef.once('value');
            const instructorData = instructorSnapshot.val() || {};
            const instructorName = instructorData.name || instructorData.fullName || 'Instructor';
            
            // Get student info for batch/course
            const studentInfo = userData.studentInfo || {};
            const batchYear = studentInfo.batch || new Date().getFullYear();
            const courseName = 'Caregiving NC II'; // Default course name
            
            // Create class
            classId = `class_${assignedInstructor}_${batchYear}_${Date.now()}`;
            const now = new Date().toISOString();
            
            const classData = {
              classId,
              instructorId: assignedInstructor,
              name: `${courseName} – Batch ${batchYear}`,
              courseName,
              batchYear: Number(batchYear) || new Date().getFullYear(),
              createdAt: now,
              updatedAt: now,
              studentIds: { [userId]: true }
            };
            
            await db.ref(`classes/${classId}`).set(classData);
            await userRef.update({ classId });
          }
        }
      }
      
      if (!classId) {
        return res.json({
          success: false,
          message: 'No class assigned',
          class: null
        });
      }
      
      const classRef = db.ref(`classes/${classId}`);
      const classSnapshot = await classRef.once('value');
      const classData = classSnapshot.val();
      
      if (!classData) {
        return res.json({
          success: false,
          message: 'Class not found',
          class: null
        });
      }
      
      return res.json({
        success: true,
        class: classData
      });
    } else if (role === 'instructor' || role === 'admin') {
      // For instructors, use instructorId from req (set by verifyStudentOrInstructorToken)
      const instructorId = req.instructorId || userId;
      
      // For MVP, find first class where instructorId matches
      const classesRef = db.ref('classes');
      const classesSnapshot = await classesRef.once('value');
      const classesData = classesSnapshot.val() || {};
      
      const instructorClasses = [];
      for (const [classId, classData] of Object.entries(classesData)) {
        if (classData && classData.instructorId === instructorId) {
          instructorClasses.push({ classId, ...classData });
        }
      }
      
      if (instructorClasses.length === 0) {
        return res.json({
          success: false,
          message: 'No class found for instructor',
          class: null
        });
      }
      
      // Return first class for MVP
      return res.json({
        success: true,
        class: instructorClasses[0]
      });
    }
    
    return res.status(403).json({
      success: false,
      error: 'Unauthorized role'
    });
  } catch (error) {
    console.error('Error in GET /api/class/me:', error);
    res.status(500).json({ error: 'Failed to get class information' });
  }
});

// ============================================
// Class Posts - Instructor
// ============================================

router.post('/:classId/posts', verifyInstructorToken, upload.single('file'), async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { classId } = req.params;
    
    // Verify ownership
    const ownershipCheck = await ensureInstructorOwnsClass(instructorId, classId);
    if (!ownershipCheck.valid) {
      return res.status(403).json({ error: ownershipCheck.error });
    }
    
    const { type, title, body, linkUrl, dueDate, maxScore } = req.body;
    
    if (!type || !title || !body) {
      return res.status(400).json({ error: 'Type, title, and body are required' });
    }
    
    if (!['announcement', 'material', 'task', 'message'].includes(type)) {
      return res.status(400).json({ error: 'Invalid post type' });
    }
    
    // Get instructor name
    const instructorRef = db.ref(`admins/${instructorId}`);
    const instructorSnapshot = await instructorRef.once('value');
    const instructorData = instructorSnapshot.val() || {};
    const instructorName = instructorData.name || instructorData.fullName || 'Instructor';
    
    const postId = `post_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    
    let attachmentUrl = null;
    let attachmentName = null;
    let attachmentStoragePath = null;
    
    // Handle file upload if present
    if (req.file && (type === 'material' || type === 'task')) {
      if (!bucket) {
        return res.status(503).json({ error: 'Storage bucket not configured' });
      }
      
      const originalName = req.file.originalname || 'file';
      const extMatch = originalName.match(/\.(\w+)$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : '';
      const fileName = `${postId}_${Date.now()}.${ext}`;
      const filePath = `classMaterials/${classId}/${postId}/${fileName}`;
      
      const file = bucket.file(filePath);
      await file.save(req.file.buffer, {
        contentType: req.file.mimetype || 'application/octet-stream',
        resumable: false
      });
      
      await file.makePublic();
      attachmentUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(filePath)}`;
      attachmentName = originalName;
      attachmentStoragePath = filePath;
    }
    
    const postData = {
      postId,
      classId,
      type,
      title,
      body,
      linkUrl: linkUrl || null,
      attachmentUrl,
      attachmentName,
      attachmentStoragePath,
      taskMeta: type === 'task' ? {
        dueDate: dueDate || null,
        maxScore: maxScore ? Number(maxScore) : null
      } : null,
      createdBy: instructorId,
      createdByName: instructorName,
      createdAt: now,
      updatedAt: now
    };
    
    const postRef = db.ref(`classPosts/${classId}/${postId}`);
    await postRef.set(postData);
    
    res.json({
      success: true,
      post: postData
    });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

router.put('/:classId/posts/:postId', verifyInstructorToken, upload.single('file'), async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { classId, postId } = req.params;
    
    // Verify ownership
    const ownershipCheck = await ensureInstructorOwnsClass(instructorId, classId);
    if (!ownershipCheck.valid) {
      return res.status(403).json({ error: ownershipCheck.error });
    }
    
    // Get existing post
    const postRef = db.ref(`classPosts/${classId}/${postId}`);
    const postSnapshot = await postRef.once('value');
    const existingPost = postSnapshot.val();
    
    if (!existingPost) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    const { title, body, linkUrl, dueDate, maxScore } = req.body;
    
    const updates = {
      updatedAt: new Date().toISOString()
    };
    
    if (title !== undefined) updates.title = title;
    if (body !== undefined) updates.body = body;
    if (linkUrl !== undefined) updates.linkUrl = linkUrl || null;
    
    if (existingPost.type === 'task') {
      updates.taskMeta = {
        dueDate: dueDate || existingPost.taskMeta?.dueDate || null,
        maxScore: maxScore ? Number(maxScore) : existingPost.taskMeta?.maxScore || null
      };
    }
    
    // Handle file replacement if new file uploaded
    if (req.file && (existingPost.type === 'material' || existingPost.type === 'task')) {
      // Delete old file if exists
      if (existingPost.attachmentStoragePath && bucket) {
        try {
          const oldFile = bucket.file(existingPost.attachmentStoragePath);
          await oldFile.delete();
        } catch (err) {
          console.warn('Could not delete old file:', err);
        }
      }
      
      // Upload new file
      if (!bucket) {
        return res.status(503).json({ error: 'Storage bucket not configured' });
      }
      
      const originalName = req.file.originalname || 'file';
      const extMatch = originalName.match(/\.(\w+)$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : '';
      const fileName = `${postId}_${Date.now()}.${ext}`;
      const filePath = `classMaterials/${classId}/${postId}/${fileName}`;
      
      const file = bucket.file(filePath);
      await file.save(req.file.buffer, {
        contentType: req.file.mimetype || 'application/octet-stream',
        resumable: false
      });
      
      await file.makePublic();
      updates.attachmentUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(filePath)}`;
      updates.attachmentName = originalName;
      updates.attachmentStoragePath = filePath;
    }
    
    await postRef.update(updates);
    
    const updatedPost = (await postRef.once('value')).val();
    
    res.json({
      success: true,
      post: updatedPost
    });
  } catch (error) {
    console.error('Error updating post:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

router.delete('/:classId/posts/:postId', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { classId, postId } = req.params;
    
    // Verify ownership
    const ownershipCheck = await ensureInstructorOwnsClass(instructorId, classId);
    if (!ownershipCheck.valid) {
      return res.status(403).json({ error: ownershipCheck.error });
    }
    
    // Get post to check for attachments
    const postRef = db.ref(`classPosts/${classId}/${postId}`);
    const postSnapshot = await postRef.once('value');
    const postData = postSnapshot.val();
    
    if (!postData) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Delete all attachments (handle both old single attachment and new array format)
    if (bucket) {
      const attachmentsToDelete = [];
      
      // Check for new attachments array format
      if (Array.isArray(postData.attachments)) {
        postData.attachments.forEach(att => {
          if (att.storagePath) {
            attachmentsToDelete.push(att.storagePath);
          }
        });
      }
      
      // Check for legacy single attachment
      if (postData.attachmentStoragePath) {
        attachmentsToDelete.push(postData.attachmentStoragePath);
      }
      
      // Delete all attachment files
      for (const storagePath of attachmentsToDelete) {
        try {
          const file = bucket.file(storagePath);
          await file.delete();
        } catch (err) {
          console.warn(`Could not delete attachment ${storagePath}:`, err);
        }
      }
    }
    
    // Delete post
    await postRef.remove();
    
    // Delete comments
    const commentsRef = db.ref(`classPostComments/${classId}/${postId}`);
    await commentsRef.remove();
    
    // Delete submissions (and their attachment files)
    const submissionsRef = db.ref(`classTaskSubmissions/${classId}/${postId}`);
    const submissionsSnapshot = await submissionsRef.once('value');
    const submissions = submissionsSnapshot.val() || {};
    
    // Delete submission attachment files
    if (bucket) {
      for (const [studentId, submission] of Object.entries(submissions)) {
        if (submission && submission.attachmentStoragePath) {
          try {
            const file = bucket.file(submission.attachmentStoragePath);
            await file.delete();
          } catch (err) {
            console.warn(`Could not delete submission file for ${studentId}:`, err);
          }
        }
      }
    }
    
    await submissionsRef.remove();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

/**
 * GET /api/class/:classId/posts/:postId/deletion-info
 * Get information about what will be deleted (for confirmation dialog)
 */
router.get('/:classId/posts/:postId/deletion-info', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { classId, postId } = req.params;
    
    // Verify ownership
    const ownershipCheck = await ensureInstructorOwnsClass(instructorId, classId);
    if (!ownershipCheck.valid) {
      return res.status(403).json({ error: ownershipCheck.error });
    }
    
    // Get post
    const postRef = db.ref(`classPosts/${classId}/${postId}`);
    const postSnapshot = await postRef.once('value');
    const postData = postSnapshot.val();
    
    if (!postData) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Count comments
    const commentsRef = db.ref(`classPostComments/${classId}/${postId}`);
    const commentsSnapshot = await commentsRef.once('value');
    const comments = commentsSnapshot.val() || {};
    const commentCount = Object.keys(comments).length;
    
    // Count submissions
    const submissionsRef = db.ref(`classTaskSubmissions/${classId}/${postId}`);
    const submissionsSnapshot = await submissionsRef.once('value');
    const submissions = submissionsSnapshot.val() || {};
    const submissionCount = Object.keys(submissions).length;
    
    // Count attachments
    let attachmentCount = 0;
    if (Array.isArray(postData.attachments)) {
      attachmentCount = postData.attachments.length;
    } else if (postData.attachmentUrl || postData.attachmentStoragePath) {
      attachmentCount = 1;
    }
    
    res.json({
      success: true,
      deletionInfo: {
        postTitle: postData.title || 'Untitled Post',
        postType: postData.type || 'post',
        commentCount,
        submissionCount,
        attachmentCount
      }
    });
  } catch (error) {
    console.error('Error getting deletion info:', error);
    res.status(500).json({ error: 'Failed to get deletion info' });
  }
});

/**
 * PATCH /api/class/:classId/posts/:postId/archive
 * Archive or unarchive a post
 */
router.patch('/:classId/posts/:postId/archive', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { classId, postId } = req.params;
    const { archived } = req.body;
    
    // Verify ownership
    const ownershipCheck = await ensureInstructorOwnsClass(instructorId, classId);
    if (!ownershipCheck.valid) {
      return res.status(403).json({ error: ownershipCheck.error });
    }
    
    // Get existing post
    const postRef = db.ref(`classPosts/${classId}/${postId}`);
    const postSnapshot = await postRef.once('value');
    const existingPost = postSnapshot.val();
    
    if (!existingPost) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Update archived status
    await postRef.update({
      archived: archived === true || archived === 'true',
      updatedAt: new Date().toISOString()
    });
    
    const updatedPost = (await postRef.once('value')).val();
    
    res.json({
      success: true,
      post: updatedPost
    });
  } catch (error) {
    console.error('Error archiving post:', error);
    res.status(500).json({ error: 'Failed to archive post' });
  }
});

// ============================================
// Class Posts - Shared (Students + Instructor)
// ============================================

router.get('/:classId/posts', async (req, res) => {
  try {
    const { classId } = req.params;
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    // Try student token first
    let userId = null;
    let role = null;
    
    try {
      const { verifyStudentToken } = require('../middleware/auth');
      // We'll manually verify since we need to check both
      const { auth } = require('../config/firebase');
      const decodedToken = await auth.verifyIdToken(token);
      userId = decodedToken.uid;
      role = await getUserRole(userId);
      
      if (role === 'student') {
        const membershipCheck = await ensureStudentBelongsToClass(userId, classId);
        if (!membershipCheck.valid) {
          return res.status(403).json({ error: membershipCheck.error });
        }
      } else if (role === 'instructor' || role === 'admin') {
        const ownershipCheck = await ensureInstructorOwnsClass(userId, classId);
        if (!ownershipCheck.valid) {
          return res.status(403).json({ error: ownershipCheck.error });
        }
      } else {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    } catch (err) {
      // Try instructor token
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.adminId;
        role = await getUserRole(userId);
        
        if (role === 'instructor' || role === 'admin') {
          const ownershipCheck = await ensureInstructorOwnsClass(userId, classId);
          if (!ownershipCheck.valid) {
            return res.status(403).json({ error: ownershipCheck.error });
          }
        } else {
          return res.status(403).json({ error: 'Unauthorized' });
        }
      } catch (jwtErr) {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }
    
    const postsRef = db.ref(`classPosts/${classId}`);
    const postsSnapshot = await postsRef.once('value');
    const postsData = postsSnapshot.val() || {};
    
    const posts = Object.values(postsData).sort((a, b) => {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    
    res.json({
      success: true,
      posts
    });
  } catch (error) {
    console.error('Error getting posts:', error);
    res.status(500).json({ error: 'Failed to get posts' });
  }
});

router.get('/:classId/posts/:postId', async (req, res) => {
  try {
    const { classId, postId } = req.params;
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    let userId = null;
    let role = null;
    
    try {
      const { auth } = require('../config/firebase');
      const decodedToken = await auth.verifyIdToken(token);
      userId = decodedToken.uid;
      role = await getUserRole(userId);
      
      if (role === 'student') {
        const membershipCheck = await ensureStudentBelongsToClass(userId, classId);
        if (!membershipCheck.valid) {
          return res.status(403).json({ error: membershipCheck.error });
        }
      } else if (role === 'instructor' || role === 'admin') {
        const ownershipCheck = await ensureInstructorOwnsClass(userId, classId);
        if (!ownershipCheck.valid) {
          return res.status(403).json({ error: ownershipCheck.error });
        }
      } else {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    } catch (err) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.adminId;
        role = await getUserRole(userId);
        
        if (role === 'instructor' || role === 'admin') {
          const ownershipCheck = await ensureInstructorOwnsClass(userId, classId);
          if (!ownershipCheck.valid) {
            return res.status(403).json({ error: ownershipCheck.error });
          }
        } else {
          return res.status(403).json({ error: 'Unauthorized' });
        }
      } catch (jwtErr) {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }
    
    const postRef = db.ref(`classPosts/${classId}/${postId}`);
    const postSnapshot = await postRef.once('value');
    const postData = postSnapshot.val();
    
    if (!postData) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // For instructor, include submission count if task
    if ((role === 'instructor' || role === 'admin') && postData.type === 'task') {
      const submissionsRef = db.ref(`classTaskSubmissions/${classId}/${postId}`);
      const submissionsSnapshot = await submissionsRef.once('value');
      const submissionsData = submissionsSnapshot.val() || {};
      postData.submissionCount = Object.keys(submissionsData).length;
    }
    
    res.json({
      success: true,
      post: postData
    });
  } catch (error) {
    console.error('Error getting post:', error);
    res.status(500).json({ error: 'Failed to get post' });
  }
});

// ============================================
// Task Submissions - Student
// ============================================

router.post('/:classId/posts/:postId/submission', verifyStudentToken, upload.single('file'), async (req, res) => {
  try {
    const studentId = req.userId;
    const { classId, postId } = req.params;
    
    // Verify student belongs to class
    const membershipCheck = await ensureStudentBelongsToClass(studentId, classId);
    if (!membershipCheck.valid) {
      return res.status(403).json({ error: membershipCheck.error });
    }
    
    // Verify post exists and is a task
    const postRef = db.ref(`classPosts/${classId}/${postId}`);
    const postSnapshot = await postRef.once('value');
    const postData = postSnapshot.val();
    
    if (!postData) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    if (postData.type !== 'task') {
      return res.status(400).json({ error: 'Post is not a task' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'File is required for submission' });
    }
    
    if (!bucket) {
      return res.status(503).json({ error: 'Storage bucket not configured' });
    }
    
    // Get student name
    const userRef = db.ref(`${USERS_COLLECTION}/${studentId}`);
    const userSnapshot = await userRef.once('value');
    const userData = userSnapshot.val() || {};
    const studentName = userData.name || userData.fullName || 'Student';
    
    // Delete old submission if exists
    const oldSubmissionRef = db.ref(`classTaskSubmissions/${classId}/${postId}/${studentId}`);
    const oldSubmissionSnapshot = await oldSubmissionRef.once('value');
    const oldSubmission = oldSubmissionSnapshot.val();
    
    if (oldSubmission && oldSubmission.attachmentStoragePath) {
      try {
        const oldFile = bucket.file(oldSubmission.attachmentStoragePath);
        await oldFile.delete();
      } catch (err) {
        console.warn('Could not delete old submission:', err);
      }
    }
    
    // Upload new file
    const originalName = req.file.originalname || 'submission';
    const extMatch = originalName.match(/\.(\w+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    const fileName = `${studentId}_${Date.now()}.${ext}`;
    const filePath = `classSubmissions/${classId}/${postId}/${studentId}/${fileName}`;
    
    const file = bucket.file(filePath);
    await file.save(req.file.buffer, {
      contentType: req.file.mimetype || 'application/octet-stream',
      resumable: false
    });
    
    await file.makePublic();
    const attachmentUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(filePath)}`;
    
    const submissionData = {
      studentId,
      studentName,
      submittedAt: new Date().toISOString(),
      attachmentUrl,
      attachmentName: originalName,
      attachmentStoragePath: filePath,
      score: oldSubmission?.score || null,
      feedback: oldSubmission?.feedback || null,
      gradedAt: oldSubmission?.gradedAt || null,
      gradedBy: oldSubmission?.gradedBy || null
    };
    
    await oldSubmissionRef.set(submissionData);
    
    res.json({
      success: true,
      submission: submissionData
    });
  } catch (error) {
    console.error('Error submitting task:', error);
    res.status(500).json({ error: 'Failed to submit task' });
  }
});

router.get('/:classId/posts/:postId/submission/me', verifyStudentToken, async (req, res) => {
  try {
    const studentId = req.userId;
    const { classId, postId } = req.params;
    
    // Verify student belongs to class
    const membershipCheck = await ensureStudentBelongsToClass(studentId, classId);
    if (!membershipCheck.valid) {
      return res.status(403).json({ error: membershipCheck.error });
    }
    
    const submissionRef = db.ref(`classTaskSubmissions/${classId}/${postId}/${studentId}`);
    const submissionSnapshot = await submissionRef.once('value');
    const submissionData = submissionSnapshot.val();
    
    res.json({
      success: true,
      submission: submissionData || null
    });
  } catch (error) {
    console.error('Error getting submission:', error);
    res.status(500).json({ error: 'Failed to get submission' });
  }
});

// ============================================
// Task Submissions - Instructor Grading
// ============================================

router.get('/:classId/posts/:postId/submissions', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { classId, postId } = req.params;
    
    // Verify ownership
    const ownershipCheck = await ensureInstructorOwnsClass(instructorId, classId);
    if (!ownershipCheck.valid) {
      return res.status(403).json({ error: ownershipCheck.error });
    }
    
    const submissionsRef = db.ref(`classTaskSubmissions/${classId}/${postId}`);
    const submissionsSnapshot = await submissionsRef.once('value');
    const submissionsData = submissionsSnapshot.val() || {};
    
    const submissions = Object.values(submissionsData);
    
    res.json({
      success: true,
      submissions
    });
  } catch (error) {
    console.error('Error getting submissions:', error);
    res.status(500).json({ error: 'Failed to get submissions' });
  }
});

router.put('/:classId/posts/:postId/submissions/:studentId/grade', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { classId, postId, studentId } = req.params;
    const { score, feedback } = req.body;
    
    // Verify ownership
    const ownershipCheck = await ensureInstructorOwnsClass(instructorId, classId);
    if (!ownershipCheck.valid) {
      return res.status(403).json({ error: ownershipCheck.error });
    }
    
    const submissionRef = db.ref(`classTaskSubmissions/${classId}/${postId}/${studentId}`);
    const submissionSnapshot = await submissionRef.once('value');
    const submissionData = submissionSnapshot.val();
    
    if (!submissionData) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    
    const updates = {
      score: score !== undefined && score !== null ? Number(score) : null,
      feedback: feedback || null,
      gradedAt: new Date().toISOString(),
      gradedBy: instructorId
    };
    
    await submissionRef.update(updates);
    
    const updatedSubmission = (await submissionRef.once('value')).val();
    
    res.json({
      success: true,
      submission: updatedSubmission
    });
  } catch (error) {
    console.error('Error grading submission:', error);
    res.status(500).json({ error: 'Failed to grade submission' });
  }
});

// ============================================
// Post Activity Aggregation (Instructor)
// ============================================

router.get('/:classId/post-activity', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { classId } = req.params;

    // Verify ownership
    const ownershipCheck = await ensureInstructorOwnsClass(instructorId, classId);
    if (!ownershipCheck.valid) {
      return res.status(403).json({ error: ownershipCheck.error });
    }

    // Load all comments, submissions, posts, and lastSeen data for this class
    const commentsRef = db.ref(`classPostComments/${classId}`);
    const submissionsRef = db.ref(`classTaskSubmissions/${classId}`);
    const postsRef = db.ref(`classPosts/${classId}`);
    const seenRef = db.ref(`instructorPostSeen`);

    const [commentsSnapshot, submissionsSnapshot, postsSnapshot, seenSnapshot] = await Promise.all([
      commentsRef.once('value'),
      submissionsRef.once('value'),
      postsRef.once('value'),
      seenRef.once('value')
    ]);

    const commentsData = commentsSnapshot.val() || {};
    const submissionsData = submissionsSnapshot.val() || {};
    const postsData = postsSnapshot.val() || {};
    const seenData = seenSnapshot.val() || {};

    // Build lastSeenByPost map for this instructor
    const lastSeenByPost = {};
    Object.entries(seenData).forEach(([key, seenRecord]) => {
      if (seenRecord && seenRecord.instructorId === instructorId && seenRecord.classId === classId) {
        lastSeenByPost[seenRecord.postId] = seenRecord.lastSeenAt;
      }
    });

    const activity = {};

    // Aggregate comments per postId and track latest comment timestamp
    Object.entries(commentsData).forEach(([postId, postComments]) => {
      const commentsObj = postComments || {};
      const commentCount = Object.keys(commentsObj).length;
      let latestCommentAt = null;
      
      Object.values(commentsObj).forEach(comment => {
        if (comment && comment.createdAt) {
          const commentTime = new Date(comment.createdAt).getTime();
          if (!latestCommentAt || commentTime > latestCommentAt) {
            latestCommentAt = commentTime;
          }
        }
      });

      if (!activity[postId]) {
        activity[postId] = {
          commentCount: 0,
          submissionCount: 0,
          needsGradingCount: 0,
          latestActivityAt: null
        };
      }
      activity[postId].commentCount = commentCount;
      if (latestCommentAt) {
        activity[postId].latestActivityAt = new Date(latestCommentAt).toISOString();
      }
    });

    // Aggregate submissions per postId and track latest submission/grade timestamp
    Object.entries(submissionsData).forEach(([postId, postSubmissions]) => {
      const submissionsObj = postSubmissions || {};
      const submissionList = Object.values(submissionsObj);

      let submissionCount = 0;
      let needsGradingCount = 0;
      let latestSubmissionAt = null;

      submissionList.forEach(sub => {
        if (!sub) return;
        submissionCount += 1;
        if (sub.score === null || sub.score === undefined) {
          needsGradingCount += 1;
        }
        
        // Track latest activity from submission: submittedAt, gradedAt, or updatedAt
        const timestamps = [];
        if (sub.submittedAt) timestamps.push(new Date(sub.submittedAt).getTime());
        if (sub.gradedAt) timestamps.push(new Date(sub.gradedAt).getTime());
        if (sub.updatedAt) timestamps.push(new Date(sub.updatedAt).getTime());
        
        const subLatest = timestamps.length > 0 ? Math.max(...timestamps) : null;
        if (subLatest && (!latestSubmissionAt || subLatest > latestSubmissionAt)) {
          latestSubmissionAt = subLatest;
        }
      });

      if (!activity[postId]) {
        activity[postId] = {
          commentCount: 0,
          submissionCount: 0,
          needsGradingCount: 0,
          latestActivityAt: null
        };
      }

      activity[postId].submissionCount = submissionCount;
      activity[postId].needsGradingCount = needsGradingCount;
      
      if (latestSubmissionAt) {
        const submissionIso = new Date(latestSubmissionAt).toISOString();
        // Update latestActivityAt if this submission is newer
        if (!activity[postId].latestActivityAt || submissionIso > activity[postId].latestActivityAt) {
          activity[postId].latestActivityAt = submissionIso;
        }
      }
    });

    // Also include post createdAt/updatedAt in latestActivityAt calculation
    Object.entries(postsData).forEach(([postId, post]) => {
      if (!post) return;
      
      if (!activity[postId]) {
        activity[postId] = {
          commentCount: 0,
          submissionCount: 0,
          needsGradingCount: 0,
          latestActivityAt: null
        };
      }

      const postTimestamps = [];
      if (post.createdAt) postTimestamps.push(new Date(post.createdAt).getTime());
      if (post.updatedAt) postTimestamps.push(new Date(post.updatedAt).getTime());
      
      if (postTimestamps.length > 0) {
        const postLatest = Math.max(...postTimestamps);
        const postIso = new Date(postLatest).toISOString();
        if (!activity[postId].latestActivityAt || postIso > activity[postId].latestActivityAt) {
          activity[postId].latestActivityAt = postIso;
        }
      }
    });

    return res.json({
      success: true,
      activity,
      lastSeenByPost
    });
  } catch (error) {
    console.error('Error getting post activity:', error);
    res.status(500).json({ error: 'Failed to get post activity' });
  }
});

// ============================================
// Mark Post as Seen (Instructor)
// ============================================

router.post('/:classId/posts/:postId/mark-seen', verifyInstructorToken, async (req, res) => {
  try {
    const instructorId = req.instructorId;
    const { classId, postId } = req.params;

    // Verify ownership
    const ownershipCheck = await ensureInstructorOwnsClass(instructorId, classId);
    if (!ownershipCheck.valid) {
      return res.status(403).json({ error: ownershipCheck.error });
    }

    // Verify post exists
    const postRef = db.ref(`classPosts/${classId}/${postId}`);
    const postSnapshot = await postRef.once('value');
    if (!postSnapshot.val()) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Create or update instructorPostSeen record
    // Use composite key: instructorId_postId for easy lookup
    const seenKey = `${instructorId}_${postId}`;
    const seenRef = db.ref(`instructorPostSeen/${seenKey}`);
    
    const now = new Date().toISOString();
    const seenData = {
      instructorId,
      postId,
      classId,
      lastSeenAt: now,
      updatedAt: now
    };

    // Check if record exists
    const existingSnapshot = await seenRef.once('value');
    if (existingSnapshot.val()) {
      // Update existing record
      await seenRef.update({
        lastSeenAt: now,
        updatedAt: now
      });
    } else {
      // Create new record
      seenData.createdAt = now;
      await seenRef.set(seenData);
    }

    return res.json({
      success: true,
      lastSeenAt: now
    });
  } catch (error) {
    console.error('Error marking post as seen:', error);
    res.status(500).json({ error: 'Failed to mark post as seen' });
  }
});

// ============================================
// Comments (Students + Instructor)
// ============================================

router.post('/:classId/posts/:postId/comments', async (req, res) => {
  try {
    const { classId, postId } = req.params;
    const { body } = req.body;
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token || !body) {
      return res.status(400).json({ error: 'Token and body are required' });
    }
    
    let userId = null;
    let userName = null;
    let role = null;
    
    // Try student token
    try {
      const { auth } = require('../config/firebase');
      const decodedToken = await auth.verifyIdToken(token);
      userId = decodedToken.uid;
      role = await getUserRole(userId);
      
      if (role === 'student') {
        const membershipCheck = await ensureStudentBelongsToClass(userId, classId);
        if (!membershipCheck.valid) {
          return res.status(403).json({ error: membershipCheck.error });
        }
        
        const userRef = db.ref(`${USERS_COLLECTION}/${userId}`);
        const userSnapshot = await userRef.once('value');
        const userData = userSnapshot.val() || {};
        userName = userData.name || userData.fullName || 'Student';
      } else if (role === 'instructor' || role === 'admin') {
        const ownershipCheck = await ensureInstructorOwnsClass(userId, classId);
        if (!ownershipCheck.valid) {
          return res.status(403).json({ error: ownershipCheck.error });
        }
        
        const instructorRef = db.ref(`admins/${userId}`);
        const instructorSnapshot = await instructorRef.once('value');
        const instructorData = instructorSnapshot.val() || {};
        userName = instructorData.name || instructorData.fullName || 'Instructor';
      } else {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    } catch (err) {
      // Try instructor token
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.adminId;
        role = await getUserRole(userId);
        
        if (role === 'instructor' || role === 'admin') {
          const ownershipCheck = await ensureInstructorOwnsClass(userId, classId);
          if (!ownershipCheck.valid) {
            return res.status(403).json({ error: ownershipCheck.error });
          }
          
          const instructorRef = db.ref(`admins/${userId}`);
          const instructorSnapshot = await instructorRef.once('value');
          const instructorData = instructorSnapshot.val() || {};
          userName = instructorData.name || instructorData.fullName || 'Instructor';
        } else {
          return res.status(403).json({ error: 'Unauthorized' });
        }
      } catch (jwtErr) {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }
    
    const commentId = `comment_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    const commentData = {
      commentId,
      authorId: userId,
      authorName: userName,
      body,
      createdAt: new Date().toISOString()
    };
    
    const commentRef = db.ref(`classPostComments/${classId}/${postId}/${commentId}`);
    await commentRef.set(commentData);
    
    res.json({
      success: true,
      comment: commentData
    });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

router.get('/:classId/posts/:postId/comments', async (req, res) => {
  try {
    const { classId, postId } = req.params;
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    let userId = null;
    let role = null;
    
    try {
      const { auth } = require('../config/firebase');
      const decodedToken = await auth.verifyIdToken(token);
      userId = decodedToken.uid;
      role = await getUserRole(userId);
      
      if (role === 'student') {
        const membershipCheck = await ensureStudentBelongsToClass(userId, classId);
        if (!membershipCheck.valid) {
          return res.status(403).json({ error: membershipCheck.error });
        }
      } else if (role === 'instructor' || role === 'admin') {
        const ownershipCheck = await ensureInstructorOwnsClass(userId, classId);
        if (!ownershipCheck.valid) {
          return res.status(403).json({ error: ownershipCheck.error });
        }
      } else {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    } catch (err) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.adminId;
        role = await getUserRole(userId);
        
        if (role === 'instructor' || role === 'admin') {
          const ownershipCheck = await ensureInstructorOwnsClass(userId, classId);
          if (!ownershipCheck.valid) {
            return res.status(403).json({ error: ownershipCheck.error });
          }
        } else {
          return res.status(403).json({ error: 'Unauthorized' });
        }
      } catch (jwtErr) {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }
    
    const commentsRef = db.ref(`classPostComments/${classId}/${postId}`);
    const commentsSnapshot = await commentsRef.once('value');
    const commentsData = commentsSnapshot.val() || {};
    
    const comments = Object.values(commentsData).sort((a, b) => {
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    
    res.json({
      success: true,
      comments
    });
  } catch (error) {
    console.error('Error getting comments:', error);
    res.status(500).json({ error: 'Failed to get comments' });
  }
});

module.exports = router;

