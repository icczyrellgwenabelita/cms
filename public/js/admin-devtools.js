/**
 * Admin Dev Tools (Super Admin Only)
 * Handles floating FAB and Dev Panel for creating demo users.
 * Note: Firebase should already be initialized by the page's main script (e.g. admin-game-certificates.js)
 */

document.addEventListener('DOMContentLoaded', async function() {
    // Only run if we have an admin token
    const token = localStorage.getItem('adminToken');
    if (!token) return;

    try {
        // Check config to see if isDev is true
        const response = await fetch('/api/admin/config', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (data.success && data.config.isDev) {
            initDevTools();
        }
    } catch (e) {
        console.error("Error checking dev mode:", e);
    }
});

function initDevTools() {
    // Create FAB
    const fab = document.createElement('button');
    fab.className = 'admin-devtools-fab';
    fab.innerHTML = '<i class="fas fa-cog"></i>';
    fab.title = "Dev Tools";
    fab.onclick = toggleDevPanel;
    document.body.appendChild(fab);

    // Create Panel (hidden by default)
    const panel = document.createElement('div');
    panel.className = 'admin-devtools-panel';
    panel.style.display = 'none';
    panel.innerHTML = `
        <div class="admin-devtools-header">
            <h3>DEV TOOLS (SUPER ADMIN)</h3>
            <button onclick="toggleDevPanel()" class="admin-devtools-close"><i class="fas fa-times"></i></button>
        </div>
        <div class="admin-devtools-content">
            <div class="admin-devtools-actions" id="devToolsActions">
                <button class="admin-devtools-btn" onclick="showCreateForm('lms')">
                    <i class="fas fa-user-graduate"></i> Create Demo LMS Student
                </button>
                <button class="admin-devtools-btn" onclick="showCreateForm('game')">
                    <i class="fas fa-gamepad"></i> Create Demo Game User
                </button>
                <button class="admin-devtools-btn" onclick="window.location.href='/admin-dev-advanced'" style="background:#F59E0B; color:white; border:none;">
                    <i class="fas fa-cog"></i> Advanced Settings
                </button>
            </div>
            
            <div id="devToolsCreateForm" style="display:none; background:#F8FAFC; padding:10px; border-radius:6px; border:1px solid #E2E8F0; margin-bottom:15px;">
                <h4 style="margin:0 0 10px 0; font-size:12px; color:#475569; text-transform:uppercase;" id="devFormTitle">Create Demo User</h4>
                <div style="margin-bottom:8px;">
                    <label style="display:block; font-size:11px; font-weight:600; color:#64748B; margin-bottom:2px;">Email (Required)</label>
                    <input type="email" id="devEmail" style="width:100%; padding:6px; border:1px solid #CBD5E1; border-radius:4px; font-size:13px;" placeholder="user@example.com">
                </div>
                <div style="margin-bottom:8px;">
                    <label style="display:block; font-size:11px; font-weight:600; color:#64748B; margin-bottom:2px;">Name (Optional)</label>
                    <input type="text" id="devName" style="width:100%; padding:6px; border:1px solid #CBD5E1; border-radius:4px; font-size:13px;" placeholder="Demo User">
                </div>
                <div style="margin-bottom:12px;">
                    <label style="display:block; font-size:11px; font-weight:600; color:#64748B; margin-bottom:2px;">Password (Auto-generated)</label>
                    <input type="text" id="devPassword" readonly style="width:100%; padding:6px; border:1px solid #E2E8F0; background:#F1F5F9; border-radius:4px; font-size:13px; color:#475569; font-family:monospace;">
                </div>
                
                <div id="devFormError" style="display:none; color:#DC2626; font-size:12px; margin-bottom:10px;"></div>
                
                <div style="display:flex; gap:8px;">
                    <button id="devFormSubmitBtn" class="admin-devtools-btn" style="background:#2563EB; color:white; border:none; justify-content:center; flex:1;">Create</button>
                    <button onclick="hideCreateForm()" class="admin-devtools-btn" style="justify-content:center; flex:1;">Cancel</button>
                </div>
            </div>

            <div class="admin-devtools-separator"></div>
            <div class="admin-devtools-list-header">Demo Users Created:</div>
            <div id="adminDevToolsUserList" class="admin-devtools-user-list">
                Loading...
            </div>
        </div>
    `;
    document.body.appendChild(panel);
    
    // Load demo users via API (bypasses Firebase permission issues)
    loadDemoUsersViaAPI();
    
    // Set up polling to refresh the list periodically (every 5 seconds)
    // This simulates real-time updates without needing Firebase listeners
    setInterval(() => {
        if (document.querySelector('.admin-devtools-panel')?.style.display !== 'none') {
            loadDemoUsersViaAPI();
        }
    }, 5000);
}

async function loadDemoUsersViaAPI() {
    const listContainer = document.getElementById('adminDevToolsUserList');
    if (!listContainer) return;
    
    try {
        const token = localStorage.getItem('adminToken');
        if (!token) {
            listContainer.innerHTML = '<div style="padding:10px; text-align:center; color:#DC2626;">Not authenticated.</div>';
            return;
        }
        
        const response = await fetch('/api/admin/dev/demo-users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success && Array.isArray(data.users)) {
            renderDemoUsersFromArray(data.users);
        } else {
            throw new Error(data.error || 'Invalid response format');
        }
    } catch (err) {
        console.error('[DevTools] Error loading demo users:', err);
        const listContainer = document.getElementById('adminDevToolsUserList');
        if (listContainer) {
            listContainer.innerHTML = '<div style="padding:10px; text-align:center; color:#DC2626;">Error loading demo users. Check console.</div>';
        }
    }
}

function toggleDevPanel() {
    const panel = document.querySelector('.admin-devtools-panel');
    if (panel.style.display === 'none') {
        panel.style.display = 'flex';
        // Refresh the list when panel opens
        loadDemoUsersViaAPI();
    } else {
        panel.style.display = 'none';
    }
}

function showCreateForm(type) {
    document.getElementById('devToolsActions').style.display = 'none';
    const form = document.getElementById('devToolsCreateForm');
    form.style.display = 'block';
    
    const title = type === 'lms' ? 'Create Demo LMS Student' : 'Create Demo Game User';
    document.getElementById('devFormTitle').textContent = title;
    
    // Generate random password
    const password = 'Demo' + Math.random().toString(36).slice(-8) + '!';
    document.getElementById('devPassword').value = password;
    
    // Pre-fill email/name logic
    const ts = Date.now();
    document.getElementById('devEmail').value = type === 'lms' ? `demo.lms.${ts}@example.com` : `demo.game.${ts}@example.com`;
    document.getElementById('devName').value = type === 'lms' ? `Demo LMS Student ${ts}` : `Demo Game User ${ts}`;
    
    const submitBtn = document.getElementById('devFormSubmitBtn');
    submitBtn.onclick = () => submitCreateForm(type);
    
    document.getElementById('devFormError').style.display = 'none';
}

function hideCreateForm() {
    document.getElementById('devToolsCreateForm').style.display = 'none';
    document.getElementById('devToolsActions').style.display = 'flex';
}

async function submitCreateForm(type) {
    const email = document.getElementById('devEmail').value.trim();
    const name = document.getElementById('devName').value.trim();
    const password = document.getElementById('devPassword').value;
    
    if (!email) {
        showError("Email is required");
        return;
    }
    
    const btn = document.getElementById('devFormSubmitBtn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    
    try {
        const endpoint = type === 'lms' ? '/api/admin/dev/create-lms-student' : '/api/admin/dev/create-game-user';
        const token = localStorage.getItem('adminToken');
        
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, name, password })
        });
        
        const data = await res.json();
        
        if (data.success) {
            hideCreateForm();
            // Refresh demo users list
            loadDemoUsersViaAPI();
            // Refresh eligible users list if on that page
            if (type === 'game' && window.location.pathname.includes('admin-game-certificates') && typeof loadEligibleUsers === 'function') {
                loadEligibleUsers();
            }
        } else {
            showError(data.error || "Creation failed");
        }
    } catch (e) {
        showError(e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function showError(msg) {
    const errDiv = document.getElementById('devFormError');
    errDiv.textContent = msg;
    errDiv.style.display = 'block';
}

function renderDemoUsersFromArray(users) {
    const listContainer = document.getElementById('adminDevToolsUserList');
    if (!listContainer) {
        console.warn('[DevTools] List container not found');
        return;
    }

    if (!users || users.length === 0) {
        listContainer.innerHTML = '<div style="padding:10px; text-align:center; color:#999; font-style:italic;">No demo users created yet.</div>';
        return;
    }

    let html = '<table class="admin-devtools-demo-table">';
    html += '<thead class="admin-devtools-demo-header"><tr><th>Email</th><th>Pass</th><th>Type</th><th></th></tr></thead><tbody>';
    
    users.forEach(u => {
        const typeLabel = u.type === 'lms' ? 'LMS Student' : 'Game User';
        const typeClass = u.type === 'lms' ? 'lms' : 'game';
        const uid = u.uid || u.key || '';
        
        html += `
            <tr class="admin-devtools-demo-row">
                <td style="max-width:120px; overflow:hidden; text-overflow:ellipsis;" title="${u.email}">${u.email}</td>
                <td style="font-family:monospace;">${u.password || 'N/A'}</td>
                <td><span class="admin-devtools-badge ${typeClass}">${typeLabel}</span></td>
                <td>
                    <button onclick="deleteDemoUser('${uid}')" class="admin-devtools-demo-delete" title="Delete User"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
    html += '</tbody></table>';
    
    listContainer.innerHTML = html;
}

async function deleteDemoUser(uid) {
    if (!confirm("Delete this demo user? This will verify removal from Auth and DB.")) return;
    
    try {
        const token = localStorage.getItem('adminToken');
        const res = await fetch('/api/admin/dev/delete-user', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uid })
        });
        
        const data = await res.json();
        if (!data.success) {
            alert("Error: " + data.error);
            return;
        }
        
        // Refresh the list after successful deletion
        loadDemoUsersViaAPI();
    } catch (e) {
        alert("Error deleting: " + e.message);
    }
}

function createAdvancedSettingsModal() {
    const overlay = document.createElement('div');
    overlay.className = 'dev-advanced-overlay hidden';
    overlay.innerHTML = `
        <div class="dev-advanced-modal">
            <div class="dev-advanced-header">
                <h3>Dev Advanced Settings – Demo Users</h3>
                <button class="dev-advanced-close" onclick="closeAdvancedSettings()">×</button>
            </div>
            <div class="dev-advanced-body">
                <div id="devAdvancedUserList">
                    Loading...
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeAdvancedSettings();
        }
    });
}

function openAdvancedSettings() {
    const overlay = document.querySelector('.dev-advanced-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        loadAdvancedSettingsUsers();
    }
}

function closeAdvancedSettings() {
    const overlay = document.querySelector('.dev-advanced-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

async function loadAdvancedSettingsUsers() {
    const listContainer = document.getElementById('devAdvancedUserList');
    if (!listContainer) return;
    
    try {
        const token = localStorage.getItem('adminToken');
        if (!token) {
            listContainer.innerHTML = '<div style="padding:20px; text-align:center; color:#DC2626;">Not authenticated.</div>';
            return;
        }
        
        const response = await fetch('/api/admin/dev/demo-users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success && Array.isArray(data.users)) {
            renderAdvancedSettingsTable(data.users);
        } else {
            throw new Error(data.error || 'Invalid response format');
        }
    } catch (err) {
        console.error('[DevTools Advanced] Error loading demo users:', err);
        const listContainer = document.getElementById('devAdvancedUserList');
        if (listContainer) {
            listContainer.innerHTML = '<div style="padding:20px; text-align:center; color:#DC2626;">Error loading demo users. Check console.</div>';
        }
    }
}

function renderAdvancedSettingsTable(users) {
    const listContainer = document.getElementById('devAdvancedUserList');
    if (!listContainer) {
        console.warn('[DevTools Advanced] List container not found');
        return;
    }

    if (!users || users.length === 0) {
        listContainer.innerHTML = '<div style="padding:20px; text-align:center; color:#999; font-style:italic;">No demo users created yet.</div>';
        return;
    }

    let html = '<table class="dev-advanced-table">';
    html += '<thead><tr><th>Email</th><th>Type</th><th>LMS Lessons</th><th>Game Lessons</th><th>LMS Quiz</th><th>Game Quiz</th><th>Actions</th></tr></thead><tbody>';
    
    users.forEach(u => {
        const typeLabel = u.type === 'lms' ? 'LMS Student' : 'Game User';
        const typeClass = u.type === 'lms' ? 'lms' : 'game';
        const uid = u.uid || u.key || '';
        const lmsCount = u.lmsLessonsCompleted !== undefined ? u.lmsLessonsCompleted : 0;
        const gameCount = u.gameLessonsCompleted !== undefined ? u.gameLessonsCompleted : 0;
        
        html += `
            <tr class="dev-advanced-row" data-uid="${uid}">
                <td style="max-width:150px; overflow:hidden; text-overflow:ellipsis;" title="${u.email}">${u.email}</td>
                <td><span class="admin-devtools-badge ${typeClass}">${typeLabel}</span></td>
                <td>
                    ${u.type === 'lms' || u.role === 'student' ? `
                        <div class="dev-advanced-counter">
                            <button class="dev-advanced-counter-btn" onclick="adjustCounter('${uid}', 'lms', -1)">-</button>
                            <span class="dev-advanced-counter-value" id="lms-${uid}">${lmsCount}</span>
                            <button class="dev-advanced-counter-btn" onclick="adjustCounter('${uid}', 'lms', 1)">+</button>
                        </div>
                    ` : '<span style="color:#9CA3AF;">—</span>'}
                </td>
                <td>
                    ${u.type === 'game' || u.role === 'public' ? `
                        <div class="dev-advanced-counter">
                            <button class="dev-advanced-counter-btn" onclick="adjustCounter('${uid}', 'game', -1)">-</button>
                            <span class="dev-advanced-counter-value" id="game-${uid}">${gameCount}</span>
                            <button class="dev-advanced-counter-btn" onclick="adjustCounter('${uid}', 'game', 1)">+</button>
                        </div>
                    ` : '<span style="color:#9CA3AF;">—</span>'}
                </td>
                <td>
                    ${u.type === 'lms' || u.role === 'student' ? `
                        <input type="number" min="0" max="10" value="8" class="dev-advanced-quiz-input" id="lms-quiz-${uid}" style="width:50px; padding:4px; border:1px solid #CBD5E1; border-radius:4px;">
                    ` : '<span style="color:#9CA3AF;">—</span>'}
                </td>
                <td>
                    ${u.type === 'game' || u.role === 'public' ? `
                        <input type="number" min="0" max="10" value="8" class="dev-advanced-quiz-input" id="game-quiz-${uid}" style="width:50px; padding:4px; border:1px solid #CBD5E1; border-radius:4px;">
                    ` : '<span style="color:#9CA3AF;">—</span>'}
                </td>
                <td>
                    <div class="dev-advanced-actions">
                        <button class="dev-advanced-btn-apply" onclick="applyProgressUpdate('${uid}')">Apply</button>
                        <button class="dev-advanced-btn-reset" onclick="resetProgress('${uid}')">Reset</button>
                    </div>
                </td>
            </tr>
        `;
    });
    html += '</tbody></table>';
    
    listContainer.innerHTML = html;
}

function adjustCounter(uid, type, delta) {
    const valueEl = document.getElementById(`${type}-${uid}`);
    if (!valueEl) return;
    
    let current = parseInt(valueEl.textContent) || 0;
    current = Math.min(6, Math.max(0, current + delta));
    valueEl.textContent = current;
}

async function applyProgressUpdate(uid) {
    const row = document.querySelector(`.dev-advanced-row[data-uid="${uid}"]`);
    if (!row) return;
    
    const lmsCountEl = document.getElementById(`lms-${uid}`);
    const gameCountEl = document.getElementById(`game-${uid}`);
    const lmsQuizEl = document.getElementById(`lms-quiz-${uid}`);
    const gameQuizEl = document.getElementById(`game-quiz-${uid}`);
    
    const lmsCount = lmsCountEl ? parseInt(lmsCountEl.textContent) : undefined;
    const gameCount = gameCountEl ? parseInt(gameCountEl.textContent) : undefined;
    const lmsQuiz = lmsQuizEl ? parseInt(lmsQuizEl.value) : undefined;
    const gameQuiz = gameQuizEl ? parseInt(gameQuizEl.value) : undefined;
    
    // Find apply button and show loading
    const applyBtn = row.querySelector('.dev-advanced-btn-apply');
    const originalText = applyBtn ? applyBtn.textContent : 'Apply';
    if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = 'Updating...';
    }
    
    try {
        const token = localStorage.getItem('adminToken');
        const res = await fetch('/api/admin/dev/update-demo-progress', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uid,
                lmsLessonsCompleted: lmsCount,
                gameLessonsCompleted: gameCount,
                lmsQuizScore: lmsQuiz,
                gameQuizScore: gameQuiz
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            // Show success message
            if (applyBtn) {
                applyBtn.textContent = 'Updated!';
                applyBtn.style.background = '#10B981';
                setTimeout(() => {
                    applyBtn.textContent = originalText;
                    applyBtn.style.background = '';
                    applyBtn.disabled = false;
                }, 2000);
            }
            
            // Refresh the list to get updated counts
            setTimeout(() => {
                loadAdvancedSettingsUsers();
                loadDemoUsersViaAPI(); // Also refresh small panel
            }, 500);
        } else {
            alert("Error: " + (data.error || "Update failed"));
            if (applyBtn) {
                applyBtn.disabled = false;
                applyBtn.textContent = originalText;
            }
        }
    } catch (e) {
        alert("Error: " + e.message);
        if (applyBtn) {
            applyBtn.disabled = false;
            applyBtn.textContent = originalText;
        }
    }
}

async function resetProgress(uid) {
    if (!confirm("Reset this user's progress to 0? This will clear all LMS and Game progress.")) return;
    
    const row = document.querySelector(`.dev-advanced-row[data-uid="${uid}"]`);
    if (!row) return;
    
    const applyBtn = row.querySelector('.dev-advanced-btn-apply');
    const originalText = applyBtn ? applyBtn.textContent : 'Apply';
    if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = 'Resetting...';
    }
    
    try {
        const token = localStorage.getItem('adminToken');
        const res = await fetch('/api/admin/dev/update-demo-progress', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uid,
                lmsLessonsCompleted: 0,
                gameLessonsCompleted: 0
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            // Refresh the list
            loadAdvancedSettingsUsers();
            loadDemoUsersViaAPI();
        } else {
            alert("Error: " + (data.error || "Reset failed"));
        }
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        if (applyBtn) {
            applyBtn.disabled = false;
            applyBtn.textContent = originalText;
        }
    }
}

