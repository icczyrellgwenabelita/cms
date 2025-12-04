/**
 * Instructor Class Page
 *
 * HOW CLASS DATA IS LOADED
 * - This page uses the instructor API helper (`instructorAPI`) to call:
 *   - `GET /api/instructor/class` → returns the instructor's **main class**.
 *   - `GET /api/instructor/class/posts` → returns posts for that same class (used only for lightweight stats here).
 *
 * SHAPE OF THE CLASS OBJECT (from `/api/instructor/class`)
 * - The response is `{ success: true, class: { ... } }` where `class` contains (see `routes/instructor.js`):
 *   - `id` / `classId`: string Firebase key for the class (e.g., `"class_abc123"`).
 *   - `name`: display name such as `"Caregiving NC II – Batch 2025"`.
 *   - `courseName`: course label such as `"Caregiving NC II"`.
 *   - `batchYear`: numeric year such as `2025` (this is what drives the “Batch 2025” label).
 *   - `section`: optional extra section/label (may be empty).
 *   - `studentCount`: number of student IDs under `classes/{classId}/studentIds`.
 *
 * HOW THE “CURRENT CLASS” IS CHOSEN
 * - In `routes/instructor.js`, `/api/instructor/class`:
 *   - Scans `classes` in Firebase and filters where `classData.instructorId === instructorId`.
 *   - **Takes the first matching class it finds** and returns that as the "main" class.
 *   - If there are no classes with that `instructorId`, it returns `success: false` and `class: null`.
 * - This means there can be **multiple classes/batches per instructor** in the data model,
 *   but today this page always uses the first one returned from Firebase iteration.
 *
 * MULTIPLE CLASSES / FUTURE DROPDOWN
 * - `/api/instructor/me` already returns an array `classes` with **all** classes owned by the instructor.
 * - To support selecting different batches later, we can:
 *   - Call `/api/instructor/me`, populate a dropdown from `response.classes`,
 *   - When the instructor chooses a class, use `class.classId` to:
 *     - Call `/api/class/{classId}/posts` (from `routes/class.js`) instead of `/api/instructor/class/posts`.
 *     - Or add a dedicated `/api/instructor/classes/:classId` endpoint that mirrors `/class`.
 * - This file intentionally **does not change** that selection logic; it just reads the main class and renders it.
 */

// Basic in-memory state for this page
const instructorClassState = {
  classData: null,
  posts: [],
  filteredPosts: [],
  activeFilter: 'all',
  selectedPostId: null,
  submissionsByPostId: {},
  activePostTab: 'comments',
  activeSubmissionsContext: null, // { classId, postId, studentId }
  postActivity: {}, // { [postId]: { commentCount, submissionCount, needsGradingCount, latestActivityAt } }
  postSeen: {} // { [postId]: { lastSeenAt } }
};

/**
 * Determines if a post has unread activity
 * @param {Object} post - Post object with id or postId
 * @returns {boolean} - true if post has new activity since last seen
 */
function isPostUnread(post) {
  const id = post.id || post.postId;
  if (!id) return false;

  const activity = instructorClassState.postActivity[id];
  const seen = instructorClassState.postSeen[id];

  const latestActivityAt = activity?.latestActivityAt ? new Date(activity.latestActivityAt) : null;
  const lastSeenAt = seen?.lastSeenAt ? new Date(seen.lastSeenAt) : null;

  if (!latestActivityAt) return false; // no activity at all
  if (!lastSeenAt) return true;       // never seen -> unread
  return latestActivityAt > lastSeenAt;
}

function formatDateSafe(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function pickLastPostDate(posts) {
  if (!Array.isArray(posts) || posts.length === 0) {
    return null;
  }
  const sorted = [...posts].sort((a, b) => {
    const da = new Date(a.createdAt || 0);
    const db = new Date(b.createdAt || 0);
    return db - da;
  });
  return sorted[0]?.createdAt || null;
}

function renderClassInfo() {
  const c = instructorClassState.classData;

  const titleEl = document.getElementById('instrClassTitle');
  const subtitleEl = document.getElementById('instrClassSubtitle');
  const infoCourseEl = document.getElementById('instrInfoCourse');
  const infoBatchEl = document.getElementById('instrInfoBatch');
  const infoSectionEl = document.getElementById('instrInfoSection');
  const infoStudentsEl = document.getElementById('instrInfoStudents');
  const debugEl = document.getElementById('instrClassDebug');

  if (!c) {
    if (titleEl) titleEl.textContent = 'No Class Assigned';
    if (subtitleEl) subtitleEl.textContent = 'Course: — • Batch: — • Students: 0';
    if (infoCourseEl) infoCourseEl.textContent = '—';
    if (infoBatchEl) infoBatchEl.textContent = '—';
    if (infoSectionEl) infoSectionEl.textContent = '—';
    if (infoStudentsEl) infoStudentsEl.textContent = '0';
    if (debugEl) debugEl.textContent = 'null';
    return;
  }

  const className =
    c.name ||
    `${c.courseName || 'Class'}${c.batchYear ? ' – Batch ' + c.batchYear : ''}`;
  const courseName = c.courseName || '—';
  const batch = c.batchYear != null ? c.batchYear : '—';
  const section = c.section || 'N/A';
  const studentCount = typeof c.studentCount === 'number' ? c.studentCount : 0;

  if (titleEl) titleEl.textContent = className;
  if (subtitleEl) {
    subtitleEl.textContent =
      `Course: ${courseName} • Batch: ${batch} • Students: ${studentCount}`;
  }

  if (infoCourseEl) infoCourseEl.textContent = courseName;
  if (infoBatchEl) infoBatchEl.textContent = batch;
  if (infoSectionEl) infoSectionEl.textContent = section;
  if (infoStudentsEl) infoStudentsEl.textContent = String(studentCount);

  if (debugEl) {
    try {
      debugEl.textContent = JSON.stringify(
        {
          ...c,
          _sourceNote:
            'This object comes from GET /api/instructor/class (see routes/instructor.js).'
        },
        null,
        2
      );
    } catch (err) {
      debugEl.textContent = '[Error stringifying class data]';
    }
  }
}

function getPostTypeLabel(type) {
  const t = (type || 'message').toLowerCase();
  if (t === 'announcement') return 'Announcement';
  if (t === 'material') return 'Material';
  if (t === 'task') return 'Task';
  if (t === 'message') return 'Message';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function getPostTypeBadgeClass(type) {
  const t = (type || 'message').toLowerCase();
  if (t === 'announcement') return 'type-announcement';
  if (t === 'material') return 'type-material';
  if (t === 'task') return 'type-task';
  if (t === 'message') return 'type-message';
  return 'type-default';
}

function applyPostFilter(filter) {
  instructorClassState.activeFilter = filter;
  const posts = Array.isArray(instructorClassState.posts) ? instructorClassState.posts : [];

  if (!filter || filter === 'all') {
    instructorClassState.filteredPosts = posts;
  } else {
    const f = filter.toLowerCase();
    instructorClassState.filteredPosts = posts.filter(p => (p.type || '').toLowerCase() === f);
  }

  renderPostList();
}

function renderPostList() {
  const listEl = document.getElementById('instrClassFeedList');
  const emptyEl = document.getElementById('instrClassEmpty');
  const posts = Array.isArray(instructorClassState.filteredPosts)
    ? instructorClassState.filteredPosts
    : [];

  if (!listEl || !emptyEl) return;

  if (posts.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';

  const sorted = [...posts].sort((a, b) => {
    const da = new Date(a.createdAt || 0);
    const db = new Date(b.createdAt || 0);
    return db - da;
  });

  listEl.innerHTML = sorted
    .map(post => {
      const id = post.id || post.postId;
      const title = post.title || '(No title)';
      const body = post.body || '';
    const preview =
        body.length > 160 ? `${body.slice(0, 157)}…` : body;
      const createdAt = formatDateSafe(post.createdAt) || '';
      const createdBy = post.createdByName || post.instructorName || 'Instructor';
      const typeLabel = getPostTypeLabel(post.type);
      const badgeClass = getPostTypeBadgeClass(post.type);
      const attachmentCount = Array.isArray(post.attachments) ? post.attachments.length : 0;

      const isSelected = instructorClassState.selectedPostId === id;
      const isUnread = isPostUnread(post);

      const activityMap = instructorClassState.postActivity || {};
      const activity = id && activityMap[id] ? activityMap[id] : null;
      const commentCount = activity && typeof activity.commentCount === 'number'
        ? activity.commentCount
        : 0;
      const submissionCount = activity && typeof activity.submissionCount === 'number'
        ? activity.submissionCount
        : 0;
      const needsGradingCount = activity && typeof activity.needsGradingCount === 'number'
        ? activity.needsGradingCount
        : 0;

      const isTask = (post.type || '').toLowerCase() === 'task';
      const badges = [];

      if (commentCount > 0) {
        badges.push(
          `<span class="instr-feed-activity-badge">
            💬 ${commentCount}
          </span>`
        );
      }

      if (isTask && submissionCount > 0) {
        badges.push(
          `<span class="instr-feed-activity-badge">
            📥 ${submissionCount} submitted
          </span>`
        );
      }

      if (isTask && needsGradingCount > 0) {
        badges.push(
          `<span class="instr-feed-activity-badge instr-feed-activity-badge-highlight">
            ⭐ ${needsGradingCount} to grade
          </span>`
        );
      }

      const activityBadgesHtml =
        badges.length > 0
          ? `<div class="instr-class-feed-footer">
              <div class="instr-feed-activity-badges">
                ${badges.join('')}
      </div>
            </div>`
          : '';

      return `
        <button
          type="button"
          class="instr-class-feed-item ${isSelected ? 'selected' : ''} ${isUnread ? 'post-card-unread' : ''}"
          data-post-id="${id || ''}"
        >
          <div class="instr-class-feed-item-header">
            <span class="instr-post-type-badge ${badgeClass}">${typeLabel}</span>
            <h3>${title}${isUnread ? '<span class="post-unread-dot"></span>' : ''}</h3>
      </div>
          <p class="instr-class-feed-preview">${preview.replace(/\n/g, ' ')}</p>
          <p class="instr-class-feed-meta">
            <span>${createdBy}</span>
            ${createdAt ? `<span>• ${createdAt}</span>` : ''}
            ${attachmentCount > 0 ? `<span>• ${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}</span>` : ''}
          </p>
          ${activityBadgesHtml}
        </button>
      `;
    })
    .join('');

  // Attach click handlers
  Array.from(listEl.querySelectorAll('.instr-class-feed-item')).forEach(btn => {
    btn.addEventListener('click', () => {
      const postId = btn.getAttribute('data-post-id');
      instructorClassState.selectedPostId = postId || null;
      renderPostList(); // re-render to update selected state
      renderPostDetails();
      // Mark post as seen when selected
      if (postId) {
        markPostAsSeen(postId).catch(err => {
          console.warn('Failed to mark post as seen:', err);
        });
      }
    });
  });
}

/**
 * Marks a post as seen by the instructor
 * @param {string} postId - Post ID to mark as seen
 */
async function markPostAsSeen(postId) {
  const classId = getCurrentClassId();
  if (!classId || !postId) return;

  try {
    const token = instructorAPI.getToken();
    const response = await fetch(`/api/class/${classId}/posts/${postId}/mark-seen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.success) {
      console.warn('Failed to mark post as seen:', data && data.error);
      return;
    }

    // Update local state optimistically
    if (data.lastSeenAt) {
      if (!instructorClassState.postSeen[postId]) {
        instructorClassState.postSeen[postId] = {};
      }
      instructorClassState.postSeen[postId].lastSeenAt = data.lastSeenAt;
      // Re-render to update unread indicator
      renderPostList();
      // Refresh global notifications immediately
      if (typeof refreshInstructorNotifications === 'function') {
        refreshInstructorNotifications();
      }
    }
  } catch (err) {
    console.error('Error marking post as seen:', err);
  }
}

function renderPostDetails() {
  const emptyEl = document.getElementById('instrPostDetailsEmpty');
  const contentEl = document.getElementById('instrPostDetailsContent');
  const titleEl = document.getElementById('instrPostTitle');
  const typeBadgeEl = document.getElementById('instrPostTypeBadge');
  const metaEl = document.getElementById('instrPostMeta');
  const bodyEl = document.getElementById('instrPostBody');
  const linkContainerEl = document.getElementById('instrPostLinkContainer');
  const linkEl = document.getElementById('instrPostLink');
  const attachmentsEl = document.getElementById('instrPostAttachments');
  const taskMetaEl = document.getElementById('instrPostTaskMeta');
  const tabsEl = document.getElementById('instrPostTabs');
  const commentsTabBtn = document.getElementById('instrPostTabCommentsButton');
  const submissionsTabBtn = document.getElementById('instrPostTabSubmissionsButton');
  const commentsPanel = document.getElementById('instrPostTabCommentsPanel');
  const submissionsPanel = document.getElementById('instrPostTabSubmissionsPanel');

  if (!contentEl || !emptyEl) return;

  const posts = Array.isArray(instructorClassState.posts) ? instructorClassState.posts : [];
  const selectedId = instructorClassState.selectedPostId;
  const post = posts.find(p => (p.id || p.postId) === selectedId);

  if (!post) {
    contentEl.style.display = 'none';
    emptyEl.style.display = 'block';
    if (tabsEl) tabsEl.style.display = 'none';
    if (commentsPanel) commentsPanel.style.display = 'none';
    if (submissionsPanel) submissionsPanel.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  contentEl.style.display = 'block';

  const typeLabel = getPostTypeLabel(post.type);
  const badgeClass = getPostTypeBadgeClass(post.type);
  const createdAt = formatDateSafe(post.createdAt) || '';
  const createdBy = post.createdByName || post.instructorName || 'Instructor';

  if (typeBadgeEl) {
    typeBadgeEl.textContent = typeLabel;
    typeBadgeEl.className = `instr-post-type-badge ${badgeClass}`;
  }
  if (titleEl) titleEl.textContent = post.title || '(No title)';
  if (metaEl) {
    const bits = [];
    if (createdBy) bits.push(createdBy);
    if (createdAt) bits.push(createdAt);
    metaEl.textContent = bits.join(' • ');
  }
  if (bodyEl) {
    const safeBody = (post.body || '').replace(/\n/g, '<br>');
    bodyEl.innerHTML = safeBody;
  }

  // Link
  const linkUrl = post.linkUrl || null;
  if (linkContainerEl && linkEl) {
    if (linkUrl) {
      linkEl.href = linkUrl;
      linkEl.textContent = linkUrl;
      linkContainerEl.style.display = 'block';
    } else {
      linkContainerEl.style.display = 'none';
    }
  }

  // Attachments
  if (attachmentsEl) {
    const attachments = Array.isArray(post.attachments) ? post.attachments : [];
    if (attachments.length === 0) {
      attachmentsEl.style.display = 'none';
    } else {
      const items = attachments
        .map(att => {
          const name = att.label || att.name || 'Attachment';
          const url = att.url || '#';
          return `<li><a href="${url}" target="_blank" rel="noopener">${name}</a></li>`;
        })
        .join('');
      attachmentsEl.innerHTML = `<h4>Attachments</h4><ul>${items}</ul>`;
      attachmentsEl.style.display = 'block';
    }
  }

  // Task meta
  if (taskMetaEl) {
    const isTask = (post.type || '').toLowerCase() === 'task';
    // Support both new `taskMeta` object and legacy flat `dueDate`/`maxScore` fields
    const combinedTaskMeta = post.taskMeta && typeof post.taskMeta === 'object'
      ? post.taskMeta
      : {
          dueDate: post.dueDate,
          maxScore: post.maxScore
        };

    if (!isTask) {
      taskMetaEl.style.display = 'none';
    } else {
      const pieces = [];
      if (combinedTaskMeta && combinedTaskMeta.dueDate) {
        pieces.push(`<div><strong>Due date:</strong> ${combinedTaskMeta.dueDate}</div>`);
      }
      if (
        combinedTaskMeta &&
        combinedTaskMeta.maxScore != null &&
        combinedTaskMeta.maxScore !== ''
      ) {
        pieces.push(`<div><strong>Max score:</strong> ${combinedTaskMeta.maxScore}</div>`);
      }
      if (pieces.length === 0) {
        taskMetaEl.style.display = 'none';
      } else {
        taskMetaEl.innerHTML = pieces.join('');
        taskMetaEl.style.display = 'block';
      }
    }
  }

  // Configure tabs (comments always available, submissions only for tasks)
  const isTask = (post.type || '').toLowerCase() === 'task';
  if (tabsEl && commentsTabBtn && commentsPanel) {
    tabsEl.style.display = 'flex';
    commentsPanel.style.display = 'block';
    instructorClassState.activePostTab = 'comments';

    commentsTabBtn.classList.add('instr-post-tab-active');
    if (submissionsTabBtn) submissionsTabBtn.classList.remove('instr-post-tab-active');
    if (submissionsPanel) submissionsPanel.style.display = 'none';
  }

  if (submissionsTabBtn) {
    if (isTask) {
      submissionsTabBtn.style.display = 'inline-flex';
    } else {
      submissionsTabBtn.style.display = 'none';
    }
  }

  // Immediately load comments for this post
  loadInstructorPostComments().catch(err => {
    console.warn('Failed to load comments for post:', err);
  });

  // Preload submissions for task posts so the tab is ready when clicked
  if (isTask) {
    loadInstructorPostSubmissions(false).catch(err => {
      console.warn('Failed to preload submissions for post:', err);
    });
  }

  // Update action buttons
  const editBtn = document.getElementById('instrPostEditBtn');
  const archiveBtn = document.getElementById('instrPostArchiveBtn');
  const deleteBtn = document.getElementById('instrPostDeleteBtn');
  const actionsContainer = document.getElementById('instrPostActions');

  if (actionsContainer) {
    actionsContainer.style.display = 'flex';
  }

  if (archiveBtn) {
    const isArchived = post.archived === true;
    // Clear any existing onclick
    archiveBtn.onclick = null;
    // Remove all event listeners by cloning
    const newArchiveBtn = archiveBtn.cloneNode(true);
    archiveBtn.parentNode.replaceChild(newArchiveBtn, archiveBtn);
    newArchiveBtn.innerHTML = `<i class="fas fa-${isArchived ? 'unarchive' : 'archive'}"></i> ${isArchived ? 'Unarchive' : 'Archive'}`;
    newArchiveBtn.className = 'btn-sm btn-outline';
    newArchiveBtn.title = isArchived ? 'Unarchive Post' : 'Archive Post';
    newArchiveBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const postId = post.id || post.postId;
      if (!postId) {
        console.error('No post ID available for archive');
        return;
      }
      if (typeof handleArchivePost === 'function') {
        handleArchivePost(postId, !isArchived).catch(err => {
          console.error('Error archiving post:', err);
          alert('Failed to ' + (!isArchived ? 'archive' : 'unarchive') + ' post: ' + (err.message || 'Unknown error'));
        });
      } else {
        console.error('handleArchivePost function not found');
        alert('Archive function not available. Please refresh the page.');
      }
    });
  }

  if (editBtn) {
    // Clear any existing onclick
    editBtn.onclick = null;
    // Remove all event listeners by cloning
    const newEditBtn = editBtn.cloneNode(true);
    editBtn.parentNode.replaceChild(newEditBtn, editBtn);
    newEditBtn.innerHTML = '<i class="fas fa-edit"></i> Edit';
    newEditBtn.className = 'btn-sm btn-outline';
    newEditBtn.title = 'Edit Post';
    newEditBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof openEditPostModal === 'function') {
        openEditPostModal(post);
      } else {
        console.error('openEditPostModal function not found');
        alert('Edit function not available. Please refresh the page.');
      }
    });
  }

  if (deleteBtn) {
    // Clear any existing onclick
    deleteBtn.onclick = null;
    // Remove all event listeners by cloning
    const newDeleteBtn = deleteBtn.cloneNode(true);
    deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
    newDeleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
    newDeleteBtn.className = 'btn-sm btn-danger';
    newDeleteBtn.title = 'Delete Post';
    newDeleteBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const postId = post.id || post.postId;
      if (!postId) {
        console.error('No post ID available for delete');
        return;
      }
      if (typeof openDeleteConfirmModal === 'function') {
        openDeleteConfirmModal(postId);
      } else {
        console.error('openDeleteConfirmModal function not found');
        alert('Delete function not available. Please refresh the page.');
      }
    });
  }
}

function getCurrentClassId() {
  const c = instructorClassState.classData;
  return c && (c.classId || c.id) ? (c.classId || c.id) : null;
}

/**
 * Opens the delete confirmation modal and loads deletion info
 */
async function openDeleteConfirmModal(postId) {
  const modal = document.getElementById('instrDeleteConfirmModal');
  const detailsList = document.getElementById('instrDeleteConfirmList');
  const confirmBtn = document.getElementById('instrDeleteModalConfirm');
  const errorEl = document.getElementById('instrDeleteError');

  if (!modal || !detailsList || !confirmBtn) return;

  const classId = getCurrentClassId();
  if (!classId || !postId) return;

  // Show loading state
  detailsList.innerHTML = '<li>Loading deletion information...</li>';
  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }
  confirmBtn.disabled = true;
  modal.style.display = 'flex';

  try {
    const token = instructorAPI.getToken();
    const response = await fetch(`/api/class/${classId}/posts/${postId}/deletion-info`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.success) {
      throw new Error(data?.error || 'Failed to load deletion information');
    }

    const info = data.deletionInfo || {};
    const items = ['The post itself'];

    if (info.commentCount > 0) {
      items.push(`${info.commentCount} comment${info.commentCount !== 1 ? 's' : ''}`);
    }
    if (info.submissionCount > 0) {
      items.push(`${info.submissionCount} submission${info.submissionCount !== 1 ? 's' : ''} (including all submitted files)`);
    }
    if (info.attachmentCount > 0) {
      items.push(`${info.attachmentCount} attachment file${info.attachmentCount !== 1 ? 's' : ''}`);
    }

    // Helper function to escape HTML
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    detailsList.innerHTML = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
    confirmBtn.disabled = false;
    confirmBtn.onclick = () => handleDeletePost(postId);
  } catch (err) {
    console.error('Error loading deletion info:', err);
    detailsList.innerHTML = '<li style="color: #DC2626;">Failed to load deletion information</li>';
    if (errorEl) {
      errorEl.textContent = err.message || 'Failed to load deletion information';
      errorEl.style.display = 'block';
    }
  }
}

/**
 * Closes the delete confirmation modal
 */
function closeDeleteConfirmModal() {
  const modal = document.getElementById('instrDeleteConfirmModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

/**
 * Handles the actual deletion of a post
 */
async function handleDeletePost(postId) {
  const confirmBtn = document.getElementById('instrDeleteModalConfirm');
  const errorEl = document.getElementById('instrDeleteError');
  const classId = getCurrentClassId();

  if (!classId || !postId) return;

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting...';
  }

  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  try {
    const token = instructorAPI.getToken();
    const response = await fetch(`/api/class/${classId}/posts/${postId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.success) {
      throw new Error(data?.error || 'Failed to delete post');
    }

    // Close modal
    closeDeleteConfirmModal();

    // Reload posts
    await loadInstructorClassPage();

    // Clear selected post
    instructorClassState.selectedPostId = null;
    renderPostDetails();
  } catch (err) {
    console.error('Error deleting post:', err);
    if (errorEl) {
      errorEl.textContent = err.message || 'Failed to delete post. Please try again.';
      errorEl.style.display = 'block';
    }
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete Post';
    }
  }
}

/**
 * Handles archiving/unarchiving a post
 */
async function handleArchivePost(postId, archive) {
  const classId = getCurrentClassId();
  if (!classId || !postId) return;

  try {
    const token = instructorAPI.getToken();
    const response = await fetch(`/api/class/${classId}/posts/${postId}/archive`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ archived: archive })
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.success) {
      throw new Error(data?.error || 'Failed to archive post');
    }

    // Reload posts
    await loadInstructorClassPage();

    // Keep the post selected and refresh details
    instructorClassState.selectedPostId = postId;
    renderPostDetails();
  } catch (err) {
    console.error('Error archiving post:', err);
    alert('Failed to ' + (archive ? 'archive' : 'unarchive') + ' post: ' + (err.message || 'Unknown error'));
  }
}

/**
 * Opens the edit modal with post data pre-filled
 */
function openEditPostModal(post) {
  const modal = document.getElementById('instructorPostModal');
  const postTypeEl = document.getElementById('postType');
  const postTitleEl = document.getElementById('postTitle');
  const postBodyEl = document.getElementById('postBody');
  const postLinkUrlEl = document.getElementById('postLinkUrl');
  const postDueDateEl = document.getElementById('postDueDate');
  const postMaxScoreEl = document.getElementById('postMaxScore');
  const postErrorEl = document.getElementById('postError');
  const postTaskMetaGroup = document.getElementById('postTaskMetaGroup');
  const postAttachmentGroup = document.getElementById('postAttachmentGroup');
  const savePostBtn = document.getElementById('btnSavePost');
  const modalHeader = modal?.querySelector('.history-modal-header h2');

  if (!modal) return;

  // Store post ID for editing
  modal.dataset.editingPostId = post.id || post.postId;

  // Update modal title
  if (modalHeader) {
    modalHeader.textContent = 'Edit Post';
  }

  // Pre-fill form fields
  if (postTypeEl) {
    postTypeEl.value = post.type || 'announcement';
    postTypeEl.disabled = true; // Don't allow changing type when editing
  }
  if (postTitleEl) postTitleEl.value = post.title || '';
  if (postBodyEl) postBodyEl.value = post.body || '';
  if (postLinkUrlEl) postLinkUrlEl.value = post.linkUrl || '';

  // Handle task meta
  const isTask = (post.type || '').toLowerCase() === 'task';
  const taskMeta = post.taskMeta && typeof post.taskMeta === 'object'
    ? post.taskMeta
    : { dueDate: post.dueDate, maxScore: post.maxScore };

  if (postDueDateEl) {
    postDueDateEl.value = taskMeta?.dueDate || '';
  }
  if (postMaxScoreEl) {
    postMaxScoreEl.value = taskMeta?.maxScore != null ? String(taskMeta.maxScore) : '';
  }

  // Show/hide task meta and attachment groups
  if (postTaskMetaGroup) {
    postTaskMetaGroup.style.display = isTask ? 'block' : 'none';
  }
  if (postAttachmentGroup) {
    postAttachmentGroup.style.display = (isTask || post.type === 'material') ? 'block' : 'none';
  }

  // Clear attachment input (editing attachments would require more complex logic)
  const postAttachmentInput = document.getElementById('postAttachmentInput');
  if (postAttachmentInput) {
    postAttachmentInput.value = '';
    // Manually hide attachment list since updateAttachmentList is scoped inside DOMContentLoaded
    const attachmentListEl = document.getElementById('postAttachmentList');
    if (attachmentListEl) {
      attachmentListEl.style.display = 'none';
    }
  }

  // Clear error
  if (postErrorEl) {
    postErrorEl.style.display = 'none';
    postErrorEl.textContent = '';
  }

  // Update save button text
  if (savePostBtn) {
    savePostBtn.textContent = 'Update Post';
  }

  // Trigger type change to set initial state
  if (postTypeEl) {
    postTypeEl.dispatchEvent(new Event('change'));
  }

  modal.style.display = 'flex';
}

async function loadInstructorPostComments() {
  const classId = getCurrentClassId();
  const posts = Array.isArray(instructorClassState.posts) ? instructorClassState.posts : [];
  const postId = instructorClassState.selectedPostId;
  const listEl = document.getElementById('instrPostCommentsList');
  const emptyHintEl = document.getElementById('instrPostCommentsEmptyHint');

  if (!classId || !postId || !listEl) return;

  try {
    const token = instructorAPI.getToken();
    const response = await fetch(`/api/class/${classId}/posts/${postId}/comments`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.success) {
      listEl.innerHTML = '<p class="instr-post-empty">Failed to load comments.</p>';
      if (emptyHintEl) emptyHintEl.style.display = 'none';
      return;
    }

    const comments = Array.isArray(data.comments) ? data.comments : [];
    if (comments.length === 0) {
      listEl.innerHTML = '';
      if (emptyHintEl) emptyHintEl.style.display = 'block';
      return;
    }

    // Hide empty hint when there are comments
    if (emptyHintEl) emptyHintEl.style.display = 'none';

    listEl.innerHTML = comments
      .map(comment => {
        const author = comment.authorName || 'User';
        const createdAt = formatDateSafe(comment.createdAt) || '';
        return `
          <div class="instr-post-comment">
            <div class="instr-post-comment-header">
              <span class="instr-post-comment-author">${author}</span>
              ${createdAt ? `<span class="instr-post-comment-date">${createdAt}</span>` : ''}
            </div>
            <div class="instr-post-comment-body">${(comment.body || '').replace(/\n/g, '<br>')}</div>
          </div>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Error loading instructor comments:', err);
    listEl.innerHTML = '<p class="instr-post-empty">Failed to load comments.</p>';
    if (emptyHintEl) emptyHintEl.style.display = 'none';
  }
}

async function loadInstructorPostActivity() {
  const classId = getCurrentClassId();
  if (!classId) return;

  try {
    const token = instructorAPI.getToken();
    const response = await fetch(`/api/class/${classId}/post-activity`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.success) {
      console.warn('Post activity request failed:', data && data.error);
      return;
    }

    instructorClassState.postActivity =
      data.activity && typeof data.activity === 'object' ? data.activity : {};
    
    // Process lastSeenByPost into postSeen state
    const lastSeenByPost = data.lastSeenByPost && typeof data.lastSeenByPost === 'object' ? data.lastSeenByPost : {};
    instructorClassState.postSeen = {};
    Object.entries(lastSeenByPost).forEach(([postId, lastSeenAt]) => {
      if (postId && lastSeenAt) {
        instructorClassState.postSeen[postId] = { lastSeenAt };
      }
    });
    
    renderPostList();
  } catch (err) {
    console.error('Error loading instructor post activity:', err);
  }
}

async function submitInstructorComment() {
  const classId = getCurrentClassId();
  const postId = instructorClassState.selectedPostId;
  const inputEl = document.getElementById('instrPostCommentInput');
  const submitBtn = document.getElementById('instrPostCommentSubmit');
  if (!classId || !postId || !inputEl) return;

  const body = (inputEl.value || '').trim();
  if (!body) {
    return; // Button should be disabled, but double-check
  }

  // Disable button while submitting
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Posting...';
  }

  try {
    const token = instructorAPI.getToken();
    const response = await fetch(`/api/class/${classId}/posts/${postId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ body })
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.success) {
      alert('Failed to post comment: ' + (data && data.error ? data.error : 'Unknown error'));
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Post';
        updateCommentSubmitButton(); // Re-check disabled state
      }
      return;
    }

    // Clear textarea and disable button
    inputEl.value = '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Post';
    }

    // Reload comments to show the new one
    await loadInstructorPostComments();
    await loadInstructorPostActivity().catch(err => {
      console.warn('Failed to refresh post activity after comment:', err);
    });
    // Refresh global notifications immediately
    if (typeof refreshInstructorNotifications === 'function') {
      refreshInstructorNotifications();
    }

    // Optionally refocus the textarea
    setTimeout(() => {
      inputEl.focus();
    }, 100);
  } catch (err) {
    console.error('Error posting instructor comment:', err);
    alert('Failed to post comment. Please try again.');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Post';
      updateCommentSubmitButton(); // Re-check disabled state
    }
  }
}

/**
 * Updates the Post button disabled state based on textarea content
 */
function updateCommentSubmitButton() {
  const inputEl = document.getElementById('instrPostCommentInput');
  const submitBtn = document.getElementById('instrPostCommentSubmit');
  
  if (!inputEl || !submitBtn) return;

  const hasText = (inputEl.value || '').trim().length > 0;
  submitBtn.disabled = !hasText;
}

async function loadInstructorPostSubmissions(showPanelImmediately = true) {
  const classId = getCurrentClassId();
  const postId = instructorClassState.selectedPostId;
  const tbodyEl = document.getElementById('instrPostSubmissionsTbody');
  const summaryEl = document.getElementById('instrPostSubmissionsSummary');

  if (!classId || !postId || !tbodyEl || !summaryEl) return;

  // Only applicable to task posts
  const posts = Array.isArray(instructorClassState.posts) ? instructorClassState.posts : [];
  const post = posts.find(p => (p.id || p.postId) === postId);
  if (!post || (post.type || '').toLowerCase() !== 'task') return;

  try {
    const token = instructorAPI.getToken();
    const response = await fetch(`/api/class/${classId}/posts/${postId}/submissions`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.success) {
      summaryEl.textContent = 'Failed to load submissions.';
      tbodyEl.innerHTML = '';
      return;
    }

    const submissions = Array.isArray(data.submissions) ? data.submissions : [];
    instructorClassState.submissionsByPostId[postId] = submissions;

    if (submissions.length === 0) {
      summaryEl.textContent = 'No submissions yet.';
      tbodyEl.innerHTML = '';
    } else {
      const submittedCount = submissions.length;
      const graded = submissions.filter(s => s.score != null).length;
      const notGraded = submittedCount - graded;
      let averageScoreText = '';
      const numericScores = submissions
        .map(s => (typeof s.score === 'number' ? s.score : null))
        .filter(v => v != null);
      if (numericScores.length > 0) {
        const avg =
          numericScores.reduce((sum, v) => sum + v, 0) / numericScores.length;
        averageScoreText = ` • Avg score: ${avg.toFixed(1)}`;
      }
      summaryEl.textContent = `${submittedCount} submitted • ${graded} graded • ${notGraded} pending${averageScoreText}`;

      tbodyEl.innerHTML = submissions
        .map(sub => {
          const status =
            sub.score != null
              ? 'Graded'
              : 'Submitted';
          const statusClass =
            sub.score != null ? 'status-graded' : 'status-submitted';
          const submittedAt = formatDateSafe(sub.submittedAt) || '';
          const scoreText =
            sub.score != null
              ? String(sub.score)
              : '—';
          return `
            <tr>
              <td>${sub.studentName || 'Student'}</td>
              <td><span class="instr-submission-status ${statusClass}">${status}</span></td>
              <td>${scoreText}</td>
              <td>${submittedAt}</td>
              <td>
                <button
                  type="button"
                  class="btn-sm btn-outline"
                  data-student-id="${sub.studentId}"
                >
                  View / Grade
                </button>
              </td>
            </tr>
          `;
        })
        .join('');

      // Attach button handlers
      Array.from(
        tbodyEl.querySelectorAll('button[data-student-id]')
      ).forEach(btn => {
        btn.addEventListener('click', () => {
          const studentId = btn.getAttribute('data-student-id');
          openGradeModalForSubmission(classId, postId, studentId);
        });
      });
    }

    if (showPanelImmediately) {
      const tabsEl = document.getElementById('instrPostTabs');
      const commentsTabBtn = document.getElementById('instrPostTabCommentsButton');
      const submissionsTabBtn = document.getElementById('instrPostTabSubmissionsButton');
      const commentsPanel = document.getElementById('instrPostTabCommentsPanel');
      const submissionsPanel = document.getElementById('instrPostTabSubmissionsPanel');

      if (
        tabsEl &&
        commentsTabBtn &&
        submissionsTabBtn &&
        commentsPanel &&
        submissionsPanel
      ) {
        instructorClassState.activePostTab = 'submissions';
        commentsTabBtn.classList.remove('instr-post-tab-active');
        submissionsTabBtn.classList.add('instr-post-tab-active');
        commentsPanel.style.display = 'none';
        submissionsPanel.style.display = 'block';
      }
    }
  } catch (err) {
    console.error('Error loading instructor submissions:', err);
    if (summaryEl) {
      summaryEl.textContent = 'Failed to load submissions.';
    }
    if (tbodyEl) {
      tbodyEl.innerHTML = '';
    }
  }
}

function openGradeModalForSubmission(classId, postId, studentId) {
  const modal = document.getElementById('instrGradeModal');
  const nameEl = document.getElementById('instrGradeStudentName');
  const linkEl = document.getElementById('instrGradeSubmissionLink');
  const scoreEl = document.getElementById('instrGradeScore');
  const feedbackEl = document.getElementById('instrGradeFeedback');
  const errorEl = document.getElementById('instrGradeError');

  if (!modal || !nameEl || !linkEl || !scoreEl || !feedbackEl) return;

  const submissions = instructorClassState.submissionsByPostId[postId] || [];
  const submission = submissions.find(s => s.studentId === studentId);
  if (!submission) return;

  instructorClassState.activeSubmissionsContext = {
    classId,
    postId,
    studentId
  };

  nameEl.textContent = submission.studentName || 'Student';
  if (submission.attachmentUrl) {
    linkEl.href = submission.attachmentUrl;
    linkEl.textContent = submission.attachmentName || 'Download submission';
  } else {
    linkEl.href = '#';
    linkEl.textContent = 'No file available';
  }

  scoreEl.value =
    submission.score != null && !Number.isNaN(Number(submission.score))
      ? String(submission.score)
      : '';
  feedbackEl.value = submission.feedback || '';

  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }
  
  modal.style.display = 'flex';
}

function closeGradeModal() {
  const modal = document.getElementById('instrGradeModal');
  if (modal) {
    modal.style.display = 'none';
  }
  instructorClassState.activeSubmissionsContext = null;
}

async function saveGradeFromModal() {
  const ctx = instructorClassState.activeSubmissionsContext;
  const scoreEl = document.getElementById('instrGradeScore');
  const feedbackEl = document.getElementById('instrGradeFeedback');
  const errorEl = document.getElementById('instrGradeError');

  if (!ctx || !scoreEl || !feedbackEl) return;

  const scoreRaw = scoreEl.value;
  const feedback = feedbackEl.value || null;
  let score = null;

  if (scoreRaw !== '') {
    const parsed = Number(scoreRaw);
    if (Number.isNaN(parsed)) {
      if (errorEl) {
        errorEl.textContent = 'Score must be a number.';
        errorEl.style.display = 'block';
      }
      return;
    }
    score = parsed;
  }

  try {
    const token = instructorAPI.getToken();
    const response = await fetch(
      `/api/class/${ctx.classId}/posts/${ctx.postId}/submissions/${ctx.studentId}/grade`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ score, feedback })
      }
    );

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.success) {
      if (errorEl) {
        errorEl.textContent =
          (data && data.error) || 'Failed to save grade.';
        errorEl.style.display = 'block';
      }
      return;
    }

    // Refresh submissions for this post and keep the submissions tab open
    await loadInstructorPostSubmissions(true);
    await loadInstructorPostActivity().catch(err => {
      console.warn('Failed to refresh post activity after grading:', err);
    });
    // Refresh global notifications immediately
    if (typeof refreshInstructorNotifications === 'function') {
      refreshInstructorNotifications();
    }
    closeGradeModal();
  } catch (err) {
    console.error('Error saving grade:', err);
    if (errorEl) {
      errorEl.textContent = 'Failed to save grade. Please try again.';
      errorEl.style.display = 'block';
    }
  }
}

async function loadInstructorClassPage() {
  try {
    // 1) Load the instructor's main class
    const classResponse = await instructorAPI.get('/class');
    if (classResponse && classResponse.success && classResponse.class) {
      instructorClassState.classData = classResponse.class;
    } else {
      instructorClassState.classData = null;
    }

    // 2) Load posts for this class (for feed + stats)
    let posts = [];
    try {
      const postsResponse = await instructorAPI.get('/class/posts');
      if (postsResponse && postsResponse.success && Array.isArray(postsResponse.posts)) {
        posts = postsResponse.posts;
      }
    } catch (postsErr) {
      console.warn('Unable to load class posts (stats will be empty):', postsErr);
    }

    instructorClassState.posts = posts;
    instructorClassState.filteredPosts = posts;
    renderClassInfo();
    applyPostFilter(instructorClassState.activeFilter || 'all');
    
    // Check for postId query parameter (from notification navigation)
    const urlParams = new URLSearchParams(window.location.search);
    const postIdFromQuery = urlParams.get('postId');
    if (postIdFromQuery) {
      // Find the post and select it
      const post = posts.find(p => (p.id || p.postId) === postIdFromQuery);
      if (post) {
        instructorClassState.selectedPostId = postIdFromQuery;
        // Scroll to the post card after a brief delay
        setTimeout(() => {
          const cardEl = document.querySelector(`[data-post-id="${postIdFromQuery}"]`);
          if (cardEl) {
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 300);
        // Mark as seen
        markPostAsSeen(postIdFromQuery).catch(err => {
          console.warn('Failed to mark post as seen:', err);
        });
      }
      // Clean up query param from URL
      const url = new URL(window.location);
      url.searchParams.delete('postId');
      window.history.replaceState({}, '', url);
    }
    
    renderPostDetails();
    loadInstructorPostActivity().catch(err => {
      console.warn('Failed to load post activity:', err);
    });
  } catch (error) {
    console.error('Error loading instructor class page:', error);
    instructorClassState.classData = null;
    instructorClassState.posts = [];
    instructorClassState.filteredPosts = [];
    renderClassInfo();
    applyPostFilter('all');
    renderPostDetails();
  }
}

/**
 * Initialize Developer Debug card visibility based on query parameter
 */
function initInstructorDebugCard() {
  const card = document.getElementById('instructorDevDebugCard');
  if (!card) return;

  const params = new URLSearchParams(window.location.search);
  const showDebug = params.get('debug') === '1' || params.get('debug') === 'true';

  if (!showDebug) {
    card.style.display = 'none';
  } else {
    card.style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initInstructorDebugCard();
  loadInstructorClassPage();

  // Filter buttons
  const filtersContainer = document.getElementById('instrClassFilters');
  if (filtersContainer) {
    Array.from(filtersContainer.querySelectorAll('.instr-class-filter')).forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter') || 'all';
        Array.from(filtersContainer.querySelectorAll('.instr-class-filter')).forEach(b => {
          b.classList.toggle('active', b === btn);
        });
        applyPostFilter(filter);
      });
    });
  }

  // New post modal wiring
  const newPostBtn = document.getElementById('btnInstructorNewPost');
  const modalEl = document.getElementById('instructorPostModal');
  const modalCloseEl = document.getElementById('instrPostModalClose');
  const modalCancelEl = document.getElementById('instrPostModalCancel');
  const postTypeEl = document.getElementById('postType');
  const postTitleEl = document.getElementById('postTitle');
  const postBodyEl = document.getElementById('postBody');
  const postLinkUrlEl = document.getElementById('postLinkUrl');
  const postDueDateEl = document.getElementById('postDueDate');
  const postMaxScoreEl = document.getElementById('postMaxScore');
  const postAttachmentInput = document.getElementById('postAttachmentInput');
  const postErrorEl = document.getElementById('postError');
  const postTaskMetaGroup = document.getElementById('postTaskMetaGroup');
  const postAttachmentGroup = document.getElementById('postAttachmentGroup');
  const savePostBtn = document.getElementById('btnSavePost');

  function openPostModal() {
    if (!modalEl) return;
    // Clear editing flag
    delete modalEl.dataset.editingPostId;
    // Reset modal title
    const modalHeader = modalEl.querySelector('.history-modal-header h2');
    if (modalHeader) modalHeader.textContent = 'Create New Post';
    if (postTypeEl) {
      postTypeEl.value = 'announcement';
      postTypeEl.disabled = false;
    }
    if (postTitleEl) postTitleEl.value = '';
    if (postBodyEl) postBodyEl.value = '';
    if (postLinkUrlEl) postLinkUrlEl.value = '';
    if (postDueDateEl) postDueDateEl.value = '';
    if (postMaxScoreEl) postMaxScoreEl.value = '';
    if (postAttachmentInput) postAttachmentInput.value = '';
    updateAttachmentList(); // Clear attachment list display
    if (postErrorEl) {
      postErrorEl.style.display = 'none';
      postErrorEl.textContent = '';
    }
    if (postTaskMetaGroup) postTaskMetaGroup.style.display = 'none';
    if (postAttachmentGroup) postAttachmentGroup.style.display = 'none';
    if (savePostBtn) savePostBtn.textContent = 'Save Post';
    modalEl.style.display = 'flex';
  }

  function closePostModal() {
    if (modalEl) {
      modalEl.style.display = 'none';
      // Clear editing flag
      delete modalEl.dataset.editingPostId;
      // Reset modal title
      const modalHeader = modalEl.querySelector('.history-modal-header h2');
      if (modalHeader) modalHeader.textContent = 'Create New Post';
      // Re-enable type selector
      if (postTypeEl) postTypeEl.disabled = false;
      // Reset save button text
      if (savePostBtn) savePostBtn.textContent = 'Save Post';
    }
    // Clear attachment list when closing
    if (typeof updateAttachmentList === 'function') {
      updateAttachmentList();
    }
  }

  if (newPostBtn) {
    newPostBtn.addEventListener('click', () => {
      openPostModal();
    });
  }
  const newPostEmptyBtn = document.getElementById('btnInstructorNewPostEmpty');
  if (newPostEmptyBtn) {
    newPostEmptyBtn.addEventListener('click', () => {
      openPostModal();
    });
  }
  if (modalCloseEl) modalCloseEl.addEventListener('click', closePostModal);
  if (modalCancelEl) modalCancelEl.addEventListener('click', closePostModal);

  // Show/hide task meta and attachment inputs based on type
  if (postTypeEl) {
    postTypeEl.addEventListener('change', () => {
      const type = postTypeEl.value;
      const t = (type || '').toLowerCase();
      if (postTaskMetaGroup) {
        postTaskMetaGroup.style.display = t === 'task' ? 'block' : 'none';
      }
      if (postAttachmentGroup) {
        postAttachmentGroup.style.display = (t === 'material' || t === 'task') ? 'block' : 'none';
      }
      // Clear attachments when switching away from material/task
      if (t !== 'material' && t !== 'task') {
        if (postAttachmentInput) postAttachmentInput.value = '';
        updateAttachmentList();
      }
    });
    // Trigger once to set initial state
    postTypeEl.dispatchEvent(new Event('change'));
  }

  // Handle file input change to show selected files
  if (postAttachmentInput) {
    postAttachmentInput.addEventListener('change', () => {
      updateAttachmentList();
    });
  }

  // Clear attachments button
  const postAttachmentClearBtn = document.getElementById('postAttachmentClearBtn');
  if (postAttachmentClearBtn) {
    postAttachmentClearBtn.addEventListener('click', () => {
      if (postAttachmentInput) postAttachmentInput.value = '';
      updateAttachmentList();
    });
  }

  /**
   * Updates the attachment list display based on selected files
   */
  function updateAttachmentList() {
    const attachmentListEl = document.getElementById('postAttachmentList');
    const attachmentListItemsEl = document.getElementById('postAttachmentListItems');
    
    if (!attachmentListEl || !attachmentListItemsEl || !postAttachmentInput) return;
    
    const files = Array.from(postAttachmentInput.files || []);
    
    if (files.length === 0) {
      attachmentListEl.style.display = 'none';
      return;
    }
    
    attachmentListEl.style.display = 'block';
    attachmentListItemsEl.innerHTML = files.map((file, index) => {
      const fileSize = file.size ? ` (${formatFileSize(file.size)})` : '';
      return `
        <li class="instr-attachment-item">
          <span class="instr-attachment-name">${escapeHtml(file.name)}${fileSize}</span>
          <button type="button" class="instr-attachment-remove-btn" data-index="${index}">×</button>
        </li>
      `;
    }).join('');
    
    // Attach remove buttons
    Array.from(attachmentListItemsEl.querySelectorAll('.instr-attachment-remove-btn')).forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.getAttribute('data-index'));
        removeFileFromInput(index);
      });
    });
  }

  /**
   * Removes a file from the file input by index
   */
  function removeFileFromInput(index) {
    if (!postAttachmentInput) return;
    
    const files = Array.from(postAttachmentInput.files);
    files.splice(index, 1);
    
    // Create a new FileList-like object
    const dataTransfer = new DataTransfer();
    files.forEach(file => dataTransfer.items.add(file));
    postAttachmentInput.files = dataTransfer.files;
    
    updateAttachmentList();
  }

  /**
   * Formats file size to human-readable format
   */
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Escapes HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Save post handler
  if (savePostBtn) {
    let isSubmitting = false; // Guard against multiple submissions
    
    savePostBtn.addEventListener('click', async () => {
      // Prevent multiple simultaneous submissions
      if (isSubmitting || savePostBtn.disabled) {
        return;
      }
      
      if (!postTypeEl || !postTitleEl || !postBodyEl) return;

      const type = (postTypeEl.value || '').toLowerCase();
      const title = (postTitleEl.value || '').trim();
      const body = (postBodyEl.value || '').trim();
      const linkUrl = (postLinkUrlEl && postLinkUrlEl.value.trim()) || null;
      const dueDate = postDueDateEl && postDueDateEl.value ? postDueDateEl.value : null;
      const maxScoreRaw = postMaxScoreEl && postMaxScoreEl.value !== '' ? postMaxScoreEl.value : null;
      const maxScore = maxScoreRaw != null ? Number(maxScoreRaw) : null;
      const files = postAttachmentInput && postAttachmentInput.files && postAttachmentInput.files.length > 0
        ? Array.from(postAttachmentInput.files)
        : [];

      if (!title || !body || !type) {
        if (postErrorEl) {
          postErrorEl.textContent = 'Type, title, and body are required.';
          postErrorEl.style.display = 'block';
        }
      return;
    }

      if (postErrorEl) {
        postErrorEl.style.display = 'none';
        postErrorEl.textContent = '';
      }

      // Set submitting flag and disable button immediately
      isSubmitting = true;
      savePostBtn.disabled = true;
      savePostBtn.textContent = 'Saving...';

      const classData = instructorClassState.classData;
      const classId = classData && (classData.classId || classData.id);
      const modal = document.getElementById('instructorPostModal');
      const isEditing = modal && modal.dataset.editingPostId;
      const postId = isEditing ? modal.dataset.editingPostId : null;
    
    let attachments = [];
    
      // Upload attachments first if needed (only for new posts or when adding new attachments)
      if (files.length > 0 && (type === 'material' || type === 'task') && !isEditing) {
      try {
          const token = instructorAPI.getToken();
        const formData = new FormData();
          if (classId) {
            formData.append('classId', classId);
        }
          // Append all files
          files.forEach(file => {
            formData.append('files', file);
          });
        
          const uploadResponse = await fetch('/api/instructor/class/upload-attachment', {
          method: 'POST',
          headers: {
              Authorization: `Bearer ${token}`
          },
          body: formData
        });
        
          if (!uploadResponse.ok) {
            const errData = await uploadResponse.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to upload attachments');
          }

          const uploadData = await uploadResponse.json();
          attachments = Array.isArray(uploadData.files) ? uploadData.files : [];
        } catch (err) {
          console.error('Attachment upload error:', err);
          if (postErrorEl) {
            postErrorEl.textContent = err.message || 'Failed to upload attachments.';
            postErrorEl.style.display = 'block';
          }
          // Re-enable button on error
          isSubmitting = false;
          savePostBtn.disabled = false;
          savePostBtn.textContent = isEditing ? 'Update Post' : 'Save Post';
        return;
      }
    }

      try {
        if (isEditing && postId) {
          // Update existing post
          const token = instructorAPI.getToken();
          const updatePayload = {
            title,
            body,
            linkUrl
          };

          if (type === 'task') {
            updatePayload.dueDate = dueDate;
            updatePayload.maxScore = maxScore;
          }

          const updateResponse = await fetch(`/api/class/${classId}/posts/${postId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(updatePayload)
          });

          const updateData = await updateResponse.json().catch(() => null);
          if (!updateResponse.ok || !updateData || !updateData.success) {
            throw new Error(updateData?.error || 'Failed to update post');
          }

          // Reload posts and refresh UI
          try {
            const postsResponse = await instructorAPI.get('/class/posts');
            const posts = (postsResponse && postsResponse.success && Array.isArray(postsResponse.posts))
              ? postsResponse.posts
              : [];
            instructorClassState.posts = posts;
            applyPostFilter(instructorClassState.activeFilter || 'all');
            // Keep the edited post selected
            instructorClassState.selectedPostId = postId;
            renderPostDetails();
          } catch (postsErr) {
            console.warn('Unable to refresh posts after update:', postsErr);
          }

          closePostModal();
          // Clear editing flag
          if (modal) delete modal.dataset.editingPostId;
          // Reset modal title
          const modalHeader = modal?.querySelector('.history-modal-header h2');
          if (modalHeader) modalHeader.textContent = 'Create New Post';
          if (postTypeEl) postTypeEl.disabled = false;
          if (savePostBtn) savePostBtn.textContent = 'Save Post';
        } else {
          // Create new post
          const payload = {
            type,
            title,
            body,
            linkUrl,
            attachments
          };

          if (type === 'task') {
            payload.dueDate = dueDate;
            payload.maxScore = maxScore;
          }

          const createResponse = await instructorAPI.post('/class/posts', payload);
          if (!createResponse || !createResponse.success) {
            throw new Error(createResponse?.error || 'Failed to create post');
          }

          // Reload posts and refresh UI
          try {
            const postsResponse = await instructorAPI.get('/class/posts');
            const posts = (postsResponse && postsResponse.success && Array.isArray(postsResponse.posts))
              ? postsResponse.posts
              : [];
            instructorClassState.posts = posts;
            applyPostFilter(instructorClassState.activeFilter || 'all');
            // Select the newly created post
            const newPostId = createResponse.post && (createResponse.post.id || createResponse.post.postId);
            instructorClassState.selectedPostId = newPostId || null;
            renderPostDetails();
          } catch (postsErr) {
            console.warn('Unable to refresh posts after creation:', postsErr);
          }

          closePostModal();
        }

        // Clear attachment list after successful post creation/update
        if (postAttachmentInput) postAttachmentInput.value = '';
        updateAttachmentList();
        isSubmitting = false; // Reset flag on success
      } catch (err) {
        console.error(isEditing ? 'Update' : 'Create', 'post error:', err);
        if (postErrorEl) {
          postErrorEl.textContent = err.message || `Failed to ${isEditing ? 'update' : 'create'} post.`;
          postErrorEl.style.display = 'block';
        }
        isSubmitting = false; // Reset flag on error
      } finally {
        savePostBtn.disabled = false;
        savePostBtn.textContent = isEditing ? 'Update Post' : 'Save Post';
      }
    });
  }

  // Close modal when clicking outside
  window.addEventListener('click', (event) => {
    const modal = document.getElementById('instructorPostModal');
    if (modal && event.target === modal) {
      closePostModal();
    }
  });

  // Developer debug collapsible behavior
  const debugCard = document.getElementById('instrClassDebugCard');
  const debugToggle = document.getElementById('instrClassDebugToggle');
  const debugBody = document.getElementById('instrClassDebugBody');
  if (debugCard && debugToggle && debugBody) {
    const labelSpan = debugToggle.querySelector('.instr-class-debug-toggle-label');
    const urlParams = new URLSearchParams(window.location.search);
    const debugParam = urlParams.get('debug');
    const shouldExpand = debugParam === '1';

    if (!shouldExpand) {
      debugBody.classList.add('collapsed');
      if (labelSpan) labelSpan.textContent = 'Show';
    } else if (labelSpan) {
      labelSpan.textContent = 'Hide';
    }

    debugToggle.addEventListener('click', () => {
      const isCollapsed = debugBody.classList.toggle('collapsed');
      if (labelSpan) {
        labelSpan.textContent = isCollapsed ? 'Show' : 'Hide';
      }
    });
  }

  // Post detail tabs
  const commentsTabBtn = document.getElementById('instrPostTabCommentsButton');
  const submissionsTabBtn = document.getElementById('instrPostTabSubmissionsButton');
  const commentsPanel = document.getElementById('instrPostTabCommentsPanel');
  const submissionsPanel = document.getElementById('instrPostTabSubmissionsPanel');
  const commentSubmitBtn = document.getElementById('instrPostCommentSubmit');

  if (commentsTabBtn && commentsPanel && submissionsTabBtn && submissionsPanel) {
    commentsTabBtn.addEventListener('click', () => {
      instructorClassState.activePostTab = 'comments';
      commentsTabBtn.classList.add('instr-post-tab-active');
      submissionsTabBtn.classList.remove('instr-post-tab-active');
      commentsPanel.style.display = 'block';
      submissionsPanel.style.display = 'none';
      loadInstructorPostComments().catch(err => {
        console.warn('Failed to reload comments on tab switch:', err);
      });
    });

    submissionsTabBtn.addEventListener('click', () => {
      instructorClassState.activePostTab = 'submissions';
      commentsTabBtn.classList.remove('instr-post-tab-active');
      submissionsTabBtn.classList.add('instr-post-tab-active');
      commentsPanel.style.display = 'none';
      submissionsPanel.style.display = 'block';
      loadInstructorPostSubmissions(true).catch(err => {
        console.warn('Failed to load submissions on tab switch:', err);
      });
    });
  }

  if (commentSubmitBtn) {
    commentSubmitBtn.addEventListener('click', () => {
      submitInstructorComment();
    });
  }

  // Wire up textarea input listener to enable/disable Post button
  const commentInputEl = document.getElementById('instrPostCommentInput');
  if (commentInputEl) {
    commentInputEl.addEventListener('input', updateCommentSubmitButton);
    commentInputEl.addEventListener('keyup', updateCommentSubmitButton);
    // Also check on paste
    commentInputEl.addEventListener('paste', () => {
      setTimeout(updateCommentSubmitButton, 10);
    });
    // Initial check
    updateCommentSubmitButton();
  }

  // Grade modal wiring
  const gradeModal = document.getElementById('instrGradeModal');
  const gradeClose = document.getElementById('instrGradeModalClose');
  const gradeCancel = document.getElementById('instrGradeModalCancel');
  const gradeSave = document.getElementById('instrGradeModalSave');

  function closeGradeIfBackdrop(e) {
    if (gradeModal && e.target === gradeModal) {
      closeGradeModal();
    }
  }

  if (gradeClose) gradeClose.addEventListener('click', closeGradeModal);
  if (gradeCancel) gradeCancel.addEventListener('click', closeGradeModal);
  if (gradeSave) gradeSave.addEventListener('click', saveGradeFromModal);
  if (gradeModal) {
    window.addEventListener('click', closeGradeIfBackdrop);
  }

  // Delete confirmation modal wiring
  const deleteModal = document.getElementById('instrDeleteConfirmModal');
  const deleteClose = document.getElementById('instrDeleteModalClose');
  const deleteCancel = document.getElementById('instrDeleteModalCancel');

  function closeDeleteIfBackdrop(e) {
    if (deleteModal && e.target === deleteModal) {
      closeDeleteConfirmModal();
    }
  }

  if (deleteClose) deleteClose.addEventListener('click', closeDeleteConfirmModal);
  if (deleteCancel) deleteCancel.addEventListener('click', closeDeleteConfirmModal);
  if (deleteModal) {
    window.addEventListener('click', closeDeleteIfBackdrop);
  }
});
