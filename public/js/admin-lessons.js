// Admin Lessons Management - API Integration
const adminToken = localStorage.getItem('adminToken');

if (!adminToken) {
    window.location.href = '/admin-login';
}

const API_BASE = '/api/admin';

let allLessons = [];

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
        renderLessons();
    } catch (error) {
        console.error('Load lessons error:', error);
        showError(error.message || 'Failed to load lessons');
        
        const container = document.getElementById('lessonsContainer');
        if (container) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: #64748B;">Failed to load lessons</div>';
        }
    }
}

// Render lessons
function renderLessons() {
    const container = document.getElementById('lessonsContainer');
    if (!container) return;

    if (allLessons.length === 0) {
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
        return;
    }

    container.innerHTML = allLessons.map(lesson => {
        const slot = lesson.slot || 0;
        const lessonName = lesson.lessonTitle || lesson.lessonName || 'Untitled Lesson';
        const lessonDescription = lesson.description || lesson.lessonDescription || 'No description';
        const toolsCount = lesson.tools ? Object.keys(lesson.tools).length : 0;
        
        return `
            <div class="lesson-card">
                <div class="lesson-card-header">
                    <span class="lesson-number">Lesson ${slot}</span>
                </div>
                <h3 class="lesson-name">${lessonName}</h3>
                <p class="lesson-description">${lessonDescription}</p>
                <div class="lesson-meta">
                    <span class="lesson-tools-count"><i class="fas fa-wrench"></i> ${toolsCount} tool${toolsCount !== 1 ? 's' : ''}</span>
                </div>
                <div class="lesson-card-actions">
                    <button class="btn-card-action btn-edit" onclick="editLesson(${slot})">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn-card-action btn-tools" onclick="manageTools(${slot})">
                        <i class="fas fa-wrench"></i> Tools
                    </button>
                    <button class="btn-card-action btn-view" onclick="viewLesson(${slot})">
                        <i class="fas fa-eye"></i> View
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function createNewLesson() {
    window.location.href = `/admin-lesson-editor?action=create`;
}

function editLesson(slot) {
    window.location.href = `/admin-lesson-editor?slot=${slot}&action=edit`;
}

function manageTools(slot) {
    window.location.href = `/admin-lesson-editor?slot=${slot}&action=edit&tab=tools`;
}

function viewLesson(slot) {
    window.location.href = `/admin-lesson-editor?slot=${slot}&action=edit&tab=preview`;
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
    loadLessons();
});




