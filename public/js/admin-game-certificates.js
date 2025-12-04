const firebaseConfig = {
    apiKey: "AIzaSyAP_JtE2w4Qc0WSmfMUDt9XuyCC1AIOaIM",
    authDomain: "caresim-b9342.firebaseapp.com",
    databaseURL: "https://caresim-b9342-default-rtdb.firebaseio.com",
    projectId: "caresim-b9342",
    storageBucket: "caresim-b9342.firebasestorage.app",
    messagingSenderId: "939396955933",
    appId: "1:939396955933:web:ead67a4fa5a05052df2bf4",
    measurementId: "G-C056LGTZRY"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.database();
const auth = firebase.auth();

let publicState = { toIssue: [], issued: [] };
let studentState = { toNotify: [], notified: [] };
let currentMainTab = 'public';
let currentSecondaryTab = 'toIssue';

document.addEventListener('DOMContentLoaded', async function() {
    await loadAllData();
    // Initialize button visibility based on default tab
    if (currentMainTab === 'public') {
        document.getElementById('issueAllBtn').style.display = 'inline-flex';
        document.getElementById('notifyAllBtn').style.display = 'none';
    } else {
        document.getElementById('issueAllBtn').style.display = 'none';
        document.getElementById('notifyAllBtn').style.display = 'inline-flex';
    }
    renderTable();
});

async function loadAllData() {
    try {
        const snapshot = await db.ref('users').once('value');
        const users = snapshot.val() || {};
        
        publicState = { toIssue: [], issued: [] };
        studentState = { toNotify: [], notified: [] };
        
        for (const [uid, user] of Object.entries(users)) {
            const role = user.role || 'public';
            
            if (role === 'public') {
                // Public Game User Logic
                let completedCount = 0;
                if (typeof user.lessonsCompleted === 'number') {
                    completedCount = user.lessonsCompleted;
                } else if (user.gameProgress && user.gameProgress.lessonsCompleted) {
                    completedCount = user.gameProgress.lessonsCompleted;
                } else if (user.progress && user.progress.gameLessons) {
                    completedCount = Object.values(user.progress.gameLessons).filter(l => l.completed).length;
                }
                
                const certificates = user.certificates || {};
                const hasGenericCert = certificates.game_generic ? true : false;
                
                if (completedCount >= 6) {
                    if (hasGenericCert) {
                        publicState.issued.push({ uid, ...user, completedCount });
                    } else {
                        publicState.toIssue.push({ uid, ...user, completedCount });
                    }
                }
            } else if (role === 'student') {
                // LMS Student Logic
                const progress = user.lmsProgress || {};
                let allMet = true;
                
                for (let i = 1; i <= 6; i++) {
                    const lessonKey = `lesson${i}`;
                    const lessonData = progress[lessonKey] || {};
                    const completedPages = lessonData.completedPages || {};
                    const hasPages = Object.keys(completedPages).length > 0;
                    const quiz = lessonData.quiz || {};
                    const quizCompleted = quiz.completed === true;
                    const quizScoreOk = (quiz.highestScore || 0) >= 7;
                    const sim = lessonData.simulation || {};
                    const simOk = sim.completed === true && sim.passed === true;
                    
                    if (!hasPages || !quizCompleted || !quizScoreOk || !simOk) {
                        allMet = false;
                        break;
                    }
                }
                
                const certificates = user.certificates || {};
                const hasLmsCert = certificates.caresim_lms_full ? true : false;
                const hasNotificationSent = user.certificateNotificationSentAt ? true : false;
                
                if (allMet) {
                    // If they have a cert OR have been notified, they go to "notified" tab
                    if (hasLmsCert || hasNotificationSent) {
                        studentState.notified.push({ uid, ...user });
                    } else {
                        studentState.toNotify.push({ uid, ...user });
                    }
                }
            }
        }
    } catch (error) {
        console.error("Error loading users:", error);
    }
}

function switchMainTab(tab) {
    currentMainTab = tab;
    document.querySelectorAll('.admin-game-certs-main-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.admin-game-certs-main-tab[data-tab="${tab}"]`).classList.add('active');
    
    // Update secondary tabs
    const container = document.getElementById('secondaryTabsContainer');
    if (tab === 'public') {
        container.innerHTML = `
            <button class="admin-game-certs-secondary-tab active" data-filter="toIssue" onclick="switchSecondaryTab('toIssue')">To Issue</button>
            <button class="admin-game-certs-secondary-tab" data-filter="issued" onclick="switchSecondaryTab('issued')">Issued</button>
        `;
        currentSecondaryTab = 'toIssue';
        document.getElementById('issueAllBtn').style.display = 'inline-flex';
        document.getElementById('notifyAllBtn').style.display = 'none';
    } else {
        container.innerHTML = `
            <button class="admin-game-certs-secondary-tab active" data-filter="toNotify" onclick="switchSecondaryTab('toNotify')">To Notify</button>
            <button class="admin-game-certs-secondary-tab" data-filter="notified" onclick="switchSecondaryTab('notified')">Notified/Issued</button>
        `;
        currentSecondaryTab = 'toNotify';
        document.getElementById('issueAllBtn').style.display = 'none';
        document.getElementById('notifyAllBtn').style.display = 'inline-flex';
    }
    
    renderTable();
}

function switchSecondaryTab(filter) {
    currentSecondaryTab = filter;
    document.querySelectorAll('.admin-game-certs-secondary-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.admin-game-certs-secondary-tab[data-filter="${filter}"]`).classList.add('active');
    renderTable();
}

function renderTable() {
    const tableBody = document.getElementById('usersTableBody');
    const tableHeader = document.getElementById('tableHeader');
    
    let users = [];
    let columns = [];
    
    if (currentMainTab === 'public') {
        if (currentSecondaryTab === 'toIssue') {
            users = publicState.toIssue;
        } else {
            users = publicState.issued;
        }
        columns = ['Name', 'Email', 'Progress', 'Status', 'Actions'];
    } else {
        if (currentSecondaryTab === 'toNotify') {
            users = studentState.toNotify;
        } else {
            users = studentState.notified;
        }
        columns = ['Name', 'Email', 'Lessons', 'Eligibility/Status', 'Actions'];
    }
    
    // Update header
    tableHeader.innerHTML = `<tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr>`;
    
    // Update button visibility and disabled state
    const issueBtn = document.getElementById('issueAllBtn');
    const notifyBtn = document.getElementById('notifyAllBtn');
    
    if (currentMainTab === 'public') {
        if (issueBtn) {
            issueBtn.style.display = 'inline-flex';
            issueBtn.disabled = (currentSecondaryTab === 'toIssue' && users.length === 0);
        }
        if (notifyBtn) {
            notifyBtn.style.display = 'none';
        }
    } else {
        if (issueBtn) {
            issueBtn.style.display = 'none';
        }
        if (notifyBtn) {
            notifyBtn.style.display = 'inline-flex';
            notifyBtn.disabled = (currentSecondaryTab === 'toNotify' && users.length === 0);
        }
    }
    
    if (users.length === 0) {
        const emptyMsg = currentMainTab === 'public' 
            ? (currentSecondaryTab === 'toIssue' ? 'No eligible users found (6/6 lessons, no certificate).' : 'No certificates issued yet.')
            : (currentSecondaryTab === 'toNotify' ? 'No eligible students found.' : 'No certificates issued yet.');
        tableBody.innerHTML = `<tr><td colspan="${columns.length}" style="text-align: center;">${emptyMsg}</td></tr>`;
        return;
    }
    
    const rows = users.map(user => {
        if (currentMainTab === 'public') {
            const hasCert = currentSecondaryTab === 'issued';
            const issueDate = hasCert && user.certificates?.game_generic?.issuedAt 
                ? new Date(user.certificates.game_generic.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                : '';
            
            return `
                <tr id="row-${user.uid}">
                    <td>${user.name || user.fullName || 'Unknown'}</td>
                    <td>${user.email || 'No email'}</td>
                    <td>${user.completedCount || 0}/6 Lessons</td>
                    <td>
                        ${hasCert 
                            ? `<span class="admin-game-certs-status issued">Issued on ${issueDate}</span>`
                            : `<span class="admin-game-certs-status eligible">Eligible</span>`
                        }
                    </td>
                    <td>
                        ${hasCert
                            ? '<span style="color: #15803D;"><i class="fas fa-check"></i> Issued</span>'
                            : `<button class="admin-game-certs-btn" onclick="issueCertificate('${user.uid}', '${(user.name || user.fullName || '').replace(/'/g, "\\'")}', '${user.email || ''}')">
                                <i class="fas fa-certificate"></i> Issue & Email
                            </button>`
                        }
                    </td>
                </tr>
            `;
        } else {
            const hasCert = user.certificates?.caresim_lms_full ? true : false;
            const hasNotification = user.certificateNotificationSentAt ? true : false;
            const certDate = hasCert && user.certificates?.caresim_lms_full?.issuedAt
                ? new Date(user.certificates.caresim_lms_full.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                : '';
            const notificationDate = hasNotification && user.certificateNotificationSentAt
                ? new Date(user.certificateNotificationSentAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                : '';
            
            // Count completed lessons
            const progress = user.lmsProgress || {};
            let completedLessons = 0;
            for (let i = 1; i <= 6; i++) {
                const lesson = progress[`lesson${i}`] || {};
                if (lesson.quiz?.completed && lesson.simulation?.completed && lesson.simulation?.passed) {
                    completedLessons++;
                }
            }
            
            return `
                <tr id="row-${user.uid}">
                    <td>${user.name || user.fullName || 'Unknown'}</td>
                    <td>${user.email || 'No email'}</td>
                    <td>${completedLessons}/6</td>
                    <td>
                        ${hasCert
                            ? `<span class="admin-game-certs-status issued">Certificate Issued (${certDate})</span>`
                            : hasNotification
                            ? `<span class="admin-game-certs-status issued" style="background: #DBEAFE; color: #1E40AF;">Notified (${notificationDate})</span>`
                            : `<span class="admin-game-certs-status eligible">Eligible</span>`
                        }
                    </td>
                    <td>
                        ${hasCert
                            ? '<span style="color: #15803D;"><i class="fas fa-check"></i> Certificate Issued</span>'
                            : hasNotification
                            ? '<span style="color: #059669;"><i class="fas fa-envelope"></i> Notified</span>'
                            : `<button class="admin-game-certs-btn" onclick="notifyStudent('${user.uid}', '${(user.name || user.fullName || '').replace(/'/g, "\\'")}', '${user.email || ''}')">
                                <i class="fas fa-envelope"></i> Notify Student
                            </button>`
                        }
                    </td>
                </tr>
            `;
        }
    });
    
    tableBody.innerHTML = rows.join('');
}

async function issueCertificate(uid, name, email) {
    const row = document.getElementById(`row-${uid}`);
    const btn = row.querySelector('button');
    const originalText = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Issuing...';
    
    try {
        const certId = `PUB-${Date.now().toString().slice(-6)}-${Math.floor(Math.random()*1000)}`;
        const timestamp = Date.now();
        
        console.log('[Game Cert] Writing to registry:', `certificates/${certId}`);
        try {
            await db.ref(`certificates/${certId}`).set({
                type: "game_generic",
                userId: uid,
                fullName: name,
                email: email || null,
                issuedAt: timestamp,
                status: "valid"
            });
            console.log('[Game Cert] Registry write success');
        } catch (e) {
            console.error('[Game Cert] Registry write FAILED:', e);
            throw e;
        }
        
        await db.ref(`users/${uid}/certificates/game_generic`).set({
            certificateId: certId,
            issuedAt: timestamp
        });
        
        const token = localStorage.getItem('adminToken');
        const response = await fetch('/api/admin/issue-game-certificate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                uid,
                email,
                name,
                certId
            })
        });
        
        if (!response.ok) {
            const errData = await response.json();
            console.warn('Email sending failed:', errData);
            const errorMsg = errData.error || errData.details || 'Email service error';
            alert(`Certificate issued successfully, but email could not be sent:\n\n${errorMsg}\n\nPlease check email service configuration.`);
        }
        
        // Refresh data and switch to issued tab if we're on toIssue tab
        await loadAllData();
        if (currentMainTab === 'public' && currentSecondaryTab === 'toIssue') {
            switchSecondaryTab('issued');
        } else {
            renderTable();
        }
        
    } catch (error) {
        console.error("Issue error:", error);
        alert("Failed to issue certificate: " + error.message);
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function notifyStudent(uid, name, email) {
    const row = document.getElementById(`row-${uid}`);
    const btn = row.querySelector('button');
    const originalText = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    
    try {
        const token = localStorage.getItem('adminToken');
        const response = await fetch('/api/admin/certificates/notify-student', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ uid, email, fullName: name })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Refresh data immediately
            await loadAllData();
            
            // Switch to "Notified/Issued" tab if we're on LMS Students tab
            if (currentMainTab === 'lms' && currentSecondaryTab === 'toNotify') {
                switchSecondaryTab('notified');
            } else {
                // Just re-render if already on notified tab
                renderTable();
            }
        } else {
            const errorMsg = data.error || data.details || 'Failed to send notification';
            alert(`Failed to send notification email:\n\n${errorMsg}\n\nPlease check:\n- Email service configuration\n- Student email address is valid\n- Network connection`);
            throw new Error(errorMsg);
        }
    } catch (error) {
        console.error("Notify error:", error);
        let errorMessage = "Failed to notify student.";
        if (error.message) {
            errorMessage += "\n\nError: " + error.message;
        }
        if (error.message && error.message.includes('Email service not configured')) {
            errorMessage += "\n\nThe email service is not configured. Please contact the system administrator.";
        }
        alert(errorMessage);
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function issueAllEligible() {
    if (publicState.toIssue.length === 0) return;
    if (!confirm(`Are you sure you want to issue certificates to all ${publicState.toIssue.length} eligible users?`)) return;
    
    const btn = document.getElementById('issueAllBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    
    let successCount = 0;
    const token = localStorage.getItem('adminToken');
    
    for (const user of publicState.toIssue) {
        try {
            const certId = `PUB-${Date.now().toString().slice(-6)}-${Math.floor(Math.random()*1000)}`;
            const timestamp = Date.now();
            const name = user.name || user.fullName || 'Unknown';
            const email = user.email || '';
            
            await db.ref(`certificates/${certId}`).set({
                type: "game_generic",
                userId: user.uid,
                fullName: name,
                email: email || null,
                issuedAt: timestamp,
                status: "valid"
            });
            
            await db.ref(`users/${user.uid}/certificates/game_generic`).set({
                certificateId: certId,
                issuedAt: timestamp
            });
            
            const response = await fetch('/api/admin/issue-game-certificate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    uid: user.uid,
                    email,
                    name,
                    certId
                })
            });
            
            if (response.ok) {
                successCount++;
            }
        } catch (e) {
            console.error(`Failed for ${user.email}`, e);
        }
    }
    
    alert(`Process complete. Issued ${successCount} certificates.`);
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-mail-bulk"></i> Issue for All Eligible';
    
    // Refresh data and switch to issued tab
    await loadAllData();
    if (currentMainTab === 'public' && currentSecondaryTab === 'toIssue') {
        switchSecondaryTab('issued');
    } else {
        renderTable();
    }
}

async function notifyAllEligible() {
    if (studentState.toNotify.length === 0) return;
    if (!confirm(`Are you sure you want to notify all ${studentState.toNotify.length} eligible students?`)) return;
    
    const btn = document.getElementById('notifyAllBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    
    let successCount = 0;
    const token = localStorage.getItem('adminToken');
    
    for (const user of studentState.toNotify) {
        try {
            const response = await fetch('/api/admin/certificates/notify-student', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    uid: user.uid, 
                    email: user.email, 
                    fullName: user.name || user.fullName || 'Student' 
                })
            });
            
            const data = await response.json();
            if (data.success) {
                successCount++;
            }
        } catch (e) {
            console.error(`Failed for ${user.email}`, e);
        }
    }
    
    alert(`Process complete. Notified ${successCount} students.`);
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-envelope"></i> Notify All Eligible';
    
    // Refresh data and switch to notified tab
    await loadAllData();
    if (currentMainTab === 'lms' && currentSecondaryTab === 'toNotify') {
        switchSecondaryTab('notified');
    } else {
        renderTable();
    }
}
