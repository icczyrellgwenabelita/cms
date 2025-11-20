// Instructor Announcements JavaScript
let allAnnouncements = [];

document.addEventListener('DOMContentLoaded', async function() {
  // Check for token
  const token = localStorage.getItem('instructorToken');
  if (!token) {
    window.location.href = '/caresim-login';
    return;
  }

  try {
    // Load announcements
    await loadAnnouncements();
    
    // Setup form handler
    const form = document.querySelector('.announcement-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await createAnnouncement();
      });
    }
    
    const postButton = document.querySelector('.btn-save');
    if (postButton) {
      postButton.addEventListener('click', async (e) => {
        e.preventDefault();
        await createAnnouncement();
      });
    }
    
  } catch (error) {
    console.error('Announcements load error:', error);
    alert('Failed to load announcements. Please try again.');
  }
});

async function loadAnnouncements() {
  try {
    const data = await instructorAPI.get('/announcements');
    allAnnouncements = data.announcements || [];
    renderAnnouncements(allAnnouncements);
  } catch (error) {
    console.error('Load announcements error:', error);
    throw error;
  }
}

async function createAnnouncement() {
  const title = document.getElementById('announcementTitle')?.value;
  const message = document.getElementById('announcementMessage')?.value;
  const audience = document.getElementById('announcementAudience')?.value || 'students';
  const pinned = document.getElementById('pinAnnouncement')?.checked || false;
  
  if (!title || !message) {
    alert('Please fill in both title and message');
    return;
  }
  
  try {
    await instructorAPI.post('/announcements', {
      title,
      message,
      audience,
      pinned
    });
    
    // Clear form
    document.getElementById('announcementTitle').value = '';
    document.getElementById('announcementMessage').value = '';
    document.getElementById('pinAnnouncement').checked = false;
    
    // Reload announcements
    await loadAnnouncements();
    
    alert('Announcement posted successfully!');
  } catch (error) {
    console.error('Create announcement error:', error);
    alert('Failed to create announcement. Please try again.');
  }
}

async function deleteAnnouncement(id) {
  if (!confirm('Are you sure you want to delete this announcement?')) {
    return;
  }
  
  try {
    await instructorAPI.delete(`/announcements/${id}`);
    await loadAnnouncements();
  } catch (error) {
    console.error('Delete announcement error:', error);
    alert('Failed to delete announcement. Please try again.');
  }
}

function renderAnnouncements(announcements) {
  const container = document.querySelector('.announcement-list') ||
                    document.querySelector('.announcements-list');
  if (!container) return;

  const emptyState = document.querySelector('.announcement-empty-state');

  if (!announcements || announcements.length === 0) {
    container.innerHTML = '';
    if (emptyState) {
      emptyState.classList.remove('hidden');
    }
    return;
  }

  // Hide empty state when we have announcements
  if (emptyState) {
    emptyState.classList.add('hidden');
  }

  // Sort: pinned first, then newest first
  const sorted = [...announcements].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  container.innerHTML = sorted.map((announcement) => {
    const date = announcement.createdAt
      ? new Date(announcement.createdAt)
      : new Date();

    const formattedDate = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    const audienceLabel =
      announcement.audience === 'all' || announcement.audience === 'students'
        ? 'All Students'
        : announcement.audience || 'Students';

    const safeMessage = (announcement.message || '').replace(/\n/g, '<br>');

    return `
      <div class="announcement-item ${announcement.pinned ? 'pinned' : ''}">
        <div class="announcement-item-header">
          <div>
            <h3>${announcement.title || 'Untitled'}${
      announcement.pinned
        ? ' <span class="announcement-badge">Pinned</span>'
        : ''
    }</h3>
            <p class="announcement-meta">${formattedDate} • Audience: ${audienceLabel}</p>
          </div>
          <div class="announcement-item-actions">
            <button class="announcement-action-btn danger" onclick="deleteAnnouncement('${
              announcement.id
            }')">Delete</button>
          </div>
        </div>
        <p class="announcement-preview">${safeMessage}</p>
      </div>
    `;
  }).join('');
}

function logout() {
  if (confirm('Are you sure you want to log out?')) {
    localStorage.removeItem('instructorToken');
    window.location.href = '/caresim-login';
  }
}

