// Student Class Page JavaScript

const token = localStorage.getItem('studentToken');
if (!token) {
    window.location.href = '/caresim-login';
}

let currentClass = null;
let currentPosts = [];
let filteredPosts = []; // Filtered posts based on active filter
let activeFilter = 'all'; // Current filter: 'all', 'announcement', 'material', 'task'
let currentPostId = null; // For task submission
let selectedPostId = null; // Currently selected post for details view
let postSubmissions = {}; // Cache of submission data by postId

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    loadClassData();
});

// ============================================
// API Functions
// ============================================

async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(`/api/class${endpoint}`, {
            ...options,
            headers: {
                'Authorization': `Bearer ${token}`,
                ...(options.headers || {})
            }
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('studentToken');
            window.location.href = '/caresim-login';
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error('API call error:', error);
        return null;
    }
}

// ============================================
// Load Class Data
// ============================================

async function loadClassData() {
    showLoading();
    
    const data = await apiCall('/me');
    
    if (!data || !data.success || !data.class) {
        hideLoading();
        showNoClassMessage();
        return;
    }
    
    currentClass = data.class;
    renderClassHeader();
    await loadPosts();
    hideLoading();
}

function showLoading() {
    document.getElementById('loadingOverlay').style.display = 'flex';
    document.getElementById('noClassMessage').style.display = 'none';
    document.getElementById('classHeader').style.display = 'none';
    const layoutEl = document.getElementById('studentClassLayout');
    if (layoutEl) layoutEl.style.display = 'none';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

function showNoClassMessage() {
    document.getElementById('noClassMessage').style.display = 'block';
    document.getElementById('classHeader').style.display = 'none';
    const layoutEl = document.getElementById('studentClassLayout');
    if (layoutEl) layoutEl.style.display = 'none';
}

function renderClassHeader() {
    const className = currentClass.name || 'My Class';
    const courseName = currentClass.courseName || '';
    const batchYear = currentClass.batchYear || '';
    const classInfo = [courseName, batchYear].filter(Boolean).join(' • ') || 'No additional info';
    
    document.getElementById('className').textContent = className;
    document.getElementById('classInfo').textContent = classInfo;
    document.getElementById('classHeader').style.display = 'block';
    
    // Show layout
    const layoutEl = document.getElementById('studentClassLayout');
    if (layoutEl) layoutEl.style.display = 'grid';
    
    // Ensure filter listeners are attached
    attachFilterListeners();
}

/**
 * Attaches event listeners to filter buttons
 */
function attachFilterListeners() {
    const filtersContainer = document.getElementById('studentClassFilters');
    if (!filtersContainer) return;
    
    // Use event delegation on the container to handle clicks
    filtersContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.student-class-filter');
        if (!btn) return;
        
        const filter = btn.getAttribute('data-filter') || 'all';
        Array.from(filtersContainer.querySelectorAll('.student-class-filter')).forEach(b => {
            b.classList.toggle('active', b === btn);
        });
        applyPostFilter(filter);
    });
}

// ============================================
// Load Posts
// ============================================

async function loadPosts() {
    if (!currentClass || !currentClass.classId) return;
    
    const data = await apiCall(`/${currentClass.classId}/posts`);
    
    if (!data || !data.success) {
        const feedEl = document.getElementById('classFeed');
        if (feedEl) {
            feedEl.innerHTML = '<p class="student-class-empty-text">Failed to load posts.</p>';
        }
        return;
    }
    
    currentPosts = data.posts || [];
    applyPostFilter(activeFilter);
    
    // Auto-select first post if none selected
    if (filteredPosts.length > 0 && !selectedPostId) {
        selectPost(filteredPosts[0].postId || filteredPosts[0].id);
    }
}

/**
 * Applies the active filter to posts and re-renders
 */
function applyPostFilter(filter) {
    activeFilter = filter;
    
    if (!filter || filter === 'all') {
        filteredPosts = currentPosts;
    } else {
        const f = filter.toLowerCase();
        filteredPosts = currentPosts.filter(p => (p.type || '').toLowerCase() === f);
    }
    
    renderPosts();
}

function renderPosts() {
    const feed = document.getElementById('classFeed');
    if (!feed) return;
    
    if (filteredPosts.length === 0) {
        if (currentPosts.length === 0) {
            feed.innerHTML = '<div class="student-class-empty"><p class="student-class-empty-text">No posts yet. Check back later!</p></div>';
        } else {
            feed.innerHTML = '<div class="student-class-empty"><p class="student-class-empty-text">No posts match the selected filter.</p></div>';
        }
        return;
    }
    
    feed.innerHTML = filteredPosts.map(post => renderPostCard(post)).join('');
    
    // Attach click handlers for post selection
    filteredPosts.forEach(post => {
        const postId = post.postId || post.id;
        const cardEl = feed.querySelector(`[data-post-id="${postId}"]`);
        if (cardEl) {
            cardEl.addEventListener('click', () => {
                selectPost(postId);
            });
        }
        
        // Load task submission status for feed cards
        if (post.type === 'task') {
            loadTaskSubmissionStatus(postId);
        }
    });
}

function renderPostCard(post) {
    const postId = post.postId || post.id;
    const typeBadge = getTypeBadge(post.type);
    const date = formatDate(post.createdAt);
    const bodyPreview = post.body.length > 160 ? post.body.substring(0, 157) + '...' : post.body;
    const attachmentCount = post.attachmentUrl ? 1 : (Array.isArray(post.attachments) ? post.attachments.length : 0);
    const isSelected = selectedPostId === postId;
    
    // Get task status for badge
    let taskStatusBadge = '';
    if (post.type === 'task') {
        const submission = postSubmissions[postId];
        let statusText = 'NOT STARTED';
        let statusClass = 'status-not-started';
        
        if (submission) {
            if (submission.score !== null && submission.score !== undefined) {
                statusText = 'GRADED';
                statusClass = 'status-graded';
            } else {
                statusText = 'SUBMITTED';
                statusClass = 'status-submitted';
            }
        }
        
        taskStatusBadge = `<span class="status-pill status-pill--${statusClass}">${statusText}</span>`;
    }
    
    return `
        <button
            type="button"
            class="student-class-feed-item ${isSelected ? 'selected' : ''}"
            data-post-id="${postId}"
        >
            <div class="student-class-feed-item-header">
                <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                    <span class="student-post-type-badge ${typeBadge.class}">${typeBadge.label}</span>
                    <h3>${escapeHtml(post.title)}</h3>
                </div>
                ${taskStatusBadge ? `<div style="flex-shrink: 0;">${taskStatusBadge}</div>` : ''}
            </div>
            <p class="student-class-feed-preview">${escapeHtml(bodyPreview.replace(/\n/g, ' '))}</p>
            <p class="student-class-feed-meta">
                <span>${escapeHtml(post.createdByName || 'Instructor')}</span>
                ${date ? `<span>• ${date}</span>` : ''}
                ${attachmentCount > 0 ? `<span>• ${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}</span>` : ''}
            </p>
        </button>
    `;
}


// ============================================
// Task Submission
// ============================================

function openSubmitTaskModal(postId) {
    currentPostId = postId;
    document.getElementById('submitTaskModal').style.display = 'flex';
    document.getElementById('submitTaskForm').reset();
}

function closeSubmitTaskModal() {
    document.getElementById('submitTaskModal').style.display = 'none';
    currentPostId = null;
}

document.getElementById('submitTaskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!currentPostId || !currentClass) return;
    
    const fileInput = document.getElementById('submissionFile');
    if (!fileInput.files[0]) {
        alert('Please select a file');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    
    try {
        const response = await fetch(`/api/class/${currentClass.classId}/posts/${currentPostId}/submission`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('studentToken');
            window.location.href = '/caresim-login';
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            closeSubmitTaskModal();
            // Reload submission status for this post
            await loadTaskSubmissionStatus(currentPostId);
            // Re-render posts to update status badges
            renderPosts();
            // If this post is selected, update its details
            if (selectedPostId === currentPostId) {
                const post = currentPosts.find(p => (p.postId || p.id) === currentPostId);
                if (post) {
                    renderPostDetails(post);
                }
            }
            alert('Task submitted successfully!');
        } else {
            alert('Failed to submit task: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error submitting task:', error);
        alert('Error submitting task. Please try again.');
    }
});

function resubmitTask(postId) {
    currentPostId = postId;
    openSubmitTaskModal(postId);
}

// Wire up comment form on page load
document.addEventListener('DOMContentLoaded', () => {
    // Filter buttons
    const filtersContainer = document.getElementById('studentClassFilters');
    if (filtersContainer) {
        Array.from(filtersContainer.querySelectorAll('.student-class-filter')).forEach(btn => {
            btn.addEventListener('click', () => {
                const filter = btn.getAttribute('data-filter') || 'all';
                Array.from(filtersContainer.querySelectorAll('.student-class-filter')).forEach(b => {
                    b.classList.toggle('active', b === btn);
                });
                applyPostFilter(filter);
            });
        });
    }
    
    // Comment form
    const commentInputEl = document.getElementById('studentPostCommentInput');
    const commentSubmitBtn = document.getElementById('studentPostCommentSubmit');
    
    if (commentInputEl) {
        commentInputEl.addEventListener('input', updateStudentCommentButton);
        commentInputEl.addEventListener('keyup', updateStudentCommentButton);
        commentInputEl.addEventListener('paste', () => {
            setTimeout(updateStudentCommentButton, 10);
        });
    }
    
    if (commentSubmitBtn) {
        commentSubmitBtn.addEventListener('click', submitStudentComment);
    }
});

async function viewSubmission(postId) {
    const submissionData = await apiCall(`/${currentClass.classId}/posts/${postId}/submission/me`);
    const submission = submissionData?.submission;
    
    if (!submission) {
        alert('Submission not found');
        return;
    }
    
    const content = `
        <div class="submission-details">
            <div class="submission-info">
                <p><strong>Submitted:</strong> ${formatDate(submission.submittedAt)}</p>
                <p><strong>File:</strong> ${escapeHtml(submission.attachmentName || 'N/A')}</p>
                ${submission.score !== null ? `<p><strong>Score:</strong> ${submission.score}${submission.feedback ? ` / ${submission.feedback}` : ''}</p>` : ''}
                ${submission.feedback ? `<div class="submission-feedback"><strong>Feedback:</strong><p>${escapeHtml(submission.feedback)}</p></div>` : ''}
            </div>
            <div class="submission-actions">
                <a href="${submission.attachmentUrl}" target="_blank" class="btn-primary" download>Download File</a>
            </div>
        </div>
    `;
    
    document.getElementById('viewSubmissionContent').innerHTML = content;
    document.getElementById('viewSubmissionModal').style.display = 'flex';
}

function closeViewSubmissionModal() {
    document.getElementById('viewSubmissionModal').style.display = 'none';
}

// ============================================
// Comments
// ============================================

/**
 * Loads comments for the selected post
 */
async function loadPostComments(postId) {
    const commentsList = document.getElementById('studentPostCommentsList');
    const emptyHintEl = document.getElementById('studentPostCommentsEmptyHint');
    if (!commentsList || !currentClass) return;
    
    try {
        const data = await apiCall(`/${currentClass.classId}/posts/${postId}/comments`);
        
        if (!data || !data.success) {
            commentsList.innerHTML = '<p class="student-post-empty">Failed to load comments.</p>';
            if (emptyHintEl) emptyHintEl.style.display = 'none';
            return;
        }
        
        const comments = data.comments || [];
        
        if (comments.length === 0) {
            commentsList.innerHTML = '';
            if (emptyHintEl) emptyHintEl.style.display = 'block';
            return;
        }
        
        // Hide empty hint when there are comments
        if (emptyHintEl) emptyHintEl.style.display = 'none';
        
        // Get current student info to identify if commenter is the current student
        const currentStudentName = currentClass?.studentName || null;
        
        commentsList.innerHTML = comments.map(comment => {
            const author = comment.authorName || 'User';
            const createdAt = formatDate(comment.createdAt) || '';
            const isInstructor = comment.authorRole === 'instructor' || comment.isInstructor || false;
            const isCurrentStudent = currentStudentName && author.toLowerCase() === currentStudentName.toLowerCase();
            
            let roleBadge = '';
            if (isInstructor) {
                roleBadge = '<span class="sc-comment-role sc-comment-role--instructor">Instructor</span>';
            } else if (isCurrentStudent) {
                roleBadge = '<span class="sc-comment-role sc-comment-role--student">You</span>';
            }
            
            return `
                <div class="sc-comment">
                    <div class="sc-comment-header">
                        <div class="sc-comment-header-left">
                            <span class="sc-comment-author">${escapeHtml(author)}</span>
                            ${roleBadge}
                        </div>
                        ${createdAt ? `<span class="sc-comment-date">${createdAt}</span>` : ''}
                    </div>
                    <div class="sc-comment-body">${escapeHtml(comment.body).replace(/\n/g, '<br>')}</div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Error loading comments:', err);
        commentsList.innerHTML = '<p class="student-post-empty">Failed to load comments.</p>';
        if (emptyHintEl) emptyHintEl.style.display = 'none';
    }
}

/**
 * Posts a comment for the selected post
 */
async function submitStudentComment() {
    if (!selectedPostId || !currentClass) return;
    
    const inputEl = document.getElementById('studentPostCommentInput');
    const submitBtn = document.getElementById('studentPostCommentSubmit');
    if (!inputEl) return;
    
    const body = inputEl.value.trim();
    if (!body) return; // Button should be disabled
    
    // Disable button while submitting
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Posting...';
    }
    
    try {
        const data = await apiCall(`/${currentClass.classId}/posts/${selectedPostId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ body })
        });
        
        if (data && data.success) {
            // Clear textarea and disable button
            inputEl.value = '';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Post';
            }
            
            // Reload comments
            await loadPostComments(selectedPostId);
            
            // Refocus textarea
            setTimeout(() => {
                inputEl.focus();
            }, 100);
        } else {
            alert('Failed to post comment: ' + (data?.error || 'Unknown error'));
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Post';
                updateStudentCommentButton();
            }
        }
    } catch (err) {
        console.error('Error posting comment:', err);
        alert('Failed to post comment. Please try again.');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Post';
            updateStudentCommentButton();
        }
    }
}

/**
 * Updates the Post button disabled state based on textarea content
 */
function updateStudentCommentButton() {
    const inputEl = document.getElementById('studentPostCommentInput');
    const submitBtn = document.getElementById('studentPostCommentSubmit');
    
    if (!inputEl || !submitBtn) return;
    
    const hasText = (inputEl.value || '').trim().length > 0;
    submitBtn.disabled = !hasText;
}

// ============================================
// Helper Functions
// ============================================

function getTypeBadge(type) {
    // Use instructor-style badge classes
    const badges = {
        announcement: { class: 'type-announcement', label: 'Announcement' },
        material: { class: 'type-material', label: 'Material' },
        task: { class: 'type-task', label: 'Task' },
        message: { class: 'type-message', label: 'Message' }
    };
    return badges[type] || { class: 'type-default', label: 'Post' };
}

/**
 * Selects a post and renders its details in the right column
 */
async function selectPost(postId) {
    selectedPostId = postId;
    
    // Update feed cards to show selected state
    renderPosts();
    
    // Find the post
    const post = currentPosts.find(p => (p.postId || p.id) === postId);
    if (!post) return;
    
    // Render post details
    renderPostDetails(post);
    
    // Load task submission if it's a task
    if (post.type === 'task') {
        await loadTaskSubmissionStatus(postId);
        renderPostDetails(post); // Re-render with updated submission data
    }
    
    // Load comments
    await loadPostComments(postId);
}

/**
 * Renders the selected post details in the right column
 */
function renderPostDetails(post) {
    const emptyEl = document.getElementById('studentPostDetailsEmpty');
    const contentEl = document.getElementById('studentPostDetailsContent');
    if (!emptyEl || !contentEl) return;
    
    emptyEl.style.display = 'none';
    contentEl.style.display = 'block';
    
    const typeBadge = getTypeBadge(post.type);
    const date = formatDate(post.createdAt);
    const createdBy = post.createdByName || 'Instructor';
    
    // Header
    const typeBadgeEl = document.getElementById('studentPostTypeBadge');
    const titleEl = document.getElementById('studentPostTitle');
    const metaEl = document.getElementById('studentPostMeta');
    
    if (typeBadgeEl) {
        typeBadgeEl.textContent = typeBadge.label;
        typeBadgeEl.className = `student-post-type-badge ${typeBadge.class}`;
    }
    if (titleEl) titleEl.textContent = post.title || '(No title)';
    if (metaEl) {
        metaEl.textContent = `${createdBy} • ${date}`;
    }
    
    // Body
    const bodyEl = document.getElementById('studentPostBody');
    if (bodyEl) {
        const safeBody = (post.body || '').replace(/\n/g, '<br>');
        bodyEl.innerHTML = safeBody;
    }
    
    // Link
    const linkContainerEl = document.getElementById('studentPostLinkContainer');
    const linkEl = document.getElementById('studentPostLink');
    if (linkContainerEl && linkEl) {
        if (post.linkUrl) {
            linkEl.href = post.linkUrl;
            linkEl.textContent = post.linkUrl;
            linkContainerEl.style.display = 'block';
        } else {
            linkContainerEl.style.display = 'none';
        }
    }
    
    // Attachments
    const attachmentsEl = document.getElementById('studentPostAttachments');
    if (attachmentsEl) {
        const attachments = [];
        const seenUrls = new Set(); // Track URLs to prevent duplicates
        
        // Add attachment from legacy attachmentUrl field if it exists
        if (post.attachmentUrl) {
            const url = post.attachmentUrl;
            if (!seenUrls.has(url)) {
                attachments.push({
                    name: post.attachmentName || 'Download',
                    url: url
                });
                seenUrls.add(url);
            }
        }
        
        // Add attachments from attachments array
        if (Array.isArray(post.attachments)) {
            post.attachments.forEach(att => {
                const url = att.url || att.attachmentUrl;
                if (url && !seenUrls.has(url)) {
                    attachments.push({
                        name: att.label || att.name || att.attachmentName || 'Attachment',
                        url: url
                    });
                    seenUrls.add(url);
                }
            });
        }
        
        if (attachments.length === 0) {
            attachmentsEl.style.display = 'none';
        } else {
            const items = attachments.map(att => {
                const name = att.name || 'Attachment';
                const url = att.url || '#';
                return `
                    <div class="sc-attachment-row">
                        <div class="sc-attachment-row-left">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0; margin-right: 8px; color: #64748B;">
                                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M14 2V8H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            <span class="sc-attachment-name">${escapeHtml(name)}</span>
                        </div>
                        <a href="${url}" target="_blank" rel="noopener" download class="sc-attachment-download">Download</a>
                    </div>
                `;
            }).join('');
            attachmentsEl.innerHTML = `<h4>Attachments</h4><div class="sc-attachments-list">${items}</div>`;
            attachmentsEl.style.display = 'block';
        }
    }
    
    // Task-specific sections
    const taskSectionEl = document.getElementById('studentPostTaskSection');
    if (taskSectionEl) {
        if (post.type === 'task') {
            taskSectionEl.style.display = 'block';
            renderTaskDetails(post);
        } else {
            taskSectionEl.style.display = 'none';
        }
    }
}

/**
 * Renders task-specific details (due date, status, score, submission controls)
 */
function renderTaskDetails(post) {
    const postId = post.postId || post.id;
    const submission = postSubmissions[postId];
    const taskMeta = post.taskMeta || {};
    
    // Due date
    const dueDateEl = document.getElementById('studentTaskDueDate');
    if (dueDateEl) {
        const dueDate = taskMeta.dueDate ? formatDate(taskMeta.dueDate) : 'No due date';
        dueDateEl.textContent = dueDate;
    }
    
    // Status
    const statusEl = document.getElementById('studentTaskStatus');
    if (statusEl) {
        let statusText = 'NOT STARTED';
        let statusClass = 'status-not-started';
        
        if (submission) {
            if (submission.score !== null && submission.score !== undefined) {
                statusText = 'GRADED';
                statusClass = 'status-graded';
            } else {
                statusText = 'SUBMITTED';
                statusClass = 'status-submitted';
            }
        }
        
        statusEl.textContent = statusText;
        statusEl.className = `status-pill status-pill--${statusClass}`;
    }
    
    // Score block
    const scoreBlockEl = document.getElementById('studentTaskScoreBlock');
    const scoreEl = document.getElementById('studentTaskScore');
    const feedbackEl = document.getElementById('studentTaskFeedback');
    const feedbackTextEl = document.getElementById('studentTaskFeedbackText');
    
    if (submission && submission.score !== null && submission.score !== undefined) {
        if (scoreBlockEl) scoreBlockEl.style.display = 'block';
        if (scoreEl) {
            const maxScore = taskMeta.maxScore ? ` / ${taskMeta.maxScore}` : '';
            scoreEl.textContent = `${submission.score}${maxScore}`;
        }
        if (submission.feedback && feedbackEl && feedbackTextEl) {
            feedbackEl.style.display = 'block';
            feedbackTextEl.textContent = submission.feedback;
        } else if (feedbackEl) {
            feedbackEl.style.display = 'none';
        }
    } else {
        if (scoreBlockEl) scoreBlockEl.style.display = 'none';
    }
    
    // Submission actions
    const actionsEl = document.getElementById('studentTaskSubmissionActions');
    if (actionsEl) {
        let actionsHtml = '';
        
        if (submission) {
            if (submission.score !== null && submission.score !== undefined) {
                actionsHtml = `
                    <div class="student-task-submission-info">
                        <p><strong>Submitted:</strong> ${formatDate(submission.submittedAt)}</p>
                        <p><strong>File:</strong> ${escapeHtml(submission.attachmentName || 'N/A')}</p>
                    </div>
                    <a href="${submission.attachmentUrl}" target="_blank" class="btn-primary" download>Download Submission</a>
                `;
            } else {
                actionsHtml = `
                    <div class="student-task-submission-info">
                        <p><strong>Submitted:</strong> ${formatDate(submission.submittedAt)}</p>
                        <p><strong>File:</strong> ${escapeHtml(submission.attachmentName || 'N/A')}</p>
                    </div>
                    <button type="button" class="btn-primary" onclick="resubmitTask('${postId}')">Resubmit</button>
                `;
            }
        } else {
            actionsHtml = `
                <button type="button" class="btn-primary" onclick="openSubmitTaskModal('${postId}')">Submit Work</button>
            `;
        }
        
        actionsEl.innerHTML = actionsHtml;
    }
}

/**
 * Loads task submission status for a post
 */
async function loadTaskSubmissionStatus(postId) {
    if (!currentClass || !currentClass.classId) return;
    
    try {
        const data = await apiCall(`/${currentClass.classId}/posts/${postId}/submission/me`);
        if (data && data.success) {
            postSubmissions[postId] = data.submission || null;
        }
    } catch (err) {
        console.warn('Failed to load task submission status:', err);
    }
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// Logout
// ============================================

function logout() {
    localStorage.removeItem('studentToken');
    window.location.href = '/caresim-login';
}



