// Admin Lessons Management - Enhanced LMS Overview
const adminToken = localStorage.getItem('adminToken');

if (!adminToken) {
    window.location.href = '/admin-login';
}

const API_BASE = '/api/admin';

let allLessons = [];
let filteredLessons = [];
let currentStatusFilter = 'all';
let searchQuery = '';
let sortOption = 'newest';

// Error message container
let errorMessageContainer = null;

function initErrorMessageContainer() {
    const container = document.querySelector('.portal-container');
    if (container && !errorMessageContainer) {
        errorMessageContainer = document.createElement('div');
        errorMessageContainer.id = 'errorMessage';
        errorMessageContainer.style.cssText = 'display: none; padding: 12px 16px; margin-bottom: 20px; background: #FEE2E2; border: 1px solid #EF4444; border-radius: 8px; color: #DC2626; font-size: 14px;';
        container.insertBefore(errorMessageContainer, container.firstChild);
    }
}

function showError(message) {
    initErrorMessageContainer();
    if (errorMessageContainer) {
        errorMessageContainer.textContent = message;
        errorMessageContainer.style.display = 'block';
        setTimeout(() => {
            if (errorMessageContainer) errorMessageContainer.style.display = 'none';
        }, 5000);
    } else {
        console.error('Error:', message);
        alert(message);
    }
}

function showSuccess(message) {
    showAlertModal(message, 'Success');
}

function setupControls() {
    const searchInput = document.getElementById('lessonSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (event) => {
            searchQuery = event.target.value.toLowerCase();
            applyLessonFilters();
        });
    }

    const sortSelect = document.getElementById('lessonSortSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', (event) => {
            sortOption = event.target.value;
            applyLessonFilters();
        });
    }

    const statusButtons = document.querySelectorAll('.status-filter-btn');
    statusButtons.forEach(button => {
        button.addEventListener('click', () => {
            currentStatusFilter = button.dataset.status;
            statusButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            applyLessonFilters();
        });
    });
}

// Load lessons from API
async function loadLessons() {
    try {
        const container = document.getElementById('lessonsContainer');
        if (container) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: #64748B;">Loading lessons...</div>';
        }

        const response = await fetch(`${API_BASE}/lessons`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to fetch lessons');
        }

        const data = await response.json();
        if (!data.success || !data.lessons) {
            throw new Error('Invalid response from server');
        }

        allLessons = data.lessons || [];
        applyLessonFilters();
    } catch (error) {
        console.error('Load lessons error:', error);
        showError(error.message || 'Failed to load lessons');
        
        const container = document.getElementById('lessonsContainer');
        if (container) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: #64748B;">Failed to load lessons</div>';
        }
    }
}

function applyLessonFilters() {
    let lessons = Array.isArray(allLessons) ? [...allLessons] : [];

    if (currentStatusFilter !== 'all') {
        lessons = lessons.filter(lesson => {
            const status = (lesson.status || 'draft').toLowerCase();
            return status === currentStatusFilter;
        });
    }

    if (searchQuery) {
        lessons = lessons.filter(lesson => {
            const title = (lesson.lessonTitle || lesson.lessonName || '').toLowerCase();
            return title.includes(searchQuery);
        });
    }

    lessons.sort((a, b) => {
        if (sortOption === 'title') {
            const titleA = (a.lessonTitle || a.lessonName || '').toLowerCase();
            const titleB = (b.lessonTitle || b.lessonName || '').toLowerCase();
            return titleA.localeCompare(titleB);
        }

        const timeA = getTimestamp(a.lastUpdated || a.updatedAt || a.createdAt);
        const timeB = getTimestamp(b.lastUpdated || b.updatedAt || b.createdAt);

        if (sortOption === 'oldest') {
            return timeA - timeB;
        }

        return timeB - timeA; // newest
    });

    filteredLessons = lessons;
    renderLessons();
}

function getTimestamp(dateString) {
    if (!dateString) return 0;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatUpdatedDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function pluralize(count, noun) {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function renderLessons() {
    const container = document.getElementById('lessonsContainer');
    if (!container) return;

    if (!filteredLessons.length) {
        if (!allLessons.length) {
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: #64748B;">
                <i class="fas fa-book-open" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                <h3 style="margin-bottom: 8px; color: #1F2937;">No lessons found</h3>
                <p style="margin-bottom: 24px;">Create your first lesson to get started.</p>
                <button class="btn-primary" onclick="createNewLesson()">
                    <i class="fas fa-plus"></i> Create Lesson
                </button>
            </div>
        `;
        } else {
            container.innerHTML = `
                <div style="text-align: center; padding: 60px 20px; color: #64748B;">
                    <i class="fas fa-filter" style="font-size: 40px; margin-bottom: 16px; opacity: 0.5;"></i>
                    <h3 style="margin-bottom: 8px; color: #1F2937;">No lessons match the current filters</h3>
                    <p>Try adjusting your search, status filter, or sort order.</p>
                </div>
            `;
        }
        return;
    }

    container.innerHTML = filteredLessons.map(lesson => {
        const slot = lesson.slot || 0;
        const lessonName = escapeHtml(lesson.lessonTitle || lesson.lessonName || 'Untitled Lesson');
        const lessonDescription = escapeHtml(lesson.description || lesson.lessonDescription || '');
        const pageCount = lesson.pageCount || 0;
        const assessmentCount = lesson.assessmentCount || 0;
        const toolCount = lesson.tools ? Object.keys(lesson.tools).length : 0;
        const status = (lesson.status || 'draft').toLowerCase();
        const statusLabel = status === 'published' ? 'Published' : 'Draft';
        const updatedLabel = formatUpdatedDate(lesson.lastUpdated || lesson.updatedAt || lesson.createdAt);
        
        return `
            <div class="lesson-card" onclick="openLesson(${slot})">
                <div class="lesson-card-header">
                    <span class="lesson-number">Lesson ${slot}</span>
                    <span class="lesson-status status-${status}">${statusLabel}</span>
                </div>
                <div class="lesson-card-title">
                    <h3 class="lesson-name">${lessonName}</h3>
                </div>
                <div class="lesson-card-description">${lessonDescription}</div>
                
                <div class="lesson-card-stats">
                    <div class="lesson-metrics">
                        <div class="lesson-metric">
                            <i class="fas fa-layer-group"></i> ${pluralize(pageCount, 'page')}
                        </div>
                        <div class="lesson-metric">
                            <i class="fas fa-question-circle"></i> ${pluralize(assessmentCount, 'assessment')}
                        </div>
                        <div class="lesson-metric">
                            <i class="fas fa-wrench"></i> ${pluralize(toolCount, 'tool')}
                        </div>
                    </div>
                    <div class="lesson-card-footer">
                        <span class="lesson-updated">${updatedLabel ? `Updated ${updatedLabel}` : 'Not updated yet'}</span>
                    </div>
                </div>

                <div class="lesson-card-actions">
                    <button class="btn-card-action btn-edit" onclick="event.stopPropagation(); openLesson(${slot});">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn-card-action btn-pages" onclick="event.stopPropagation(); openPages(${slot});">
                        <i class="fas fa-file-alt"></i> Pages
                    </button>
                    <button class="btn-card-action btn-view" onclick="event.stopPropagation(); openTools(${slot});">
                        <i class="fas fa-wrench"></i> Tools
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function createNewLesson() {
    window.location.href = `/admin-lesson-editor?action=create`;
}

function openLesson(slot) {
    window.location.href = `/admin-lesson-editor?slot=${slot}&action=edit`;
}

function openPages(slot) {
    window.location.href = `/admin-lesson-editor?slot=${slot}&action=edit&tab=pages`;
}

function openTools(slot) {
    window.location.href = `/admin-lesson-editor?slot=${slot}&action=edit&tab=tools`;
}

function logout() {
    const modal = document.getElementById('logoutModal');
    if (modal) modal.style.display = 'flex';
}

function closeLogoutModal() {
    const modal = document.getElementById('logoutModal');
    if (modal) modal.style.display = 'none';
}

function confirmLogout() {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminData');
    window.location.href = '/admin-login';
}

function showAlertModal(message, title = 'Notice') {
    const modal = document.getElementById('alertModal');
    const msg = document.getElementById('alertMessage');
    const ttl = document.getElementById('alertTitle');
    if (!modal || !msg || !ttl) {
        alert(message);
        return;
    }
    ttl.textContent = title;
    msg.textContent = message;
    modal.style.display = 'flex';
}

function closeAlertModal() {
    const modal = document.getElementById('alertModal');
    if (modal) modal.style.display = 'none';
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initErrorMessageContainer();
    setupControls();
    loadLessons();
});


