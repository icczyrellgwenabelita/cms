// Student Lessons Page - Coursera-style LMS Reader
// Pure LMS focus - NO game data

const token = localStorage.getItem('studentToken');
if (!token) {
  window.location.href = '/caresim-login';
}

// State
let dashboardData = null;
let currentLessonSlot = null;
let currentPageId = null;
let currentPages = [];
let currentAssessments = [];
let currentLessonMeta = null;
let lessonPagesMap = {}; // Map of slot -> pages array
let viewMode = 'intro'; // 'intro' or 'page'
let currentViewMode = 'lessons'; // 'lessons' | 'videos' | 'tools'
let allVideos = [];
let allTools = [];
let selectedVideoId = null;
let selectedToolId = null;

// Time tracking for LMS pages
let pageViewStartTime = null;

// Cached assessment results by page (key: `${lessonSlot}_${pageId}`)
let lastAssessmentResultByPage = {};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadLessons();
  
  // Check URL for lesson parameter
  const urlParams = new URLSearchParams(window.location.search);
  const lessonParam = urlParams.get('lesson');
  if (lessonParam) {
    const slot = parseInt(lessonParam, 10);
    if (slot >= 1 && slot <= 6) {
      // Wait for lessons to load, then select lesson
      // Use a small delay to ensure dashboard data is loaded
      setTimeout(() => selectLesson(slot, true), 300);
    }
  }

  // Flush time spent when leaving page
  window.addEventListener('beforeunload', async () => {
    try {
      await flushPageTimeSpent();
    } catch (e) {
      // Ignore errors on unload
    }
  });
});

// ============================================
// Load Lessons from Dashboard API
// ============================================

async function loadLessons() {
  try {
    const response = await fetch('/api/student/dashboard?t=' + Date.now(), {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('studentToken');
      window.location.href = '/caresim-login';
      return;
    }

    if (!response.ok) {
      throw new Error('Failed to fetch dashboard data');
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error('Invalid response from server');
    }

    dashboardData = data;
    renderLessonsList();
    updateLessonsProgress();
  } catch (error) {
    console.error('Error loading lessons:', error);
    showAlertModal('Failed to load lessons. Please try again.', 'Error');
  }
}

// ============================================
// Render Lessons List (Left Panel - Expandable)
// ============================================

function renderLessonsList() {
  const container = document.getElementById('lessonsList');
  if (!container || !dashboardData) return;

  const lmsLessons = (dashboardData.lms && dashboardData.lms.lessons) || [];

  if (lmsLessons.length === 0) {
    container.innerHTML = '<p class="empty-lessons">No lessons available yet.</p>';
    return;
  }

  container.innerHTML = lmsLessons.map((lesson) => {
    const slot = lesson.slot;
    const title = lesson.title || `Lesson ${slot}`;
    const description = lesson.description || 'No description available.';
    const status = String(lesson.status || '').toLowerCase();
    const progressPercent = lesson.pageProgressPercent || 0;
    const isActive = currentLessonSlot === slot;
    const pages = lessonPagesMap[slot] || [];
    
    // Status badge
    let statusBadgeClass = 'not-started';
    let statusBadgeText = 'Not Started';
    if (status === 'completed') {
      statusBadgeClass = 'completed';
      statusBadgeText = 'Completed';
    } else if (status === 'in_progress') {
      statusBadgeClass = 'in-progress';
      statusBadgeText = 'In Progress';
    }

    // Build page list HTML (only if expanded)
    let pagesListHtml = '';
    if (isActive && pages.length > 0) {
      pagesListHtml = `
        <div class="lesson-pages-list">
          ${pages.map((page, index) => {
            const isPageActive = currentPageId === page.id && viewMode === 'page';
            const pageStatus = page.isCompleted ? 'completed' : (page.isUnlocked ? 'unlocked' : 'locked');
            
            let indicatorClass = 'page-indicator';
            let indicatorContent = '';
            if (page.isCompleted) {
              indicatorClass += ' completed';
              indicatorContent = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            } else if (isPageActive) {
              indicatorClass += ' active';
              indicatorContent = '<div class="indicator-dot"></div>';
            } else if (!page.isUnlocked) {
              indicatorClass += ' locked';
              indicatorContent = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" stroke-width="2"/></svg>';
            } else {
              indicatorClass += ' unlocked';
              indicatorContent = '<div class="indicator-dot-outline"></div>';
            }
            
            return `
              <div class="lesson-page-item ${isPageActive ? 'active' : ''} ${!page.isUnlocked ? 'locked' : ''}" 
                   onclick="${page.isUnlocked ? `event.stopPropagation(); loadPage('${page.id}')` : 'event.stopPropagation();'}" 
                   style="${!page.isUnlocked ? 'cursor: not-allowed; opacity: 0.5;' : 'cursor: pointer;'}">
                <div class="${indicatorClass}">
                  ${indicatorContent}
                </div>
                <span class="page-item-title">${page.title || `Page ${index + 1}`}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    return `
      <div class="lesson-list-card ${status === 'completed' ? 'is-complete' : ''} ${isActive ? 'active expanded' : ''}" 
           onclick="selectLesson(${slot}, true)">
        <div class="lesson-list-card-header">
          <h3>${title}</h3>
          <span class="lesson-status-badge ${statusBadgeClass}">${statusBadgeText}</span>
        </div>
        <p class="lesson-list-description">${description}</p>
        <div class="lesson-list-progress">
          <div class="lesson-list-progress-bar">
            <div class="lesson-list-progress-fill" style="width: ${progressPercent}%"></div>
          </div>
          <span>${progressPercent}%</span>
        </div>
        ${pagesListHtml}
      </div>
    `;
  }).join('');
}

function updateLessonsProgress() {
  if (!dashboardData) return;

  const lmsLessons = (dashboardData.lms && dashboardData.lms.lessons) || [];
  const completedCount = lmsLessons.filter(
    (l) => String(l.status || '').toLowerCase() === 'completed'
  ).length;
  const totalLessons = lmsLessons.length;

  const progressPercent = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

  const progressFill = document.getElementById('lessonsProgressFill');
  const progressText = document.getElementById('lessonsProgressText');

  if (progressFill) {
    progressFill.style.width = `${progressPercent}%`;
  }

  if (progressText) {
    progressText.textContent = `${completedCount} of ${totalLessons} completed`;
  }
}

// Update progress bar for current lesson (without resetting view)
function updateLessonProgressBar() {
  if (!currentLessonSlot || !dashboardData) return;
  
  const lmsLesson = (dashboardData.lms && dashboardData.lms.lessons || []).find(l => l.slot === currentLessonSlot);
  if (!lmsLesson) return;
  
  const completedPages = lmsLesson.completedPages || 0;
  const totalPages = lmsLesson.totalPages || 0;
  const progressPercent = totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0;
  
  // Update progress bar in page view if it exists
  const progressFill = document.querySelector('.lesson-progress-fill');
  const progressText = document.querySelector('.progress-text');
  const progressPercentEl = document.querySelector('.progress-percent');
  
  if (progressFill) {
    progressFill.style.width = `${progressPercent}%`;
  }
  
  if (progressText) {
    progressText.textContent = `${completedPages} of ${totalPages} pages completed`;
  }
  
  if (progressPercentEl) {
    progressPercentEl.textContent = `${progressPercent}%`;
  }
}

// ============================================
// Helper: Find Current Page Based on Progress
// ============================================

function findCurrentPage(pages, completedPageIds) {
  if (!pages || pages.length === 0) return null;
  
  // Find first page that is NOT completed
  const firstIncomplete = pages.find((p) => !completedPageIds.includes(p.id));
  
  if (firstIncomplete) {
    return firstIncomplete;
  }
  
  // All pages completed, return last page
  return pages[pages.length - 1];
}

// ============================================
// Select Lesson (Smart: Intro or Current Page)
// ============================================

async function selectLesson(slot, loadPages = true) {
  if (!dashboardData) {
    await loadLessons();
  }

  // If clicking the same lesson and we're already viewing a specific page, don't reset
  if (currentLessonSlot === slot && currentPageId && viewMode === 'page') {
    // Already on this lesson and viewing a page - just update the list to show it's active
    renderLessonsList();
    return;
  }

  currentLessonSlot = slot;

  // Find lesson in dashboard data
  const lmsLessons = (dashboardData.lms && dashboardData.lms.lessons) || [];
  const lmsLesson = lmsLessons.find((l) => l.slot === slot);

  if (!lmsLesson) {
    showAlertModal('Lesson not found.', 'Error');
    return;
  }

  // Load pages if needed
  if (loadPages) {
    await loadPagesForLesson(slot);
  }

  // Fetch lesson metadata (for intro video, tools, etc.)
  try {
    const metaResponse = await fetch(`/api/user/lessons?t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (metaResponse.ok) {
      const metaData = await metaResponse.json();
      if (metaData.success && metaData.lessons) {
        currentLessonMeta = metaData.lessons.find((l) => l.slot === slot);
      }
    }
  } catch (error) {
    console.error('Error fetching lesson metadata:', error);
  }

  // Update URL
  const url = new URL(window.location);
  url.searchParams.set('lesson', slot);
  window.history.pushState({}, '', url);

  // Update breadcrumb
  document.getElementById('breadcrumbLessonName').textContent = lmsLesson.title || `Lesson ${slot}`;

  // Hide empty state, show viewer
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('lessonViewer').style.display = 'block';

  // Determine if we should show intro or current page
  const completedPages = lmsLesson.completedPages || 0;
  const pages = lessonPagesMap[slot] || [];
  
  // Get completed page IDs
  const completedPageIds = pages.filter(p => p.isCompleted).map(p => p.id);
  
  // If no progress, show intro. Otherwise, go to current page
  if (completedPages === 0 && pages.length > 0) {
    // No progress - show intro
    currentPageId = null;
    viewMode = 'intro';
    renderLessonIntro(lmsLesson);
  } else if (pages.length > 0) {
    // Has progress - go to current page
    const currentPage = findCurrentPage(pages, completedPageIds);
    if (currentPage && currentPage.isUnlocked) {
      currentPageId = currentPage.id;
      viewMode = 'page';
      await loadPage(currentPage.id);
    } else {
      // Fallback to intro if no unlocked page found
      currentPageId = null;
      viewMode = 'intro';
      renderLessonIntro(lmsLesson);
    }
  } else {
    // No pages available - show intro
    currentPageId = null;
    viewMode = 'intro';
    renderLessonIntro(lmsLesson);
  }

  // Update active lesson in list
  renderLessonsList();
}

// ============================================
// Load Pages for Lesson
// ============================================

async function loadPagesForLesson(slot) {
  try {
    const response = await fetch(`/api/student/lessons/${slot}/pages?t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch pages');
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error('Invalid response');
    }

    lessonPagesMap[slot] = data.pages || [];
    currentPages = lessonPagesMap[slot];
  } catch (error) {
    console.error('Error loading pages:', error);
    lessonPagesMap[slot] = [];
    currentPages = [];
  }
}

// ============================================
// Render Lesson Intro View
// ============================================

function renderLessonIntro(lmsLesson) {
  viewMode = 'intro';
  const slot = lmsLesson.slot;
  const title = lmsLesson.title || `Lesson ${slot}`;
  const description = lmsLesson.description || 'No description available.';
  const completedPages = lmsLesson.completedPages || 0;
  const totalPages = lmsLesson.totalPages || 0;

  // Load intro video if available
  loadIntroVideo();

  // Determine button text based on progress
  const buttonText = completedPages > 0 ? 'Continue Lesson' : 'Start Lesson';

  // Render intro content into pageContentView (same container used for page content)
  const contentView = document.getElementById('pageContentView');
  const assessmentView = document.getElementById('pageAssessmentView');
  
  if (contentView) {
    // Hide assessment view, show content view
    if (assessmentView) {
      assessmentView.style.display = 'none';
    }
    contentView.style.display = 'block';
    
    // Format description - handle both string and array
    let descriptionHtml = '';
    if (typeof description === 'string') {
      descriptionHtml = description.split('\n').filter(p => p.trim()).map(p => `<p>${p}</p>`).join('');
    } else {
      descriptionHtml = `<p>${description}</p>`;
    }
    if (!descriptionHtml) {
      descriptionHtml = '<p>No description available.</p>';
    }

    contentView.innerHTML = `
      <div class="lesson-intro-view">
        ${currentLessonMeta && currentLessonMeta.introVideoUrl ? `
          <div class="intro-video-wrapper">
            <video controls class="intro-video">
              <source src="${currentLessonMeta.introVideoUrl}" type="video/mp4">
              Your browser does not support the video tag.
            </video>
          </div>
        ` : ''}
        <div class="lesson-intro-content">
          <h2>About This Lesson</h2>
          <div class="lesson-intro-text">
            ${descriptionHtml}
          </div>
          <div class="lesson-intro-progress-summary">
            <p>You've completed <strong>${completedPages} of ${totalPages}</strong> pages.</p>
          </div>
          <div class="lesson-intro-actions">
            <button class="btn-primary btn-start-lesson" onclick="startLesson()">
              ${buttonText}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

// ============================================
// Start/Continue Lesson (Load Current Page)
// ============================================

async function startLesson() {
  if (!currentLessonSlot) return;

  // Ensure pages are loaded
  if (!lessonPagesMap[currentLessonSlot] || lessonPagesMap[currentLessonSlot].length === 0) {
    await loadPagesForLesson(currentLessonSlot);
  }

  const pages = lessonPagesMap[currentLessonSlot] || [];
  if (pages.length === 0) {
    showAlertModal('No pages are available. Please contact your instructor.', 'No Content');
    return;
  }

  // Get lesson progress
  const lmsLessons = (dashboardData.lms && dashboardData.lms.lessons) || [];
  const lmsLesson = lmsLessons.find((l) => l.slot === currentLessonSlot);
  const completedPageIds = pages.filter(p => p.isCompleted).map(p => p.id);
  
  // Find current page (first incomplete, or last if all complete)
  const currentPage = findCurrentPage(pages, completedPageIds);
  
  if (currentPage && currentPage.isUnlocked) {
    await loadPage(currentPage.id);
  } else {
    // Fallback to first unlocked page
    const firstUnlocked = pages.find((p) => p.isUnlocked);
    if (firstUnlocked) {
      await loadPage(firstUnlocked.id);
    } else {
      showAlertModal('No pages are available. Please contact your instructor.', 'No Content');
    }
  }
}

// ============================================
// Load Page Content
// ============================================

async function loadPage(pageId) {
  if (!currentLessonSlot) return;

  // Flush time for previous page before switching
  await flushPageTimeSpent();

  // Ensure pages are loaded
  if (!lessonPagesMap[currentLessonSlot] || lessonPagesMap[currentLessonSlot].length === 0) {
    await loadPagesForLesson(currentLessonSlot);
  }

  currentPageId = pageId;
  viewMode = 'page';
  const pages = lessonPagesMap[currentLessonSlot] || [];
  const page = pages.find((p) => p.id === pageId);

  if (!page) {
    showAlertModal('Page not found.', 'Error');
    return;
  }

  if (!page.isUnlocked) {
    showAlertModal('This page is locked. Complete the previous page to unlock it.', 'Locked');
    return;
  }

  // Update page navigation in left panel
  renderLessonsList();

  // Load assessments for this page
  await loadAssessments(currentLessonSlot, pageId);

  // Render page content
  renderPageContent(page, pages);

  // Start tracking time for this page
  startPageViewTimer(currentLessonSlot, pageId);
}

function renderPageContent(page, allPages) {
  const currentIndex = allPages.findIndex((p) => p.id === page.id);
  const pageNumber = currentIndex + 1;
  const totalPages = allPages.length;
  const lmsLesson = (dashboardData.lms && dashboardData.lms.lessons || []).find(l => l.slot === currentLessonSlot);
  const completedPages = lmsLesson ? (lmsLesson.completedPages || 0) : 0;
  const totalPagesCount = lmsLesson ? (lmsLesson.totalPages || 0) : totalPages;
  const progressPercent = totalPagesCount > 0 ? Math.round((completedPages / totalPagesCount) * 100) : 0;
  
  // Ensure viewMode is set to 'page' when rendering page content
  viewMode = 'page';

  const contentView = document.getElementById('pageContentView');
  if (contentView) {
    // Always start in content mode
    const assessmentView = document.getElementById('pageAssessmentView');
    if (assessmentView) {
      assessmentView.style.display = 'none';
    }
    contentView.style.display = 'block';
    
    contentView.innerHTML = `
      <div class="lesson-page-view">
        <!-- Progress Bar -->
        <div class="lesson-progress-bar-container">
          <div class="lesson-progress-info">
            <span class="progress-text">${completedPages} of ${totalPagesCount} pages completed</span>
            <span class="progress-percent">${progressPercent}%</span>
          </div>
          <div class="lesson-progress-bar">
            <div class="lesson-progress-fill" style="width: ${progressPercent}%"></div>
          </div>
        </div>

        <!-- Page Content -->
        <div class="page-content-wrapper">
          <div class="page-header">
            <div class="page-number">Page ${pageNumber} of ${totalPages}</div>
            <h2 class="page-title">${page.title || 'Page Content'}</h2>
            ${page.isCompleted ? '<span class="page-completed-badge">Completed</span>' : ''}
          </div>
          <div class="page-content-body lesson-content-prose">
            ${page.content || '<p>No content available for this page.</p>'}
          </div>
        </div>

        <!-- Page Assessment CTA panel (content mode) -->
        <div id="pageAssessmentPanel" class="page-assessment-panel"></div>

        <!-- Navigation Controls -->
        <div class="page-navigation-controls">
          ${renderPageNavigationControls(page, allPages, currentIndex)}
        </div>
      </div>
    `;

    // Render the content-mode Page Assessment panel
    renderPageAssessmentPanel();
  }
}

// ============================================
// Time Tracking Helpers
// ============================================

function startPageViewTimer(lessonSlot, pageId) {
  // Reset timer
  pageViewStartTime = Date.now();
}

async function flushPageTimeSpent() {
  if (!currentLessonSlot || !currentPageId || !pageViewStartTime) return;

  const elapsedMs = Date.now() - pageViewStartTime;
  pageViewStartTime = null;

  const deltaSeconds = Math.round(elapsedMs / 1000);
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 5) {
    return; // Ignore very short views
  }

  try {
    await fetch(`/api/student/lessons/${currentLessonSlot}/pages/${currentPageId}/time-spent`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ deltaSeconds })
    });
  } catch (error) {
    console.error('Failed to update LMS time spent:', error);
  }
}

// Switch into assessment mode for the current page
function enterAssessmentMode() {
  const contentView = document.getElementById('pageContentView');
  const assessmentView = document.getElementById('pageAssessmentView');

  if (!contentView || !assessmentView) return;

  contentView.style.display = 'none';
  assessmentView.style.display = 'block';

  // Render assessment questions fresh each time
  renderAssessments();

  assessmentView.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Return from assessment mode back to content mode
function exitAssessmentMode() {
  const contentView = document.getElementById('pageContentView');
  const assessmentView = document.getElementById('pageAssessmentView');
  const panel = document.getElementById('pageAssessmentPanel');

  if (!contentView || !assessmentView) return;

  assessmentView.style.display = 'none';
  contentView.style.display = 'block';

  if (panel) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Content-mode Page Assessment panel (Take/View Assessment)
function renderPageAssessmentPanel() {
  const panel = document.getElementById('pageAssessmentPanel');
  if (!panel) return;

  const hasAssessments = currentAssessments && currentAssessments.length > 0;
  if (!hasAssessments) {
    panel.innerHTML = '';
    return;
  }

  const key = `${currentLessonSlot}_${currentPageId}`;
  const hasAttempt = !!lastAssessmentResultByPage[key];

  // Check if we need to fetch latest attempt from backend
  if (!hasAttempt) {
    // Try to fetch latest attempt
    fetch(`/api/student/lessons/${currentLessonSlot}/pages/${currentPageId}/assessment/history`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.attempts && data.attempts.length > 0) {
          // Cache the latest attempt (first in array since sorted descending)
          lastAssessmentResultByPage[key] = data.attempts[0];
          renderPageAssessmentPanel(); // Re-render with updated state
        }
      })
      .catch(err => console.error('Failed to check assessment history', err));
  }

  panel.innerHTML = `
    <div class="page-assessment-panel-content">
      <div class="page-assessment-header">
        <h3>Page Assessment</h3>
        <p>Test your understanding of this section.</p>
      </div>
      <div class="page-assessment-actions">
        <button type="button" class="btn-primary" id="takeAssessmentBtn">Take Assessment</button>
        ${hasAttempt ? '<button type="button" class="btn-secondary" id="viewAssessmentFromContentBtn">View Assessment</button>' : ''}
      </div>
    </div>
  `;

  const takeBtn = document.getElementById('takeAssessmentBtn');
  const viewBtn = document.getElementById('viewAssessmentFromContentBtn');

  if (takeBtn) {
    takeBtn.onclick = () => enterAssessmentMode();
  }
  if (viewBtn) {
    viewBtn.onclick = () => openAssessmentResultModal();
  }
}

function renderPageNavigationControls(page, allPages, currentIndex) {
  const isCompleted = page.isCompleted;
  const hasAssessments = currentAssessments.length > 0;
  const isLastPage = currentIndex === allPages.length - 1;
  const nextPage = currentIndex < allPages.length - 1 ? allPages[currentIndex + 1] : null;

  let html = '';

  // For pages with assessments, navigation is handled in assessment mode
  if (!isCompleted && hasAssessments) {
    // No nav buttons here; use the assessment panel's "Take Assessment" button
  } else if (!isCompleted && !hasAssessments) {
    // No assessment, mark as complete automatically or show next
    html += `
      <button class="btn-primary btn-continue" onclick="markPageCompleteAndContinue()">
        Mark Complete & Continue
      </button>
    `;
  } else if (isCompleted && hasAssessments) {
    // Page completed, show next button if available
    if (nextPage && nextPage.isUnlocked) {
      html += `
        <div class="assessment-passed-message">
          <p>✓ Assessment passed! You can continue to the next page.</p>
        </div>
        <button class="btn-primary btn-next-page" onclick="loadPage('${nextPage.id}')">
          Continue to Next Page
        </button>
      `;
    } else if (isLastPage) {
      html += `
        <div class="lesson-completed-message">
          <h3>🎉 Lesson Completed!</h3>
          <p>Congratulations! You've completed all pages in this lesson.</p>
        </div>
      `;
    } else {
      html += `
        <div class="assessment-passed-message">
          <p>✓ Assessment passed! The next page will unlock after you complete the current lesson requirements.</p>
        </div>
      `;
    }
  } else if (isCompleted && !hasAssessments) {
    // Completed without assessment
    if (nextPage && nextPage.isUnlocked) {
      html += `
        <button class="btn-primary btn-next-page" onclick="loadPage('${nextPage.id}')">
          Continue to Next Page
        </button>
      `;
    } else if (isLastPage) {
      html += `
        <div class="lesson-completed-message">
          <h3>🎉 Lesson Completed!</h3>
          <p>Congratulations! You've completed all pages in this lesson.</p>
        </div>
      `;
    }
  }

  return html;
}

// ============================================
// Assessment Functions
// ============================================

async function loadAssessments(slot, pageId) {
  try {
    const response = await fetch(`/api/student/lessons/${slot}/pages/${pageId}/assessments?t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch assessments');
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error('Invalid response');
    }

    currentAssessments = data.assessments || [];
  } catch (error) {
    console.error('Error loading assessments:', error);
    currentAssessments = [];
  }
}

function showAssessmentSection() {
  // This function now just switches to assessment mode
  enterAssessmentMode();
}

function renderAssessments() {
  const container = document.getElementById('assessmentsContainer');
  if (!container) return;

  if (currentAssessments.length === 0) {
    container.innerHTML = '<p class="empty-assessments">No assessments for this page.</p>';
    return;
  }

  container.innerHTML = `
    <div class="assessments-section">
      <h3 class="assessments-title">Assessment</h3>
      <p class="assessments-subtitle">Answer all questions correctly to complete this page.</p>
      <form id="assessmentForm" onsubmit="submitAssessment(event)">
        ${currentAssessments.map((assessment, index) => `
          <div class="assessment-question" data-assessment-id="${assessment.id}">
            <h4 class="question-title">Question ${index + 1}: ${assessment.question}</h4>
            <div class="question-options">
              <label class="option-label">
                <input type="radio" name="assessment_${assessment.id}" value="A" required>
                <span>A) ${assessment.answerA}</span>
              </label>
              <label class="option-label">
                <input type="radio" name="assessment_${assessment.id}" value="B" required>
                <span>B) ${assessment.answerB}</span>
              </label>
              <label class="option-label">
                <input type="radio" name="assessment_${assessment.id}" value="C" required>
                <span>C) ${assessment.answerC}</span>
              </label>
              <label class="option-label">
                <input type="radio" name="assessment_${assessment.id}" value="D" required>
                <span>D) ${assessment.answerD}</span>
              </label>
            </div>
            <div class="question-feedback" id="feedback_${assessment.id}" style="display: none;"></div>
          </div>
        `).join('')}
        <div class="assessment-actions">
          <button type="submit" class="btn-primary" id="submitAssessmentBtn">Submit Assessment</button>
        </div>
      </form>
    </div>
  `;
}

async function submitAssessment(event) {
  event.preventDefault();

  if (!currentLessonSlot || !currentPageId) {
    showAlertModal('Invalid page or lesson.', 'Error');
    return;
  }

  const form = document.getElementById('assessmentForm');
  if (!form) return;

  const formData = new FormData(form);
  const answers = {};

  // Collect answers
  currentAssessments.forEach((assessment) => {
    const answer = formData.get(`assessment_${assessment.id}`);
    if (answer) {
      answers[assessment.id] = answer;
    }
  });

  // Validate all answers provided
  if (Object.keys(answers).length !== currentAssessments.length) {
    showAlertModal('Please answer all questions.', 'Incomplete');
    return;
  }

  // Disable submit button
  const submitBtn = document.getElementById('submitAssessmentBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
  }

  try {
    const response = await fetch(`/api/student/lessons/${currentLessonSlot}/pages/${currentPageId}/assessments/submit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ answers })
    });

    if (!response.ok) {
      throw new Error('Failed to submit assessment');
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error('Invalid response');
    }

    // Cache latest attempt details for this page (for modal view)
    const key = `${currentLessonSlot}_${currentPageId}`;
    if (data.latestAttempt) {
      lastAssessmentResultByPage[key] = data.latestAttempt;
    } else if (data.attemptDetails) {
      // Fallback to attemptDetails for backward compatibility
      lastAssessmentResultByPage[key] = data.attemptDetails;
    }

    const passed = !!data.passed;
    const scorePercent = data.scorePercent ?? data.score ?? 0;
    const correctCount = data.correctCount || 0;
    const questionCount = data.questionCount ?? data.totalQuestions ?? 0;

    // Show inline per-question feedback
    showAssessmentResults({
      score: scorePercent,
      correctCount,
      totalQuestions: questionCount,
      passed,
      results: data.results || {}
    });

    // Render page-level assessment result block with actions (in assessment mode)
    renderPageAssessmentResult({
      passed,
      scorePercent,
      correctCount,
      questionCount,
      attemptDetails: data.latestAttempt || data.attemptDetails || null
    });

    // Reload progress data but DO NOT re-render page content (keep assessment view + summary visible)
    await loadLessons();
    await loadPagesForLesson(currentLessonSlot);
    updateLessonProgressBar();
    renderLessonsList();

    // Also refresh the content-mode assessment panel so "View Assessment" is available when student returns
    renderPageAssessmentPanel();
  } catch (error) {
    console.error('Error submitting assessment:', error);
    showAlertModal('Failed to submit assessment. Please try again.', 'Error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Assessment';
    }
  }
}

function showAssessmentResults(data) {
  const { score, correctCount, totalQuestions, passed, results } = data;

  // Show feedback for each question
  currentAssessments.forEach((assessment) => {
    const feedbackEl = document.getElementById(`feedback_${assessment.id}`);
    if (!feedbackEl) return;

    const result = results[assessment.id];
    if (!result) return;

    feedbackEl.style.display = 'block';
    feedbackEl.className = `question-feedback ${result.isCorrect ? 'correct' : 'incorrect'}`;
    feedbackEl.innerHTML = `
      <p class="feedback-text">
        ${result.isCorrect ? '✓ Correct' : '✗ Incorrect'} - 
        Your answer: ${result.studentAnswer}. 
        ${result.explanation ? `Explanation: ${result.explanation}` : ''}
      </p>
    `;
  });

}

// Render page-level assessment result (banner + actions) in assessment mode
function renderPageAssessmentResult({ passed, scorePercent, correctCount, questionCount, attemptDetails }) {
  const container = document.getElementById('pageAssessmentResultContainer');
  if (!container) return;

  const statusText = passed ? 'Assessment passed!' : 'Assessment not passed';
  const statusClass = passed ? 'alert-success' : 'alert-error';
  const attemptNumber = attemptDetails && attemptDetails.attemptNumber != null
    ? attemptDetails.attemptNumber
    : null;

  let attemptInfo = '';
  if (attemptNumber != null) {
    attemptInfo = `Attempt ${attemptNumber} • `;
  }

  container.innerHTML = `
    <div class="alert ${statusClass}">
      <strong>${statusText}</strong>
      <span class="assessment-score">
        ${attemptInfo}Score: ${correctCount}/${questionCount} (${scorePercent}%)
      </span>
    </div>
    <div class="assessment-result-actions">
      <button type="button" class="btn-secondary" id="backToLessonBtn">Back to Lesson</button>
      <button type="button" class="btn-outline" id="retakeAssessmentBtn">Retake Assessment</button>
      ${passed ? '<button type="button" class="btn-primary" id="continueNextPageBtn">Continue to Next Page</button>' : ''}
    </div>
  `;

  const backBtn = document.getElementById('backToLessonBtn');
  const retakeBtn = document.getElementById('retakeAssessmentBtn');
  const continueBtn = document.getElementById('continueNextPageBtn');

  if (backBtn) {
    backBtn.onclick = () => exitAssessmentMode();
  }
  if (retakeBtn) {
    retakeBtn.onclick = () => retakeCurrentPageAssessment();
  }
  if (continueBtn && passed) {
    continueBtn.onclick = () => goToNextPage();
  }
}

async function openAssessmentResultModal() {
  if (!currentLessonSlot || !currentPageId) return;

  const modal = document.getElementById('assessmentResultModal');
  if (!modal) return;

  // Fetch all attempts from backend
  try {
    const response = await fetch(
      `/api/student/lessons/${currentLessonSlot}/pages/${currentPageId}/assessment/history?t=${Date.now()}`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to load assessment history');
    }

    const data = await response.json();
    if (!data.success || !data.attempts || data.attempts.length === 0) {
      showAlertModal('You haven\'t taken this assessment yet.', 'Info');
      return;
    }

    renderAssessmentHistoryModal(data.attempts);
  } catch (err) {
    console.error('Error loading assessment history:', err);
    showAlertModal('Unable to load assessment result. Please try again.', 'Error');
  }
}

function renderAssessmentHistoryModal(attempts) {
  const modal = document.getElementById('assessmentResultModal');
  const body = document.getElementById('assessmentResultBody');
  if (!modal || !body) return;

  body.innerHTML = `
    <div class="assessment-history-list">
      ${attempts.map((attempt, index) => {
        const submittedAt = attempt.submittedAt || attempt.submitted_at;
        const dateText = submittedAt ? new Date(submittedAt).toLocaleString() : 'Unknown time';
        const scorePercent = attempt.scorePercent ?? 0;
        const questionCount = attempt.totalQuestions || (attempt.questions ? attempt.questions.length : 0);
        const passed = !!attempt.passed;
        const attemptNumber = attempt.attemptNumber || (index + 1);
        const questions = Array.isArray(attempt.questions) ? attempt.questions : [];
        const expandedId = `attempt-${attempt.attemptId || index}`;

        return `
          <div class="assessment-history-item" data-attempt-id="${expandedId}">
            <div class="assessment-history-header" onclick="toggleAttemptDetails('${expandedId}')">
              <div class="assessment-history-info">
                <span class="assessment-history-attempt">Attempt #${attemptNumber}</span>
                <span class="assessment-history-score">Score: ${scorePercent}% (${questionCount} questions)</span>
                <span class="assessment-history-date">${dateText}</span>
              </div>
              <div class="assessment-history-status">
                <span class="assessment-status-pill ${
                  passed ? 'assessment-status-pass' : 'assessment-status-fail'
                }">${passed ? 'Passed' : 'Not Passed'}</span>
                <span class="assessment-history-toggle">▼</span>
              </div>
            </div>
            <div class="assessment-history-details" id="${expandedId}" style="display: none;">
              ${questions.length > 0 ? `
                <div class="assessment-questions-list">
                  ${questions.map((q, idx) => {
                    const selected = q.selectedOption || '';
                    const correct = q.correctOption || '';
                    const options = q.options || {};

                    const renderOption = (letter) => {
                      const text = options[letter] || '';
                      const isSelected = selected === letter;
                      const isCorrect = correct === letter;
                      const classes = [
                        'assessment-option',
                        isSelected ? 'selected' : '',
                        isCorrect ? 'correct' : '',
                        isSelected && !isCorrect ? 'wrong-selected' : ''
                      ]
                        .filter(Boolean)
                        .join(' ');
                      const badges = [];
                      if (isCorrect) {
                        badges.push('<span class="assessment-badge assessment-badge-correct">Correct</span>');
                      }
                      if (isSelected) {
                        badges.push(
                          '<span class="assessment-badge assessment-badge-selected">Your answer</span>'
                        );
                      }
                      return `
                        <div class="${classes}">
                          <div class="assessment-option-label">
                            <span class="assessment-option-tag">${letter})</span>
                            <span>${text}</span>
                          </div>
                          <div>${badges.join(' ')}</div>
                        </div>
                      `;
                    };

                    return `
                      <div class="assessment-question-item">
                        <h4 class="assessment-question-title">Question ${idx + 1}: ${q.question || ''}</h4>
                        <div class="assessment-options">
                          ${['A', 'B', 'C', 'D'].map((opt) => renderOption(opt)).join('')}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : '<p>No question details available.</p>'}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  modal.style.display = 'flex';

  // Wire modal "Retake Assessment" button, if present
  const retakeBtn = document.getElementById('assessmentRetakeButton');
  if (retakeBtn) {
    retakeBtn.onclick = () => {
      closeAssessmentResultModal();
      enterAssessmentMode();
    };
  }
}

function toggleAttemptDetails(attemptId) {
  const details = document.getElementById(attemptId);
  const header = details?.previousElementSibling;
  const toggle = header?.querySelector('.assessment-history-toggle');
  
  if (details && header && toggle) {
    const isExpanded = details.style.display !== 'none';
    details.style.display = isExpanded ? 'none' : 'block';
    toggle.textContent = isExpanded ? '▼' : '▲';
  }
}

// Make it globally accessible
window.toggleAttemptDetails = toggleAttemptDetails;

function closeAssessmentResultModal() {
  const modal = document.getElementById('assessmentResultModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Close modal when clicking outside
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('assessmentResultModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeAssessmentResultModal();
      }
    });
  }
});

function retakeCurrentPageAssessment() {
  // Clear selected answers on the form for this page
  const form = document.getElementById('assessmentForm');
  if (form) {
    const inputs = form.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    inputs.forEach((input) => {
      input.checked = false;
    });
  }

  // Clear per-question feedback
  currentAssessments.forEach((assessment) => {
    const feedbackEl = document.getElementById(`feedback_${assessment.id}`);
    if (feedbackEl) {
      feedbackEl.style.display = 'none';
      feedbackEl.textContent = '';
    }
  });

  // Clear result container
  const resultContainer = document.getElementById('pageAssessmentResultContainer');
  if (resultContainer) {
    resultContainer.innerHTML = '';
  }

  // Scroll to top of assessment form
  const assessmentSection = document.getElementById('assessmentsContainer');
  if (assessmentSection) {
    assessmentSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function goToNextPage() {
  if (!currentLessonSlot || !currentPageId) return;

  const pages = lessonPagesMap[currentLessonSlot] || [];
  const currentIndex = pages.findIndex((p) => p.id === currentPageId);
  if (currentIndex === -1) return;

  const nextPage = currentIndex < pages.length - 1 ? pages[currentIndex + 1] : null;
  if (nextPage && nextPage.isUnlocked) {
    loadPage(nextPage.id);
  }
}

async function markPageCompleteAndContinue() {
  // For pages without assessments, we can mark as complete
  // This would require a new endpoint or we can just reload
  await loadLessons();
  await loadPagesForLesson(currentLessonSlot);
  
  const pages = lessonPagesMap[currentLessonSlot] || [];
  const currentIndex = pages.findIndex((p) => p.id === currentPageId);
  const nextPage = currentIndex < pages.length - 1 ? pages[currentIndex + 1] : null;
  
  if (nextPage && nextPage.isUnlocked) {
    await loadPage(nextPage.id);
  } else {
    // Reload current page to refresh UI
    await loadPage(currentPageId);
  }
}

// ============================================
// Intro Video
// ============================================

function loadIntroVideo() {
  // Video is now rendered in intro view
  // This function kept for compatibility
}

// ============================================
// Tools Tab
// ============================================

function loadToolsTab() {
  const toolsGrid = document.getElementById('toolsGrid');
  if (!toolsGrid) return;

  const tools = (currentLessonMeta && currentLessonMeta.tools) || {};
  const toolKeys = Object.keys(tools);

  if (toolKeys.length === 0) {
    toolsGrid.innerHTML = '<p class="empty-tools">No tools assigned to this lesson.</p>';
    return;
  }

  toolsGrid.innerHTML = toolKeys.map((toolId) => {
    const tool = tools[toolId];
    const toolName = tool.name || 'Unnamed Tool';
    const toolDesc = tool.description || 'No description';
    const toolImage = tool.imageUrl || tool.imageURL;
    const toolModelUrl = tool.modelUrl || (tool.model ? tool.model.url : '');
    const toolModelType = tool.modelType || (tool.model ? tool.model.format : '');
    const firstLetter = toolName.charAt(0).toUpperCase();
    const isGLB = (toolModelType || '').toLowerCase().includes('gl') || 
                  (toolModelUrl || '').toLowerCase().endsWith('.glb') || 
                  (toolModelUrl || '').toLowerCase().endsWith('.gltf');

    return `
      <div class="tool-card" onclick="openToolModal('${toolId}')">
        <div class="tool-card-header">
          ${toolImage ? 
            `<img src="${toolImage}" alt="${toolName}" class="tool-image">` :
            `<div class="tool-image-placeholder">${firstLetter}</div>`
          }
          <h3 class="tool-name">${toolName}</h3>
        </div>
        <p class="tool-description">${toolDesc}</p>
        ${toolModelUrl && isGLB ? `
          <div class="tool-3d-preview">
            <model-viewer src="${toolModelUrl}" camera-controls auto-rotate shadow-intensity="1"></model-viewer>
          </div>
        ` : ''}
        <button class="btn-view-tool" onclick="event.stopPropagation(); openToolModal('${toolId}')">View Details</button>
      </div>
    `;
  }).join('');
}

function openToolModal(toolId) {
  if (!currentLessonMeta || !currentLessonMeta.tools || !currentLessonMeta.tools[toolId]) {
    showAlertModal('Tool information not available.', 'Error');
    return;
  }

  const tool = currentLessonMeta.tools[toolId];
  const modal = document.getElementById('toolModal');

  document.getElementById('toolModalTitle').textContent = tool.name || 'Unnamed Tool';
  document.getElementById('toolModalDescription').textContent = tool.description || 'No description available.';
  document.getElementById('toolModalPurpose').textContent = tool.instructions || tool.purpose || 'No purpose specified.';
  document.getElementById('toolModalLessonName').textContent = currentLessonMeta.lessonTitle || `Lesson ${currentLessonSlot}`;

  const toolImage = document.getElementById('toolModalImage');
  if (tool.imageUrl || tool.imageURL) {
    toolImage.src = tool.imageUrl || tool.imageURL;
    toolImage.style.display = 'block';
  } else {
    toolImage.style.display = 'none';
  }

  const toolModelUrl = tool.modelUrl || (tool.model ? tool.model.url : '');
  const toolModelType = tool.modelType || (tool.model ? tool.model.format : '');
  const isGLB = (toolModelType || '').toLowerCase().includes('gl') || 
                (toolModelUrl || '').toLowerCase().endsWith('.glb') || 
                (toolModelUrl || '').toLowerCase().endsWith('.gltf');

  const modelTab = document.querySelector('.tool-modal-tab[data-tab="3d"]');
  const viewerContainer = document.getElementById('tool3DViewerContainer');

  if (toolModelUrl) {
    if (modelTab) modelTab.style.display = 'block';
    if (isGLB) {
      viewerContainer.innerHTML = `
        <model-viewer src="${toolModelUrl}" camera-controls auto-rotate shadow-intensity="1" style="width: 100%; height: 100%;"></model-viewer>
      `;
    } else {
      viewerContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #64748B;">
          <p>Web preview not available for this format.</p>
          <a href="${toolModelUrl}" target="_blank" class="btn-primary">Download 3D Model</a>
        </div>
      `;
    }
  } else {
    if (modelTab) modelTab.style.display = 'none';
    viewerContainer.innerHTML = '';
  }

  const stepsList = document.getElementById('toolModalSteps');
  if (tool.steps && Array.isArray(tool.steps) && tool.steps.length > 0) {
    stepsList.innerHTML = tool.steps.map(step => `<li>${step}</li>`).join('');
  } else if (tool.steps && typeof tool.steps === 'string') {
    stepsList.innerHTML = `<li>${tool.steps}</li>`;
  } else {
    stepsList.innerHTML = '<li>No steps provided.</li>';
  }

  switchToolModalTab('image');
  modal.style.display = 'flex';
}

function closeToolModal() {
  document.getElementById('toolModal').style.display = 'none';
}

function switchToolModalTab(tab) {
  document.querySelectorAll('.tool-modal-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });
  document.getElementById('toolImageTab').classList.toggle('active', tab === 'image');
  document.getElementById('tool3DTab').classList.toggle('active', tab === '3d');
}

// ============================================
// Tab Switching
// ============================================

// ============================================
// View Mode Switching (Lessons/Videos/Tools)
// ============================================

function switchViewMode(mode) {
  currentViewMode = mode;
  
  // Update button states
  document.querySelectorAll('.view-mode-btn').forEach(btn => {
    if (btn.getAttribute('data-mode') === mode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Show/hide progress indicator (only for lessons)
  const progressIndicator = document.getElementById('lessonsProgressIndicator');
  if (progressIndicator) {
    progressIndicator.style.display = mode === 'lessons' ? 'block' : 'none';
  }
  
  // Update breadcrumb
  const breadcrumbLessonName = document.getElementById('breadcrumbLessonName');
  if (breadcrumbLessonName) {
    if (mode === 'lessons') {
      const lmsLessons = (dashboardData && dashboardData.lms && dashboardData.lms.lessons) || [];
      const lmsLesson = currentLessonSlot ? lmsLessons.find((l) => l.slot === currentLessonSlot) : null;
      breadcrumbLessonName.textContent = lmsLesson ? (lmsLesson.title || `Lesson ${currentLessonSlot}`) : 'Lessons';
    } else if (mode === 'videos') {
      breadcrumbLessonName.textContent = 'Videos';
    } else if (mode === 'tools') {
      breadcrumbLessonName.textContent = 'Tools';
    }
  }
  
  // Update left sidebar content based on mode
  const lessonsList = document.getElementById('lessonsList');
  
  if (mode === 'lessons') {
    // Show lesson list in left sidebar
    if (lessonsList) {
      renderLessonsList();
    }
  } else if (mode === 'videos') {
    // Show video library in left sidebar
    if (lessonsList) {
      renderVideosListSidebar();
    }
    loadVideosView();
  } else if (mode === 'tools') {
    // Show tools list in left sidebar
    if (lessonsList) {
      renderToolsListSidebar();
    }
    loadToolsView();
  }
  
  // Switch right panel content
  const lessonsView = document.getElementById('lessonsContentView');
  const videosView = document.getElementById('videosView');
  const toolsView = document.getElementById('toolsView');
  const lessonViewer = document.getElementById('lessonViewer');
  const emptyState = document.getElementById('emptyState');
  
  if (mode === 'lessons') {
    if (lessonsView) lessonsView.style.display = 'block';
    if (videosView) videosView.style.display = 'none';
    if (toolsView) toolsView.style.display = 'none';
    if (lessonViewer) lessonViewer.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';
  } else if (mode === 'videos') {
    if (lessonsView) lessonsView.style.display = 'none';
    if (videosView) videosView.style.display = 'block';
    if (toolsView) toolsView.style.display = 'none';
    if (lessonViewer) lessonViewer.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';
  } else if (mode === 'tools') {
    if (lessonsView) lessonsView.style.display = 'none';
    if (videosView) videosView.style.display = 'none';
    if (toolsView) toolsView.style.display = 'block';
    if (lessonViewer) lessonViewer.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';
  }
}

// ============================================
// Videos View
// ============================================

async function loadVideosView() {
  // Load videos if not already loaded
  if (allVideos.length === 0) {
    try {
      const response = await fetch('/api/student/videos', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          allVideos = data.videos || [];
        }
      }
    } catch (error) {
      console.error('Error loading videos:', error);
    }
  }
  
  // Render both sidebar and main view
  renderVideosListSidebar();
  renderVideosView();
}

function renderVideosListSidebar() {
  const lessonsList = document.getElementById('lessonsList');
  if (!lessonsList) return;
  
  if (allVideos.length === 0) {
    lessonsList.innerHTML = '<p class="empty-lessons">No videos available.</p>';
    return;
  }
  
  lessonsList.innerHTML = allVideos.map(video => `
    <div class="lesson-list-card ${selectedVideoId === video.id ? 'active' : ''}" 
         onclick="selectVideo('${video.id}')">
      <div class="lesson-list-card-header">
        <h3><i class="fas fa-video" style="margin-right: 8px; color: #C19A6B;"></i>${video.title || 'Untitled Video'}</h3>
      </div>
    </div>
  `).join('');
}

function renderVideosView() {
  const videosView = document.getElementById('videosView');
  if (!videosView) return;
  
  if (allVideos.length === 0) {
    videosView.innerHTML = `
      <div class="empty-state-content">
        <div class="empty-state-icon">
          <i class="fas fa-video" style="font-size: 64px; color: #9ca3af;"></i>
        </div>
        <h3>No Videos Available</h3>
        <p>There are no videos in the library yet.</p>
      </div>
    `;
    return;
  }
  
  const selectedVideo = selectedVideoId ? allVideos.find(v => v.id === selectedVideoId) : (allVideos.length > 0 ? allVideos[0] : null);
  
  // Auto-select first video if none selected
  if (!selectedVideoId && selectedVideo) {
    selectedVideoId = selectedVideo.id;
    renderVideosListSidebar(); // Update sidebar to show selected state
  }
  
  videosView.innerHTML = `
    <div class="video-player-panel">
      ${selectedVideo ? `
        <div class="video-player-container">
          <h2>${selectedVideo.title || 'Untitled Video'}</h2>
          <div class="video-wrapper">
            <video controls class="video-player" src="${selectedVideo.downloadUrl}">
              Your browser does not support the video tag.
            </video>
          </div>
          ${selectedVideo.description ? `
            <div class="video-description">
              <h3>Description</h3>
              <p>${selectedVideo.description}</p>
            </div>
          ` : ''}
          <div class="video-actions">
            <a href="${selectedVideo.downloadUrl}" download class="btn-primary">
              <i class="fas fa-download"></i> Download Video
            </a>
          </div>
        </div>
      ` : `
        <div class="empty-state-content">
          <div class="empty-state-icon">
            <i class="fas fa-video" style="font-size: 64px; color: #9ca3af;"></i>
          </div>
          <h3>Select a Video</h3>
          <p>Choose a video from the list to start watching.</p>
        </div>
      `}
    </div>
  `;
}

function selectVideo(videoId) {
  selectedVideoId = videoId;
  renderVideosListSidebar(); // Update sidebar selection
  renderVideosView(); // Update main view
}

// ============================================
// Tools View
// ============================================

async function loadToolsView() {
  // Load tools if not already loaded
  if (allTools.length === 0) {
    try {
      const response = await fetch('/api/student/tools', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          allTools = data.tools || [];
        }
      }
    } catch (error) {
      console.error('Error loading tools:', error);
    }
  }
  
  // Render both sidebar and main view
  renderToolsListSidebar();
  renderToolsView();
}

function renderToolsListSidebar() {
  const lessonsList = document.getElementById('lessonsList');
  if (!lessonsList) return;
  
  if (allTools.length === 0) {
    lessonsList.innerHTML = '<p class="empty-lessons">No tools available.</p>';
    return;
  }
  
  lessonsList.innerHTML = allTools.map(tool => `
    <div class="lesson-list-card ${selectedToolId === tool.id ? 'active' : ''}" 
         onclick="selectTool('${tool.id}')">
      <div class="lesson-list-card-header">
        <h3>
          ${tool.imageUrl ? `
            <img src="${tool.imageUrl}" alt="${tool.name}" style="width: 32px; height: 32px; object-fit: cover; border-radius: 6px; margin-right: 8px; vertical-align: middle;">
          ` : `
            <div style="width: 32px; height: 32px; border-radius: 6px; background: #C19A6B; color: white; display: inline-flex; align-items: center; justify-content: center; margin-right: 8px; vertical-align: middle; font-weight: 600;">
              ${(tool.name || 'T').charAt(0).toUpperCase()}
            </div>
          `}
          ${tool.name || 'Unnamed Tool'}
        </h3>
      </div>
      <p class="lesson-list-description">${tool.description || 'No description available.'}</p>
      <div style="font-size: 12px; color: #64748B; margin-top: 4px;">
        <i class="fas fa-book" style="margin-right: 4px;"></i>From ${tool.lessonTitle || `Lesson ${tool.lessonSlot}`}
      </div>
    </div>
  `).join('');
}

function renderToolsView() {
  const toolsView = document.getElementById('toolsView');
  if (!toolsView) return;
  
  if (allTools.length === 0) {
    toolsView.innerHTML = `
      <div class="empty-state-content">
        <div class="empty-state-icon">
          <i class="fas fa-tools" style="font-size: 64px; color: #9ca3af;"></i>
        </div>
        <h3>No Tools Available</h3>
        <p>There are no tools in the library yet.</p>
      </div>
    `;
    return;
  }
  
  const selectedTool = selectedToolId ? allTools.find(t => t.id === selectedToolId) : (allTools.length > 0 ? allTools[0] : null);
  
  // Auto-select first tool if none selected
  if (!selectedToolId && selectedTool) {
    selectedToolId = selectedTool.id;
    renderToolsListSidebar(); // Update sidebar to show selected state
  }
  
  toolsView.innerHTML = `
    <div class="tool-detail-panel">
      ${selectedTool ? renderToolDetail(selectedTool) : `
        <div class="empty-state-content">
          <div class="empty-state-icon">
            <i class="fas fa-tools" style="font-size: 64px; color: #9ca3af;"></i>
          </div>
          <h3>Select a Tool</h3>
          <p>Choose a tool from the list to view details.</p>
        </div>
      `}
    </div>
  `;
}

function renderToolDetail(tool) {
  const hasStoragePath = !!tool.storagePath;
  const encodedPath = hasStoragePath ? encodeURIComponent(tool.storagePath) : null;

  return `
    <div class="tool-detail-container">
      <h2>${tool.name || 'Unnamed Tool'}</h2>
      <p class="tool-detail-lesson">From ${tool.lessonTitle || `Lesson ${tool.lessonSlot}`}</p>
      
      ${tool.imageUrl ? `
        <div class="tool-detail-image">
          <img src="${tool.imageUrl}" alt="${tool.name}">
        </div>
      ` : ''}
      
      ${tool.description ? `
        <div class="tool-detail-section">
          <h3>Description</h3>
          <p>${tool.description}</p>
        </div>
      ` : ''}
      
      ${tool.instructions ? `
        <div class="tool-detail-section">
          <h3>Instructions</h3>
          <p>${tool.instructions}</p>
        </div>
      ` : ''}
      
      ${hasStoragePath ? `
        <div class="tool-detail-section">
          <h3>3D Model</h3>
          <div class="tool-3d-viewer">
            <model-viewer
              src="/api/student/tools/model?path=${encodedPath}"
              camera-controls
              auto-rotate
              shadow-intensity="0.5"
              exposure="1"
              loading="eager"
              style="width: 100%; height: 400px; background: #f3f4f6; border-radius: 12px;"
              alt="3D model of the tool">
            </model-viewer>
            <p style="margin-top: 8px; font-size: 12px; color: #6B7280;">
              Left click to rotate • Scroll to zoom • Right click to pan
            </p>
          </div>
        </div>
      ` : `
        <div class="tool-detail-section">
          <h3>3D Model</h3>
          <p>No 3D model is available for this tool yet.</p>
        </div>
      `}
    </div>
  `;
}

function selectTool(toolId) {
  selectedToolId = toolId;
  renderToolsListSidebar(); // Update sidebar selection
  renderToolsView(); // Update main view
}

// Legacy function - kept for backwards compatibility but no longer used
function switchLessonTab(tab) {
  // This function is no longer used since we removed the tabs
  // But keeping it to avoid errors if called elsewhere
  console.warn('switchLessonTab is deprecated. Use switchViewMode instead.');
}

// ============================================
// Utility Functions
// ============================================

function logout() {
  document.getElementById('logoutModal').style.display = 'flex';
}

function closeLogoutModal() {
  document.getElementById('logoutModal').style.display = 'none';
}

function confirmLogout() {
  localStorage.removeItem('studentToken');
  localStorage.removeItem('studentData');
  window.location.href = '/caresim-login';
}

function showAlertModal(message, title = 'Notice') {
  const modal = document.getElementById('alertModal');
  const msg = document.getElementById('alertMessage');
  const ttl = document.getElementById('alertTitle');
  if (!modal || !msg || !ttl) return alert(message);
  ttl.textContent = title;
  msg.textContent = message;
  modal.style.display = 'flex';
}

function closeAlertModal() {
  document.getElementById('alertModal').style.display = 'none';
}

// Close modals on outside click
window.onclick = function(event) {
  const logoutModal = document.getElementById('logoutModal');
  const alertModal = document.getElementById('alertModal');
  const toolModal = document.getElementById('toolModal');
  if (event.target === logoutModal) closeLogoutModal();
  if (event.target === alertModal) closeAlertModal();
  if (event.target === toolModal) closeToolModal();
};
