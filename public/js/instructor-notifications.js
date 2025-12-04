/**
 * Global Instructor Notifications System
 * 
 * Provides a bell icon in the navbar that shows:
 * - Count of unread posts (posts with latestActivityAt > lastSeenAt)
 * - Dropdown panel listing unread posts
 * - Navigation to Class page with post selected
 */

const instructorNotifications = {
  activityByPost: {},
  lastSeenByPost: {},
  posts: [],
  computed: {
    unreadPosts: [],
    unreadCount: 0
  },
  isOpen: false
};

/**
 * Determines if a post has unread activity
 * @param {string} postId - Post ID
 * @returns {boolean} - true if post has new activity since last seen
 */
function isPostUnread(postId) {
  if (!postId) return false;

  const activity = instructorNotifications.activityByPost[postId];
  const seen = instructorNotifications.lastSeenByPost[postId];

  const latestActivityAt = activity?.latestActivityAt ? new Date(activity.latestActivityAt) : null;
  const lastSeenAt = seen ? new Date(seen) : null;

  if (!latestActivityAt) return false; // no activity at all
  if (!lastSeenAt) return true;       // never seen -> unread
  return latestActivityAt > lastSeenAt;
}

/**
 * Formats relative time (e.g., "3m ago", "2h ago", "Yesterday")
 */
function formatRelativeTime(dateString) {
  if (!dateString) return '';
  
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Generates activity summary text for a post
 */
function getActivitySummary(postId, activity) {
  if (!activity) return 'Updated';
  
  const parts = [];
  if (activity.needsGradingCount > 0) {
    parts.push(`${activity.needsGradingCount} need${activity.needsGradingCount > 1 ? 's' : ''} grading`);
  }
  if (activity.submissionCount > 0 && activity.needsGradingCount === 0) {
    parts.push(`${activity.submissionCount} submission${activity.submissionCount > 1 ? 's' : ''}`);
  }
  if (activity.commentCount > 0) {
    parts.push(`${activity.commentCount} comment${activity.commentCount > 1 ? 's' : ''}`);
  }
  
  return parts.length > 0 ? parts.join(' · ') : 'Updated';
}

/**
 * Gets post type label
 */
function getPostTypeLabel(type) {
  const t = (type || 'message').toLowerCase();
  if (t === 'announcement') return 'Announcement';
  if (t === 'material') return 'Material';
  if (t === 'task') return 'Task';
  if (t === 'message') return 'Message';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Gets post type badge class
 */
function getPostTypeBadgeClass(type) {
  const t = (type || 'message').toLowerCase();
  if (t === 'announcement') return 'type-announcement';
  if (t === 'material') return 'type-material';
  if (t === 'task') return 'type-task';
  if (t === 'message') return 'type-message';
  return 'type-default';
}

/**
 * Computes unread posts from current state
 */
function computeUnreadPosts() {
  const unread = [];
  
  instructorNotifications.posts.forEach(post => {
    const postId = post.id || post.postId;
    if (!postId) return;
    
    if (isPostUnread(postId)) {
      const activity = instructorNotifications.activityByPost[postId] || {};
      unread.push({
        postId,
        title: post.title || '(No title)',
        type: post.type || 'message',
        latestActivityAt: activity.latestActivityAt || post.createdAt,
        summaryText: getActivitySummary(postId, activity),
        commentCount: activity.commentCount || 0,
        submissionCount: activity.submissionCount || 0,
        needsGradingCount: activity.needsGradingCount || 0
      });
    }
  });

  // Sort by latestActivityAt descending
  unread.sort((a, b) => {
    const dateA = new Date(a.latestActivityAt || 0);
    const dateB = new Date(b.latestActivityAt || 0);
    return dateB - dateA;
  });

  instructorNotifications.computed.unreadPosts = unread;
  instructorNotifications.computed.unreadCount = unread.length;
}

/**
 * Loads activity and seen data for the instructor's class
 */
async function loadInstructorNotifications() {
  try {
    // First, get the instructor's main class
    const classResponse = await instructorAPI.get('/class');
    if (!classResponse || !classResponse.success || !classResponse.class) {
      console.warn('No class found for instructor');
      renderNotifications();
      return;
    }

    const classId = classResponse.class.classId || classResponse.class.id;
    if (!classId) {
      console.warn('Class ID not found');
      renderNotifications();
      return;
    }

    // Load posts for this class
    const postsResponse = await instructorAPI.get('/class/posts');
    const posts = (postsResponse && postsResponse.success && Array.isArray(postsResponse.posts))
      ? postsResponse.posts
      : [];
    
    instructorNotifications.posts = posts;

    // Load activity and seen data
    const token = instructorAPI.getToken();
    const response = await fetch(`/api/class/${classId}/post-activity`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.success) {
      console.warn('Failed to load notification data:', data && data.error);
      renderNotifications();
      return;
    }

    instructorNotifications.activityByPost =
      data.activity && typeof data.activity === 'object' ? data.activity : {};
    
    // Process lastSeenByPost
    const lastSeenByPost = data.lastSeenByPost && typeof data.lastSeenByPost === 'object' 
      ? data.lastSeenByPost 
      : {};
    instructorNotifications.lastSeenByPost = lastSeenByPost;

    computeUnreadPosts();
    renderNotifications();
  } catch (err) {
    console.error('Error loading instructor notifications:', err);
    renderNotifications();
  }
}

/**
 * Renders the bell badge and dropdown content
 */
function renderNotifications() {
  const badgeEl = document.getElementById('instrNotificationBadge');
  const dropdownEl = document.getElementById('instrNotificationDropdown');
  const listEl = document.getElementById('instrNotificationList');
  const emptyEl = document.getElementById('instrNotificationEmpty');

  if (!badgeEl || !dropdownEl || !listEl || !emptyEl) return;

  const count = instructorNotifications.computed.unreadCount;

  // Update badge
  if (count > 0) {
    badgeEl.textContent = count > 99 ? '99+' : String(count);
    badgeEl.style.display = 'flex';
  } else {
    badgeEl.style.display = 'none';
  }

  // Update dropdown content
  const unreadPosts = instructorNotifications.computed.unreadPosts;

  if (unreadPosts.length === 0) {
    listEl.style.display = 'none';
    emptyEl.style.display = 'block';
  } else {
    emptyEl.style.display = 'none';
    listEl.style.display = 'block';
    
    listEl.innerHTML = unreadPosts.map(post => {
      const typeLabel = getPostTypeLabel(post.type);
      const badgeClass = getPostTypeBadgeClass(post.type);
      const relativeTime = formatRelativeTime(post.latestActivityAt);
      const title = post.title.length > 50 ? post.title.substring(0, 47) + '...' : post.title;

      return `
        <button
          type="button"
          class="instr-notification-item"
          data-post-id="${post.postId}"
        >
          <div class="instr-notification-item-header">
            <span class="instr-post-type-badge ${badgeClass}">${typeLabel}</span>
            <span class="instr-notification-item-title">${title}</span>
          </div>
          <div class="instr-notification-item-meta">
            <span class="instr-notification-item-summary">${post.summaryText}</span>
            <span class="instr-notification-item-time">${relativeTime}</span>
          </div>
        </button>
      `;
    }).join('');

    // Attach click handlers
    Array.from(listEl.querySelectorAll('.instr-notification-item')).forEach(btn => {
      btn.addEventListener('click', () => {
        const postId = btn.getAttribute('data-post-id');
        navigateToPost(postId);
        closeNotificationDropdown();
      });
    });
  }
}

/**
 * Navigates to Class page with post selected
 */
function navigateToPost(postId) {
  if (!postId) return;
  
  const currentPath = window.location.pathname;
  if (currentPath === '/instructor-class') {
    // Already on class page - trigger selection via query param
    const url = new URL(window.location);
    url.searchParams.set('postId', postId);
    window.location.href = url.toString();
  } else {
    // Navigate to class page with postId query param
    window.location.href = `/instructor-class?postId=${encodeURIComponent(postId)}`;
  }
}

/**
 * Opens the notification dropdown
 */
function openNotificationDropdown() {
  const dropdownEl = document.getElementById('instrNotificationDropdown');
  const buttonEl = document.getElementById('instrNotificationButton');
  
  if (!dropdownEl || !buttonEl) return;
  
  instructorNotifications.isOpen = true;
  dropdownEl.style.display = 'block';
  buttonEl.classList.add('active');
  
  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick, true);
  }, 0);
}

/**
 * Closes the notification dropdown
 */
function closeNotificationDropdown() {
  const dropdownEl = document.getElementById('instrNotificationDropdown');
  const buttonEl = document.getElementById('instrNotificationButton');
  
  if (!dropdownEl || !buttonEl) return;
  
  instructorNotifications.isOpen = false;
  dropdownEl.style.display = 'none';
  buttonEl.classList.remove('active');
  
  document.removeEventListener('click', handleOutsideClick, true);
}

/**
 * Handles clicks outside the dropdown
 */
function handleOutsideClick(event) {
  const buttonEl = document.getElementById('instrNotificationButton');
  const dropdownEl = document.getElementById('instrNotificationDropdown');
  
  if (!buttonEl || !dropdownEl) return;
  
  if (!buttonEl.contains(event.target) && !dropdownEl.contains(event.target)) {
    closeNotificationDropdown();
  }
}

/**
 * Refreshes notifications (public API for other scripts to call)
 */
function refreshInstructorNotifications() {
  loadInstructorNotifications();
}

/**
 * Initializes the notification system
 */
function initInstructorNotifications() {
  const buttonEl = document.getElementById('instrNotificationButton');
  if (!buttonEl) return; // Not on an instructor page or bell not present

  // Attach click handler
  buttonEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (instructorNotifications.isOpen) {
      closeNotificationDropdown();
    } else {
      openNotificationDropdown();
      // Refresh when opening dropdown to ensure fresh data
      refreshInstructorNotifications();
    }
  });

  // Load initial data
  loadInstructorNotifications();

  // Refresh periodically (every 30 seconds for more real-time feel)
  setInterval(() => {
    loadInstructorNotifications();
  }, 30000);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initInstructorNotifications);
} else {
  initInstructorNotifications();
}

