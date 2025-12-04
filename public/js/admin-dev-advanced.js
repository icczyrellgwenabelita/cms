/**
 * Dev Advanced Settings Page
 * Per-lesson control for demo users' LMS and Game progress
 */

let currentSelectedUid = null;
let currentUserData = null;
let currentTab = 'lms'; // Default to LMS for LMS students
let demoUsersList = []; // Store full user list with passwords
let publishedLessons = {}; // Store published lessons map

document.addEventListener('DOMContentLoaded', async function() {
    // Verify dev access
    const token = localStorage.getItem('adminToken');
    if (!token) {
        window.location.href = '/admin-dashboard';
        return;
    }

    try {
        const response = await fetch('/api/admin/config', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (!data.success || !data.config.isDev) {
            window.location.href = '/admin-dashboard';
            return;
        }
    } catch (e) {
        console.error("Error checking dev mode:", e);
        window.location.href = '/admin-dashboard';
        return;
    }

    // Load published lessons and demo users list
    await loadPublishedLessons();
    loadDemoUsersList();
});

async function loadPublishedLessons() {
    try {
        const token = localStorage.getItem('adminToken');
        const response = await fetch('/api/admin/lessons', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success && Array.isArray(data.lessons)) {
                // Convert array to map by slot, only include published lessons
                publishedLessons = {};
                data.lessons.forEach(lesson => {
                    const status = (lesson.status || '').toString().toLowerCase();
                    if (status === 'published') {
                        publishedLessons[String(lesson.slot)] = {
                            slot: lesson.slot,
                            title: lesson.lessonTitle || lesson.lessonName || `Lesson ${lesson.slot}`
                        };
                    }
                });
            }
        }
    } catch (err) {
        console.error('[Dev Advanced] Error loading published lessons:', err);
        // Fallback to empty object - will show no lessons
        publishedLessons = {};
    }
}

async function loadDemoUsersList() {
    const container = document.getElementById('devAdvancedUsersList');
    if (!container) return;

    try {
        const token = localStorage.getItem('adminToken');
        const response = await fetch('/api/admin/dev/demo-users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.success && Array.isArray(data.users)) {
            demoUsersList = data.users; // Store for password access
            renderUsersList(data.users);
        } else {
            container.innerHTML = '<div class="dev-advanced-error">Error loading demo users</div>';
        }
    } catch (err) {
        console.error('[Dev Advanced] Error loading users:', err);
        container.innerHTML = '<div class="dev-advanced-error">Error loading demo users. Check console.</div>';
    }
}

function renderUsersList(users) {
    const container = document.getElementById('devAdvancedUsersList');
    if (!container) return;

    if (!users || users.length === 0) {
        container.innerHTML = '<div class="dev-advanced-empty">No demo users created yet.</div>';
        return;
    }

    // Get count of published lessons
    const publishedLessonsCount = Object.keys(publishedLessons).length;
    const maxLessons = publishedLessonsCount > 0 ? publishedLessonsCount : 6; // Fallback to 6 if no lessons loaded yet

    let html = '';
    users.forEach(u => {
        const typeLabel = u.type === 'lms' ? 'LMS Student' : 'Game User';
        const typeClass = u.type === 'lms' ? 'lms' : 'game';
        const lmsCount = u.lmsLessonsCompleted !== undefined ? u.lmsLessonsCompleted : 0;
        const gameCount = u.gameLessonsCompleted !== undefined ? u.gameLessonsCompleted : 0;
        const isSelected = currentSelectedUid === u.uid ? 'selected' : '';

        html += `
            <div class="dev-advanced-user-item ${isSelected}" onclick="selectUser('${u.uid}')">
                <div class="dev-advanced-user-item-header">
                    <div class="dev-advanced-user-item-name" title="${u.email}">${u.email}</div>
                    <span class="admin-devtools-badge ${typeClass}">${typeLabel}</span>
                </div>
                <div class="dev-advanced-user-item-summary">
                    ${u.type === 'lms' ? `<span>LMS: ${lmsCount}/${maxLessons}</span><span>Game: ${gameCount}/${maxLessons}</span>` : `<span>Game: ${gameCount}/${maxLessons}</span>`}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

async function selectUser(uid) {
    currentSelectedUid = uid;

    // Update UI
    document.querySelectorAll('.dev-advanced-user-item').forEach(item => {
        item.classList.remove('selected');
    });
    event?.currentTarget?.classList.add('selected');

    // Show loading
    const detailsPane = document.getElementById('devAdvancedUserDetails');
    const noSelection = document.getElementById('devAdvancedNoSelection');
    detailsPane.classList.add('hidden');
    noSelection.style.display = 'none';

    try {
        const token = localStorage.getItem('adminToken');
        const response = await fetch(`/api/admin/dev/demo-user/${uid}/progress`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.success) {
            currentUserData = data;
            renderUserDetails(data);
            detailsPane.classList.remove('hidden');
        } else {
            throw new Error(data.error || 'Failed to load user data');
        }
    } catch (err) {
        console.error('[Dev Advanced] Error loading user progress:', err);
        alert('Error loading user progress: ' + err.message);
        noSelection.style.display = 'block';
    }
}

function renderUserDetails(data) {
    const { user, lms, game } = data;

    // Find password from demoUsersList
    const demoUser = demoUsersList.find(u => u.uid === user.uid);
    const password = demoUser?.password || 'N/A';

    // Update header
    document.getElementById('devAdvancedUserName').textContent = user.name || user.email;
    document.getElementById('devAdvancedUserEmail').textContent = user.email;
    document.getElementById('devAdvancedUserPassword').textContent = password;
    
    const typeBadge = document.getElementById('devAdvancedUserType');
    const isLmsUser = user.role === 'student' || user.demoType === 'lms';
    typeBadge.textContent = isLmsUser ? 'LMS Student' : 'Game User';
    typeBadge.className = `admin-devtools-badge ${isLmsUser ? 'lms' : 'game'}`;

    // Hide/show LMS tab based on user type
    const lmsTabBtn = document.getElementById('devAdvancedLmsTabBtn');
    const lmsTab = document.getElementById('devAdvancedLmsTab');
    const gameTabBtn = document.getElementById('devAdvancedGameTabBtn');
    
    if (isLmsUser) {
        // Show LMS tab for LMS users and make it active by default
        if (lmsTabBtn) lmsTabBtn.style.display = 'block';
        if (lmsTab) {
            lmsTab.classList.remove('hidden');
        }
        // Set LMS tab as active (default for LMS students)
        currentTab = 'lms';
        // Hide Game tab
        const gameTab = document.getElementById('devAdvancedGameTab');
        if (gameTab) {
            gameTab.classList.remove('active');
            gameTab.style.display = 'none';
        }
        if (gameTabBtn) {
            gameTabBtn.classList.remove('active');
        }
        // Show and activate LMS tab
        if (lmsTabBtn) {
            lmsTabBtn.classList.add('active');
        }
        if (lmsTab) {
            lmsTab.classList.add('active');
            lmsTab.style.display = 'block';
        }
    } else {
        // Hide LMS tab for Game users (they only play Unity game, can't access LMS)
        if (lmsTabBtn) lmsTabBtn.style.display = 'none';
        if (lmsTab) {
            lmsTab.style.display = 'none';
            lmsTab.classList.add('hidden');
            lmsTab.classList.remove('active');
            // Clear LMS table content to prevent it from showing
            const lmsTableBody = document.getElementById('devAdvancedLmsTableBody');
            if (lmsTableBody) lmsTableBody.innerHTML = '';
        }
        // Ensure Game tab is active for Game users
        currentTab = 'game';
        // Remove active from LMS tab
        if (lmsTabBtn) lmsTabBtn.classList.remove('active');
        // Set Game tab as active
        if (gameTabBtn) {
            gameTabBtn.classList.add('active');
        }
        const gameTab = document.getElementById('devAdvancedGameTab');
        if (gameTab) {
            gameTab.classList.add('active');
            gameTab.style.display = 'block';
        }
    }

    // Update game summary
    document.getElementById('devAdvancedGameCompleted').textContent = game.summary.lessonsCompleted;

    // Render LMS table (only if LMS user)
    if (isLmsUser) {
        renderLmsTable(lms);
    }

    // Render Game table
    renderGameTable(game);
}

function renderLmsTable(lms) {
    const tbody = document.getElementById('devAdvancedLmsTableBody');
    if (!tbody) return;

    let html = '';
    
    // Only render published lessons
    const sortedSlots = Object.keys(publishedLessons)
        .map(s => parseInt(s))
        .filter(s => !isNaN(s))
        .sort((a, b) => a - b);
    
    if (sortedSlots.length === 0) {
        html = '<tr><td colspan="4" style="text-align: center; color: #9CA3AF; padding: 20px;">No published lessons found</td></tr>';
    } else {
        for (const slot of sortedSlots) {
            const lessonInfo = publishedLessons[String(slot)];
            const lesson = lms[String(slot)] || {};
            const hasPages = lesson.hasPages || false;
            const completedPagesCount = lesson.completedPagesCount || 0;
            const lastAssessment = lesson.lastAssessment || null;
            const lessonTitle = lessonInfo.title || `Lesson ${slot}`;

            html += `
                <tr class="dev-advanced-lesson-row">
                    <td>
                        <strong>${lessonTitle}</strong>
                    </td>
                    <td>
                        <label class="dev-advanced-checkbox-label">
                            <input type="checkbox" id="lms-${slot}-pages" ${hasPages ? 'checked' : ''} 
                                   onchange="updateLmsLessonField(${slot}, 'hasPages', this.checked)">
                            Pages completed
                        </label>
                        ${completedPagesCount > 0 ? `<div style="font-size: 12px; color: #6B7280; margin-top: 4px;">${completedPagesCount} page(s) with assessments passed</div>` : ''}
                    </td>
                    <td>
                        <div style="font-size: 13px; color: #4B5563;">
                            ${hasPages ? '<span style="color: #10B981;">✓ Assessments completed</span>' : '<span style="color: #9CA3AF;">No assessments</span>'}
                            ${lastAssessment ? `<div style="font-size: 11px; color: #9CA3AF; margin-top: 4px;">Last: ${new Date(lastAssessment).toLocaleDateString()}</div>` : ''}
                        </div>
                    </td>
                    <td>
                        <button class="dev-advanced-btn-apply" onclick="applyLmsLesson(${slot})">Apply</button>
                    </td>
                </tr>
            `;
        }
    }

    tbody.innerHTML = html;
}

function renderGameTable(game) {
    const tbody = document.getElementById('devAdvancedGameTableBody');
    if (!tbody) return;

    let html = '';
    
    // Only render published lessons
    const sortedSlots = Object.keys(publishedLessons)
        .map(s => parseInt(s))
        .filter(s => !isNaN(s))
        .sort((a, b) => a - b);
    
    if (sortedSlots.length === 0) {
        html = '<tr><td colspan="5" style="text-align: center; color: #9CA3AF; padding: 20px;">No published lessons found</td></tr>';
    } else {
        for (const slot of sortedSlots) {
            const lessonInfo = publishedLessons[String(slot)];
            const lesson = game[String(slot)] || {};
            const completed = lesson.completed || false;
            const quizCompleted = lesson.quiz?.completed || false;
            const quizScore = lesson.quiz?.bestScore || 0;
            const quizAttempts = lesson.quiz?.attempts || 0;
            const simCompleted = lesson.simulation?.completed || false;
            const simPassed = lesson.simulation?.passed || false;
            const simScore = lesson.simulation?.score || 0;
            const lessonTitle = lessonInfo.title || `Lesson ${slot}`;

            html += `
                <tr class="dev-advanced-lesson-row">
                    <td><strong>${lessonTitle}</strong></td>
                    <td>
                        <span class="dev-advanced-badge ${completed ? 'completed' : 'not-completed'}">
                            ${completed ? 'Completed' : 'Not Completed'}
                        </span>
                    </td>
                    <td>
                        <div class="dev-advanced-quiz-controls">
                            <label class="dev-advanced-checkbox-label">
                                <input type="checkbox" id="game-${slot}-quiz-completed" ${quizCompleted ? 'checked' : ''}
                                       onchange="updateGameLessonField(${slot}, 'quizCompleted', this.checked)">
                                Completed
                            </label>
                            <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 6px;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <label style="font-size: 11px; color: #6B7280; min-width: 50px;">Score (0-10):</label>
                                    <input type="number" min="0" max="10" id="game-${slot}-quiz-score" value="${quizScore}"
                                           class="dev-advanced-number-input"
                                           onchange="updateGameLessonField(${slot}, 'quizScore', this.value)">
                                </div>
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <label style="font-size: 11px; color: #6B7280; min-width: 50px;">Attempts:</label>
                                    <input type="number" min="0" id="game-${slot}-quiz-attempts" value="${quizAttempts}"
                                           class="dev-advanced-number-input"
                                           onchange="updateGameLessonField(${slot}, 'quizAttempts', this.value)">
                                </div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div class="dev-advanced-sim-controls">
                            <label class="dev-advanced-checkbox-label">
                                <input type="checkbox" id="game-${slot}-sim-completed" ${simCompleted ? 'checked' : ''}
                                       onchange="updateGameLessonField(${slot}, 'simCompleted', this.checked)">
                                Completed
                            </label>
                            <label class="dev-advanced-checkbox-label">
                                <input type="checkbox" id="game-${slot}-sim-passed" ${simPassed ? 'checked' : ''}
                                       onchange="updateGameLessonField(${slot}, 'simPassed', this.checked)">
                                Passed
                            </label>
                            <div style="display: flex; align-items: center; gap: 6px; margin-top: 6px;">
                                <label style="font-size: 11px; color: #6B7280; min-width: 50px;">Score (0-100):</label>
                                <input type="number" min="0" max="100" id="game-${slot}-sim-score" value="${simScore}"
                                       class="dev-advanced-number-input"
                                       onchange="updateGameLessonField(${slot}, 'simScore', this.value)">
                            </div>
                        </div>
                    </td>
                    <td>
                        <button class="dev-advanced-btn-apply" onclick="applyGameLesson(${slot})">Apply</button>
                        <button class="dev-advanced-btn-quick" onclick="quickPassGameLesson(${slot})">Quick Pass</button>
                    </td>
                </tr>
            `;
        }
    }

    tbody.innerHTML = html;
}

// LMS lesson field updates (store in memory, don't send yet)
let lmsLessonUpdates = {};
function updateLmsLessonField(lesson, field, value) {
    if (!lmsLessonUpdates[lesson]) {
        lmsLessonUpdates[lesson] = {};
    }
    lmsLessonUpdates[lesson][field] = value;
}

// Game lesson field updates
let gameLessonUpdates = {};
function updateGameLessonField(lesson, field, value) {
    if (!gameLessonUpdates[lesson]) {
        gameLessonUpdates[lesson] = {};
    }
    gameLessonUpdates[lesson][field] = value;
}

async function applyLmsLesson(lesson) {
    if (!currentSelectedUid) return;

    const hasPages = document.getElementById(`lms-${lesson}-pages`).checked;

    const btn = event?.target || document.querySelector(`button[onclick="applyLmsLesson(${lesson})"]`);
    const originalText = btn?.textContent || 'Apply';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving...';
    }

    try {
        const token = localStorage.getItem('adminToken');
        const response = await fetch(`/api/admin/dev/demo-user/${currentSelectedUid}/update-lesson`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                system: 'lms',
                lesson,
                lmsData: {
                    hasPages
                }
            })
        });

        const data = await response.json();
        if (data.success) {
            if (btn) {
                btn.textContent = 'Updated!';
                btn.style.background = '#10B981';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = '';
                    btn.disabled = false;
                }, 2000);
            }
            // Reload user data
            await selectUser(currentSelectedUid);
        } else {
            throw new Error(data.error || 'Update failed');
        }
    } catch (err) {
        console.error('[Dev Advanced] Error updating LMS lesson:', err);
        alert('Error: ' + err.message);
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}

function quickPassLmsLesson(lesson) {
    document.getElementById(`lms-${lesson}-pages`).checked = true;
    applyLmsLesson(lesson);
}

async function applyGameLesson(lesson) {
    if (!currentSelectedUid) return;

    const quizCompleted = document.getElementById(`game-${lesson}-quiz-completed`).checked;
    const quizScore = parseInt(document.getElementById(`game-${lesson}-quiz-score`).value) || 8;
    const quizAttempts = parseInt(document.getElementById(`game-${lesson}-quiz-attempts`).value) || 1;
    const simCompleted = document.getElementById(`game-${lesson}-sim-completed`).checked;
    const simPassed = document.getElementById(`game-${lesson}-sim-passed`).checked;
    const simScore = parseInt(document.getElementById(`game-${lesson}-sim-score`).value) || 100;

    const btn = event?.target || document.querySelector(`button[onclick="applyGameLesson(${lesson})"]`);
    const originalText = btn?.textContent || 'Apply';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving...';
    }

    try {
        const token = localStorage.getItem('adminToken');
        const response = await fetch(`/api/admin/dev/demo-user/${currentSelectedUid}/update-lesson`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                system: 'game',
                lesson,
                gameData: {
                    quizCompleted,
                    quizBestScore: quizScore,
                    quizAttempts,
                    simulationCompleted: simCompleted,
                    simulationPassed: simPassed,
                    simulationScore: simScore
                }
            })
        });

        const data = await response.json();
        if (data.success) {
            if (btn) {
                btn.textContent = 'Updated!';
                btn.style.background = '#10B981';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = '';
                    btn.disabled = false;
                }, 2000);
            }
            // Update summary
            if (data.game?.summary) {
                document.getElementById('devAdvancedGameCompleted').textContent = data.game.summary.lessonsCompleted;
            }
            // Reload user data
            await selectUser(currentSelectedUid);
        } else {
            throw new Error(data.error || 'Update failed');
        }
    } catch (err) {
        console.error('[Dev Advanced] Error updating Game lesson:', err);
        alert('Error: ' + err.message);
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}

function quickPassGameLesson(lesson) {
    document.getElementById(`game-${lesson}-quiz-completed`).checked = true;
    document.getElementById(`game-${lesson}-quiz-score`).value = 8;
    document.getElementById(`game-${lesson}-quiz-attempts`).value = 1;
    document.getElementById(`game-${lesson}-sim-completed`).checked = true;
    document.getElementById(`game-${lesson}-sim-passed`).checked = true;
    document.getElementById(`game-${lesson}-sim-score`).value = 100;
    applyGameLesson(lesson);
}

async function markAllGameComplete(event) {
    if (!currentSelectedUid || !confirm('Mark all 6 game lessons as complete?')) return;

    // Show loading state
    const btn = this || event?.target || document.getElementById('btnMarkAllComplete');
    const originalHtml = btn?.innerHTML || '<i class="fas fa-check-double"></i> Mark All Lessons Complete';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
    }

    try {
        const token = localStorage.getItem('adminToken');
        const response = await fetch('/api/admin/dev/update-demo-progress', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uid: currentSelectedUid,
                gameLessonsCompleted: 6,
                gameQuizScore: 8
            })
        });

        const data = await response.json();
        if (data.success) {
            if (btn) {
                btn.innerHTML = '<i class="fas fa-check"></i> Updated!';
                btn.style.background = '#10B981';
                setTimeout(() => {
                    btn.innerHTML = originalHtml;
                    btn.style.background = '';
                    btn.disabled = false;
                }, 2000);
            }
            await selectUser(currentSelectedUid);
        } else {
            throw new Error(data.error || 'Update failed');
        }
    } catch (err) {
        console.error('[Dev Advanced] Error marking all complete:', err);
        alert('Error: ' + err.message);
        if (btn) {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    }
}

async function clearAllGameProgress(event) {
    if (!currentSelectedUid || !confirm('Clear all game progress? This will reset to 0/6.')) return;

    // Show loading state
    const btn = this || event?.target || document.getElementById('btnClearAllProgress');
    const originalHtml = btn?.innerHTML || '<i class="fas fa-eraser"></i> Clear All Game Progress';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...';
    }

    try {
        const token = localStorage.getItem('adminToken');
        const response = await fetch('/api/admin/dev/update-demo-progress', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uid: currentSelectedUid,
                gameLessonsCompleted: 0
            })
        });

        const data = await response.json();
        if (data.success) {
            if (btn) {
                btn.innerHTML = '<i class="fas fa-check"></i> Cleared!';
                btn.style.background = '#10B981';
                setTimeout(() => {
                    btn.innerHTML = originalHtml;
                    btn.style.background = '';
                    btn.disabled = false;
                }, 2000);
            }
            await selectUser(currentSelectedUid);
        } else {
            throw new Error(data.error || 'Update failed');
        }
    } catch (err) {
        console.error('[Dev Advanced] Error clearing progress:', err);
        alert('Error: ' + err.message);
        if (btn) {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    }
}

function switchDevTab(tab) {
    // Don't allow switching to LMS tab if it's hidden (for game users)
    if (tab === 'lms') {
        const lmsTabBtn = document.getElementById('devAdvancedLmsTabBtn');
        if (lmsTabBtn && lmsTabBtn.style.display === 'none') {
            return; // Don't switch if LMS tab is hidden
        }
    }
    
    currentTab = tab;
    
    // Remove active from all tabs and tab contents
    document.querySelectorAll('.dev-advanced-tab').forEach(t => {
        t.classList.remove('active');
    });
    document.querySelectorAll('.dev-advanced-tab-content').forEach(c => {
        c.classList.remove('active');
        c.style.display = 'none'; // Explicitly hide all tabs
    });
    
    // Activate the selected tab
    const tabBtn = document.querySelector(`.dev-advanced-tab[data-tab="${tab}"]`);
    const tabContent = document.getElementById(`devAdvanced${tab.charAt(0).toUpperCase() + tab.slice(1)}Tab`);
    if (tabBtn && tabContent) {
        tabBtn.classList.add('active');
        tabContent.classList.add('active');
        tabContent.style.display = 'block'; // Explicitly show the active tab
    }
}

function showCreateDemoUserForm() {
    const form = document.getElementById('devAdvancedCreateForm');
    const list = document.getElementById('devAdvancedUsersList');
    if (form) {
        form.classList.remove('hidden');
        // Pre-fill with defaults
        const ts = Date.now();
        const typeSelect = document.getElementById('devCreateUserType');
        if (typeSelect && typeSelect.value === 'lms') {
            document.getElementById('devCreateUserEmail').value = `demo.lms.${ts}@example.com`;
            document.getElementById('devCreateUserName').value = `Demo LMS Student ${ts}`;
        } else {
            document.getElementById('devCreateUserEmail').value = `demo.game.${ts}@example.com`;
            document.getElementById('devCreateUserName').value = `Demo Game User ${ts}`;
        }
        typeSelect?.addEventListener('change', function() {
            const ts = Date.now();
            if (this.value === 'lms') {
                document.getElementById('devCreateUserEmail').value = `demo.lms.${ts}@example.com`;
                document.getElementById('devCreateUserName').value = `Demo LMS Student ${ts}`;
            } else {
                document.getElementById('devCreateUserEmail').value = `demo.game.${ts}@example.com`;
                document.getElementById('devCreateUserName').value = `Demo Game User ${ts}`;
            }
        });
    }
}

function hideCreateDemoUserForm() {
    const form = document.getElementById('devAdvancedCreateForm');
    if (form) {
        form.classList.add('hidden');
        document.getElementById('devCreateError').style.display = 'none';
        document.getElementById('devCreateUserEmail').value = '';
        document.getElementById('devCreateUserName').value = '';
    }
}

async function submitCreateDemoUser() {
    const email = document.getElementById('devCreateUserEmail').value.trim();
    const name = document.getElementById('devCreateUserName').value.trim();
    const type = document.getElementById('devCreateUserType').value;
    const errorDiv = document.getElementById('devCreateError');

    if (!email) {
        errorDiv.textContent = 'Email is required';
        errorDiv.style.display = 'block';
        return;
    }

    // Generate password
    const password = 'Demo' + Math.random().toString(36).slice(-8) + '!';

    try {
        const token = localStorage.getItem('adminToken');
        const endpoint = type === 'lms' ? '/api/admin/dev/create-lms-student' : '/api/admin/dev/create-game-user';
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, name, password })
        });

        const data = await response.json();
        
        if (data.success) {
            hideCreateDemoUserForm();
            // Refresh the list
            loadDemoUsersList();
        } else {
            errorDiv.textContent = data.error || 'Creation failed';
            errorDiv.style.display = 'block';
        }
    } catch (err) {
        errorDiv.textContent = err.message || 'Error creating user';
        errorDiv.style.display = 'block';
    }
}

