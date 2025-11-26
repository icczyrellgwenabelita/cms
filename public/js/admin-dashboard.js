// Admin Dashboard - Enhanced data hub
const adminToken = localStorage.getItem('adminToken');

if (!adminToken) {
    window.location.href = '/admin-login';
}

const API_BASE = '/api/admin';
const REFRESH_INTERVALS = {
    activity: 15000,
    recentUsers: 15000,
    health: 60000
};

const storedAdmin = localStorage.getItem('adminData');
const parsedAdmin = storedAdmin ? JSON.parse(storedAdmin) : {};
const adminRole = parsedAdmin.role || 'admin';
const isPrimaryAdmin = adminRole === 'admin';

let latestStats = null;
let backupList = [];
let pendingRestoreFile = null;
let refreshTimers = [];
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
    }
}

function initializeQuickActions() {
    if (!isPrimaryAdmin) {
        document.querySelectorAll('[data-admin-only="true"]').forEach(card => {
            card.style.display = 'none';
        });
    }
}

function escapeHtml(value = '') {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}

function formatBytes(bytes = 0) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString();
}

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

async function apiGet(endpoint) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
        return null;
        }
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed (${endpoint})`);
    }
    return response.json();
}

async function fetchDashboardSummary() {
    try {
        const data = await apiGet('/dashboard/summary');
        if (!data || !data.success) return;
        latestStats = data.stats;
        updateStatCards(latestStats);
        updatePerformanceMetrics();
    } catch (error) {
        console.error('Dashboard summary error:', error);
        showError('Unable to load statistics');
    }
}

function updateStatCards(stats = {}) {
        const totalUsersEl = document.getElementById('totalUsers');
        const totalLessonsEl = document.getElementById('totalLessons');
    const totalAssessmentsEl = document.getElementById('totalAssessments');
        const activeUsersEl = document.getElementById('activeUsers');
        const completionRateEl = document.getElementById('completionRate');
        const avgScoreEl = document.getElementById('avgScore');
    const usersChangeEl = document.getElementById('usersChange');
    const activeSubtitleEl = document.getElementById('activeSubtitle');
    if (totalUsersEl) totalUsersEl.textContent = stats.totalUsers ?? 0;
    if (usersChangeEl) usersChangeEl.textContent = `+${stats.newUsersWeek ?? 0} this week`;
    if (totalLessonsEl) totalLessonsEl.textContent = stats.totalLessons ?? 0;
    if (totalAssessmentsEl) totalAssessmentsEl.textContent = stats.totalAssessments ?? 0;
    if (activeUsersEl) activeUsersEl.textContent = stats.activeUsers ?? 0;
    if (activeSubtitleEl) activeSubtitleEl.textContent = `${stats.activePercent ?? 0}% active`;
    if (completionRateEl) completionRateEl.textContent = `${stats.avgCompletion ?? 0}%`;
    if (avgScoreEl) avgScoreEl.textContent = (stats.avgQuizScore ?? 0).toFixed(1);
}

function updatePerformanceMetrics() {
    if (!latestStats) return;
    const totalLogins = latestStats.totalLogins || 0;
    const quizAttempts = latestStats.totalQuizAttempts || 0;
    const lessonsCompleted = latestStats.lessonsCompleted || 0;
    const activeSessions = latestStats.activeSessions || 0;

    setMetricValue('totalLogins', totalLogins);
    setMetricValue('quizAttempts', quizAttempts);
    setMetricValue('lessonsCompleted', lessonsCompleted);
    setMetricValue('activeSessions', activeSessions);

    const maxValue = Math.max(totalLogins, quizAttempts, lessonsCompleted, activeSessions, 1);
    setMetricBar('loginsBar', totalLogins, maxValue);
    setMetricBar('quizzesBar', quizAttempts, maxValue);
    setMetricBar('lessonsBar', lessonsCompleted, maxValue);
    setMetricBar('sessionsBar', activeSessions, maxValue);
}

function setMetricValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setMetricBar(id, value, max) {
    const el = document.getElementById(id);
    if (el) {
        const percent = Math.min(100, Math.round((value / max) * 100));
        requestAnimationFrame(() => {
            el.style.width = `${percent}%`;
        });
    }
}

async function fetchRecentActivity(isManual = false) {
    try {
        const data = await apiGet('/dashboard/activity?limit=8');
        if (!data || !data.success) return;
        renderActivityList(data.activities || []);
        if (isManual) showToast('Activity refreshed');
    } catch (error) {
        console.error('Activity error:', error);
    }
}

function renderActivityList(activities = []) {
    const container = document.getElementById('activityList');
    if (!container) return;
    if (!activities.length) {
        container.innerHTML = '<p class="activity-empty">No recent activity</p>';
            return;
    }
    container.innerHTML = activities.map(activity => {
        const icon = getActivityIcon(activity.type);
        const timeAgo = formatTimeAgo(activity.timestamp);
        const description = escapeHtml(activity.description || activity.action || 'Activity');
        const actor = escapeHtml(activity.actorName || activity.actorType || 'System');
        const meta = activity.relatedLesson ? `<span class="activity-meta">Lesson ${escapeHtml(String(activity.relatedLesson))}</span>` : '';
        return `
            <div class="activity-item">
                <div class="activity-icon"><i class="fas ${icon}"></i></div>
                <div class="activity-content">
                    <p class="activity-text"><strong>${actor}</strong> ${description} ${meta}</p>
                    <span class="activity-time">${timeAgo}</span>
                </div>
            </div>
        `;
    }).join('');
}

function getActivityIcon(type) {
    switch (type) {
        case 'auth':
            return 'fa-user-check';
        case 'lesson':
            return 'fa-file-alt';
        case 'system':
            return 'fa-server';
        default:
            return 'fa-bolt';
    }
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Just now';
    const then = new Date(timestamp).getTime();
    if (Number.isNaN(then)) return 'Just now';
    const diff = Date.now() - then;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

async function fetchRecentUsers() {
    try {
        const data = await apiGet('/dashboard/recent-users?limit=5');
        if (!data || !data.success) return;
        renderRecentUsers(data.users || []);
    } catch (error) {
        console.error('Recent users error:', error);
    }
}

function renderRecentUsers(users = []) {
        const tbody = document.getElementById('recentUsersTableBody');
    if (!tbody) return;
    if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#64748B;">No users yet</td></tr>';
        return;
    }
    tbody.innerHTML = users.map(user => `
                    <tr>
                        <td>${user.name || 'N/A'}</td>
                        <td>${user.email || 'N/A'}</td>
                        <td><span class="role-badge role-${user.role || 'public'}">${user.role || 'public'}</span></td>
            <td>
                <span class="status-chip ${user.status === 'online' ? 'chip-online' : 'chip-offline'}">
                    ${user.status === 'online' ? 'Active' : 'Inactive'}
                </span>
            </td>
                    </tr>
                `).join('');
}

async function fetchHealthStatus() {
    try {
        const data = await apiGet('/health');
        if (!data || !data.success) return;
        updateSystemStatus(data.status || {});
    } catch (error) {
        console.error('Health status error:', error);
    }
}

async function fetchBackupList() {
    try {
        const data = await apiGet('/dashboard/backups?limit=10');
        if (!data || !data.success) return;
        backupList = data.backups || [];
        renderBackupList();
    } catch (error) {
        console.error('Backups load error:', error);
    }
}

function renderBackupList() {
    const tbody = document.getElementById('backupTableBody');
    if (!tbody) return;
    if (!backupList.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#64748B;">No backups yet</td></tr>';
        return;
    }
    tbody.innerHTML = backupList.map(backup => {
        const safeName = escapeHtml(backup.fileName || backup.id);
        const attrName = (backup.fileName || backup.id || '').replace(/'/g, "\\'");
        return `
            <tr>
                <td>${safeName}</td>
                <td>${formatDate(backup.createdAt)}</td>
                <td>${formatBytes(backup.size)}</td>
                <td><button class="btn-secondary" onclick="openRestoreModal('${attrName}')">Restore</button></td>
            </tr>
        `;
    }).join('');
}

function refreshBackups() {
    fetchBackupList();
}

function goToAssessments() {
    window.location.href = '/admin-lessons?view=assessments';
}

function scrollToBackups() {
    const card = document.getElementById('backupsCard');
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function scrollToAnalytics() {
    const card = document.getElementById('metricsCard');
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function openRestoreModal(fileName) {
    pendingRestoreFile = fileName;
    const modal = document.getElementById('restoreModal');
    const input = document.getElementById('restoreConfirmInput');
    const targetInput = document.getElementById('restoreTargetFile');
    if (input) input.value = '';
    if (targetInput) targetInput.value = fileName;
    if (modal) modal.style.display = 'flex';
}

function closeRestoreModal() {
    const modal = document.getElementById('restoreModal');
    pendingRestoreFile = null;
    if (modal) modal.style.display = 'none';
}

async function confirmRestore(event) {
    event.preventDefault();
    if (!pendingRestoreFile) {
        closeRestoreModal();
        return;
    }
    const input = document.getElementById('restoreConfirmInput');
    if (!input || input.value.trim().toUpperCase() !== 'RESTORE') {
        showError('Please type RESTORE to confirm.');
        return;
    }
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
        const response = await fetch(`${API_BASE}/backup/restore`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fileName: pendingRestoreFile })
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Restore failed');
        }
        showToast('Backup restored');
        closeRestoreModal();
        await Promise.all([
            fetchDashboardSummary(),
            fetchRecentActivity(),
            fetchHealthStatus(),
            fetchBackupList()
        ]);
    } catch (error) {
        console.error('Restore error:', error);
        showError(error.message || 'Restore failed');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function updateSystemStatus(status = {}) {
    const systemStatusEl = document.getElementById('systemStatus');
    const dbStatusEl = document.getElementById('dbStatus');
    const apiStatusEl = document.getElementById('apiStatus');
    const storageStatusEl = document.getElementById('storageStatus');
    const backupStatusEl = document.getElementById('backupStatus');
    const backupBtn = document.getElementById('backupNowBtn');

    if (systemStatusEl) {
        systemStatusEl.textContent = (status.overall === 'online') ? 'Online' : 'Issues detected';
        systemStatusEl.classList.toggle('online', status.overall === 'online');
        systemStatusEl.classList.toggle('offline', status.overall !== 'online');
    }
    updateStatusRow(dbStatusEl, document.getElementById('dbStatusBadge'), status.database);
    updateStatusRow(apiStatusEl, document.getElementById('apiStatusBadge'), status.api);
    updateStatusRow(storageStatusEl, document.getElementById('storageStatusBadge'), status.storage);

    if (backupStatusEl) {
        const timestamp = status.backup?.lastBackupAt
            ? new Date(status.backup.lastBackupAt).toLocaleString()
            : 'No backups yet';
        backupStatusEl.textContent = timestamp;
        updateStatusRow(backupStatusEl, document.getElementById('backupStatusBadge'), {
            status: status.backup?.inProgress ? 'warning' : 'ok'
        });
    }
    if (backupBtn) {
        const busy = !!status.backup?.inProgress || !!status.backup?.restoreInProgress;
        backupBtn.disabled = busy;
        if (status.backup?.inProgress) {
            backupBtn.textContent = 'Backing up...';
        } else if (status.backup?.restoreInProgress) {
            backupBtn.textContent = 'Restoring...';
        } else {
            backupBtn.textContent = 'Backup Now';
        }
    }
}

function updateStatusRow(labelEl, badgeEl, status) {
    if (labelEl && status?.message) {
        labelEl.textContent = status.message;
    }
    if (badgeEl) {
        badgeEl.classList.remove('status-online', 'status-offline', 'status-warning');
        switch (status?.status) {
            case 'ok':
                badgeEl.classList.add('status-online');
                break;
            case 'warning':
                badgeEl.classList.add('status-warning');
                break;
            default:
                badgeEl.classList.add('status-offline');
        }
    }
}

async function triggerBackup() {
    try {
        const backupBtn = document.getElementById('backupNowBtn');
        if (backupBtn) {
            backupBtn.disabled = true;
            backupBtn.textContent = 'Backing up...';
        }
        const response = await fetch(`${API_BASE}/backup`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Backup failed');
        }
        showToast('Backup completed');
        await fetchHealthStatus();
        await fetchBackupList();
        await fetchRecentActivity();
    } catch (error) {
        console.error('Backup error:', error);
        showError(error.message || 'Backup failed');
    } finally {
        const backupBtn = document.getElementById('backupNowBtn');
        if (backupBtn) {
            backupBtn.disabled = false;
            backupBtn.textContent = 'Backup Now';
        }
    }
}

function refreshActivity() {
    fetchRecentActivity(true);
}

function setTimeFilter(period, evt) {
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (evt && evt.target) {
        evt.target.classList.add('active');
    }
    updatePerformanceMetrics();
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
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

function setupAutoRefresh() {
    refreshTimers.push(setInterval(fetchRecentActivity, REFRESH_INTERVALS.activity));
    refreshTimers.push(setInterval(fetchRecentUsers, REFRESH_INTERVALS.recentUsers));
    refreshTimers.push(setInterval(fetchHealthStatus, REFRESH_INTERVALS.health));
}

function clearAutoRefresh() {
    refreshTimers.forEach(timer => clearInterval(timer));
    refreshTimers = [];
}

document.addEventListener('DOMContentLoaded', () => {
    initErrorMessageContainer();
    updateDateTime();
    setInterval(updateDateTime, 60000);
    initializeQuickActions();
    fetchDashboardSummary();
    fetchRecentActivity();
    fetchRecentUsers();
    fetchHealthStatus();
    fetchBackupList();
    setupAutoRefresh();
});

window.addEventListener('beforeunload', clearAutoRefresh);

window.refreshBackups = refreshBackups;
window.openRestoreModal = openRestoreModal;
window.closeRestoreModal = closeRestoreModal;
window.confirmRestore = confirmRestore;
window.goToAssessments = goToAssessments;
window.scrollToBackups = scrollToBackups;
window.scrollToAnalytics = scrollToAnalytics;