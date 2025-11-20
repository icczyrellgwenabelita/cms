// Admin Dashboard - API Integration
const adminToken = localStorage.getItem('adminToken');

if (!adminToken) {
    window.location.href = '/admin-login';
}

const API_BASE = '/api/admin';

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

// Update current date/time
function updateDateTime() {
    const now = new Date();
    const options = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    const dateTimeEl = document.getElementById('currentDateTime');
    if (dateTimeEl) {
        dateTimeEl.textContent = now.toLocaleDateString('en-US', options);
    }
}

// Load statistics from API
async function loadStatistics() {
    try {
        const response = await fetch(`${API_BASE}/statistics`, {
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
            throw new Error(errorData.error || 'Failed to fetch statistics');
        }

        const data = await response.json();
        if (!data.success || !data.stats) {
            throw new Error('Invalid response from server');
        }

        const stats = data.stats;

        // Update statistics cards
        const totalUsersEl = document.getElementById('totalUsers');
        const totalLessonsEl = document.getElementById('totalLessons');
        const totalQuizzesEl = document.getElementById('totalQuizzes');
        const activeUsersEl = document.getElementById('activeUsers');
        const completionRateEl = document.getElementById('completionRate');
        const avgScoreEl = document.getElementById('avgScore');
        const quizAttemptsEl = document.getElementById('quizAttempts');
        const lessonsCompletedEl = document.getElementById('lessonsCompleted');

        if (totalUsersEl) totalUsersEl.textContent = stats.totalUsers || 0;
        if (totalLessonsEl) totalLessonsEl.textContent = '6'; // Fixed at 6 lessons
        if (totalQuizzesEl) totalQuizzesEl.textContent = '60'; // Fixed at 60 quizzes (10 per lesson)
        if (activeUsersEl) activeUsersEl.textContent = stats.activeUsers || 0;
        if (quizAttemptsEl) quizAttemptsEl.textContent = stats.totalQuizAttempts || 0;
        if (lessonsCompletedEl) lessonsCompletedEl.textContent = stats.totalSimulationAttempts || 0;

        // Calculate completion rate (simplified)
        if (completionRateEl) {
            const totalStudents = stats.totalStudents || 0;
            const attempts = stats.totalQuizAttempts || 0;
            const rate = totalStudents > 0 ? Math.round((attempts / (totalStudents * 6)) * 100) : 0;
            completionRateEl.textContent = `${Math.min(rate, 100)}%`;
        }

        // Calculate average score (placeholder - would need actual score data)
        if (avgScoreEl) {
            avgScoreEl.textContent = '8.2'; // Placeholder
        }

        // Load recent users
        await loadRecentUsers();

    } catch (error) {
        console.error('Load statistics error:', error);
        showError(error.message || 'Failed to load statistics');
    }
}

// Load recent users
async function loadRecentUsers() {
    try {
        const response = await fetch(`${API_BASE}/users`, {
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
            return; // Silently fail for recent users
        }

        const data = await response.json();
        if (!data.success || !data.users) {
            return;
        }

        const users = data.users || [];
        const recentUsers = users
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
            .slice(0, 5);

        const tbody = document.getElementById('recentUsersTableBody');
        if (tbody) {
            if (recentUsers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #64748B;">No users yet</td></tr>';
            } else {
                tbody.innerHTML = recentUsers.map(user => `
                    <tr>
                        <td>${user.name || 'N/A'}</td>
                        <td>${user.email || 'N/A'}</td>
                        <td><span class="role-badge role-${user.role || 'public'}">${user.role || 'public'}</span></td>
                        <td><span class="status-badge status-${user.active !== false ? 'active' : 'deactivated'}"></span></td>
                    </tr>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Load recent users error:', error);
    }
}

// Load recent activity (static for now)
function loadRecentActivity() {
    const activities = [
        { type: 'user', action: 'New user registered', user: 'System', time: 'Recently', icon: 'fa-user' },
        { type: 'quiz', action: 'Quiz completed', user: 'Student', lesson: 'Lesson 1', time: 'Recently', icon: 'fa-check-circle' },
        { type: 'lesson', action: 'Lesson updated', user: 'Admin', lesson: 'Lesson 3', time: 'Recently', icon: 'fa-edit' }
    ];

    const container = document.getElementById('activityList');
    if (container) {
        container.innerHTML = activities.map(activity => `
            <div class="activity-item">
                <div class="activity-icon"><i class="fas ${activity.icon}"></i></div>
                <div class="activity-content">
                    <p class="activity-text">
                        <strong>${activity.user}</strong> ${activity.action}
                        ${activity.lesson ? `<span class="activity-meta">in ${activity.lesson}</span>` : ''}
                    </p>
                    <span class="activity-time">${activity.time}</span>
                </div>
            </div>
        `).join('');
    }
}

// Load performance metrics
function loadPerformanceMetrics() {
    // These would ideally come from the statistics API, but for now use placeholders
    const totalLoginsEl = document.getElementById('totalLogins');
    const quizAttemptsEl = document.getElementById('quizAttempts');
    const lessonsCompletedEl = document.getElementById('lessonsCompleted');
    const activeSessionsEl = document.getElementById('activeSessions');

    if (totalLoginsEl) totalLoginsEl.textContent = '24';
    if (activeSessionsEl) activeSessionsEl.textContent = '8';

    // Animate progress bars
    setTimeout(() => {
        const loginsBar = document.getElementById('loginsBar');
        const quizzesBar = document.getElementById('quizzesBar');
        const lessonsBar = document.getElementById('lessonsBar');
        const sessionsBar = document.getElementById('sessionsBar');
        
        if (loginsBar) loginsBar.style.width = '60%';
        if (quizzesBar) quizzesBar.style.width = '85%';
        if (lessonsBar) lessonsBar.style.width = '70%';
        if (sessionsBar) sessionsBar.style.width = '40%';
    }, 100);
}

function refreshActivity() {
    loadRecentActivity();
    showToast('Activity refreshed');
}

function setTimeFilter(period) {
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (event && event.target) {
        event.target.classList.add('active');
    }
    loadPerformanceMetrics();
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
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

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initErrorMessageContainer();
    updateDateTime();
    setInterval(updateDateTime, 60000);
    loadStatistics();
    loadRecentActivity();
    loadPerformanceMetrics();
});





