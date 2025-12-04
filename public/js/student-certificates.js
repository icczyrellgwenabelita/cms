// ==========================================
// DEV OVERRIDE REMOVED - Use Admin Dev Tools instead
// ==========================================

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

document.addEventListener('DOMContentLoaded', async function() {
    // Check auth
    const token = localStorage.getItem('studentToken');
    if (!token) {
        window.location.href = '/caresim-login';
        return;
    }

    const { jsPDF } = window.jspdf;
    const db = firebase.database();
    const auth = firebase.auth();

    let currentUser = null;
    let eligibilityData = null;

    // Load Font Base64 Helper
    let greatVibesFont = null;
    
    async function loadCustomFont() {
        try {
            const response = await fetch('/fonts/GreatVibes-Regular.ttf');
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const base64 = reader.result.split(',')[1];
                    resolve(base64);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.error("Failed to load font", e);
            return null;
        }
    }

    // Start loading font immediately
    loadCustomFont().then(base64 => {
        greatVibesFont = base64;
    });


    // Initialize
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            // Fetch user profile for name
            const userSnap = await db.ref(`users/${user.uid}`).once('value');
            const userData = userSnap.val() || {};
            const studentName = userData.name || userData.fullName || user.displayName || 'Student';
            
            document.getElementById('studentNameDisplay').textContent = studentName;
            
            await checkEligibility(user.uid);
        } else {
            // Wait a bit to see if auth state resolves, otherwise redirect
        }
    });

    // Eligibility Check Logic
    async function checkEligibility(uid) {
        const statusBadge = document.getElementById('certStatusBadge');
        const certMessage = document.getElementById('certMessage');
        const downloadBtn = document.getElementById('downloadCertBtn');
        const requirementsSection = document.getElementById('requirementsSection');
        const missingList = document.getElementById('missingReqsList');

        try {
            // Check for existing certificate first
            const certRef = db.ref(`users/${uid}/certificates/caresim_lms_full`);
            const certSnap = await certRef.once('value');
            const existingCert = certSnap.val();

            if (existingCert) {
                statusBadge.className = 'cert-status-badge status-issued';
                statusBadge.textContent = 'Certificate Issued';
                certMessage.textContent = `Certificate issued on ${new Date(existingCert.issuedAt).toLocaleDateString()}.`;
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = 'Download Certificate Again (PDF)';
                requirementsSection.style.display = 'none';
                eligibilityData = { eligible: true, existing: existingCert };
                return;
            }

            // Check progress if not issued
            const progressRef = db.ref(`users/${uid}/lmsProgress`);
            const progressSnap = await progressRef.once('value');
            const progress = progressSnap.val() || {};

            let allMet = true;
            const missingItems = [];

            // Check Lessons 1-6
            for (let i = 1; i <= 6; i++) {
                const lessonKey = `lesson${i}`;
                const lessonData = progress[lessonKey] || {};
                
                // 1. Pages
                const completedPages = lessonData.completedPages || {};
                const hasPages = Object.keys(completedPages).length > 0; 
                
                // 2. Quiz
                const quiz = lessonData.quiz || {};
                const quizCompleted = quiz.completed === true;
                const quizScoreOk = (quiz.highestScore || 0) >= 7; // 7/10 (70%)

                // 3. Simulation
                const sim = lessonData.simulation || {};
                const simCompleted = sim.completed === true;
                const simPassed = sim.passed === true; 
                const simOk = simCompleted && simPassed;

                if (!hasPages || !quizCompleted || !quizScoreOk || !simOk) {
                    allMet = false;
                    const parts = [];
                    if (!hasPages) parts.push("Pages");
                    if (!quizCompleted) parts.push("Quiz Not Taken");
                    else if (!quizScoreOk) parts.push(`Quiz Score < 70% (${quiz.highestScore || 0}/10)`);
                    if (!simOk) parts.push("Simulation Not Passed");
                    
                    missingItems.push(`Lesson ${i}: ${parts.join(", ")}`);
                }
            }

            if (allMet) {
                statusBadge.className = 'cert-status-badge status-eligible';
                statusBadge.textContent = 'Eligible';
                certMessage.textContent = 'Congratulations! You have completed all requirements.';
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Download Certificate (PDF)';
                requirementsSection.style.display = 'none';
                eligibilityData = { eligible: true };
            } else {
                statusBadge.className = 'cert-status-badge status-in-progress';
                statusBadge.textContent = 'In Progress';
                certMessage.textContent = 'You have not yet completed all required lessons.';
                downloadBtn.disabled = true;
                
                missingList.innerHTML = missingItems.map(item => `<div class="req-item missing"><span>${item}</span></div>`).join('');
                requirementsSection.style.display = 'block';
                eligibilityData = { eligible: false };
            }

        } catch (error) {
            console.error('Eligibility check error:', error);
            statusBadge.textContent = 'Error checking status';
            certMessage.textContent = 'Please refresh the page.';
        }
    }

    // Download Logic
    document.getElementById('downloadCertBtn').addEventListener('click', async function() {
        if (!eligibilityData || !eligibilityData.eligible) return;

        const btn = this;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Generating PDF...';

        try {
            const studentName = document.getElementById('studentNameDisplay').textContent;
            const email = currentUser.email;
            const timestamp = new Date().toISOString(); // ISO string for storage
            let certId, issueDate;

            // Create or Get Cert Record
            const certRef = db.ref(`users/${currentUser.uid}/certificates/caresim_lms_full`);
            const snap = await certRef.once('value');
            
            if (snap.exists()) {
                const val = snap.val();
                certId = val.certificateId;
                issueDate = new Date(val.issuedAt);
            } else {
                // Create new
                certId = `LMS-${Date.now().toString().slice(-6)}-${Math.floor(Math.random()*1000)}`;
                issueDate = new Date(); // Date object for local use
                const issuedAtISO = issueDate.toISOString();
                
                // 1. Store in User Profile
                await certRef.set({
                    programId: "caresim_lms_full",
                    template: "student",
                    certificateId: certId,
                    issuedAt: issuedAtISO,
                    issuedBy: "system",
                    studentName: studentName,
                    email: email
                });

                // 2. Store in Central Registry via Backend (Bypasses Rule Issues)
                console.log('[LMS Cert] Registering via backend API:', `certificates/${certId}`);
                try {
                    const token = localStorage.getItem('studentToken');
                    const regRes = await fetch('/api/student/register-certificate', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            certId: certId,
                            fullName: studentName,
                            email: email,
                            type: 'lms_full',
                            issuedAt: Date.now()
                        })
                    });
                    
                    if (!regRes.ok) {
                        throw new Error('Registration failed: ' + regRes.statusText);
                    }
                    console.log('[LMS Cert] Registry registration successful');
                } catch (err) {
                    console.error('[LMS Cert] Registry registration FAILED:', err);
                    // We don't block the UI/PDF, but log it.
                }

                // Update UI to issued
                const statusBadge = document.getElementById('certStatusBadge');
                statusBadge.className = 'cert-status-badge status-issued';
                statusBadge.textContent = 'Certificate Issued';
            }

            // Generate PDF
            const doc = new jsPDF({
                orientation: 'landscape',
                unit: 'px',
                format: [842, 595]
            });

            // Add Custom Font if loaded
            if (greatVibesFont) {
                doc.addFileToVFS("GreatVibes-Regular.ttf", greatVibesFont);
                doc.addFont("GreatVibes-Regular.ttf", "Great Vibes", "normal");
            }

            const img = new Image();
            img.src = '/certificates/Student-Certificate.png';
            img.src += '?t=' + new Date().getTime();
            img.crossOrigin = "Anonymous";

            img.onload = () => {
                const width = doc.internal.pageSize.getWidth();
                const height = doc.internal.pageSize.getHeight();
                
                doc.addImage(img, 'PNG', 0, 0, width, height);

                // Configuration for text
                doc.setTextColor(50, 50, 50);
                
                // Name - Centered
                doc.setFontSize(50);
                
                if (greatVibesFont) {
                    doc.setFont("Great Vibes", "normal");
                    doc.setFontSize(70);
                } else {
                    doc.setFont("helvetica", "bold");
                }
                
                doc.text(studentName, width / 2, 320, { align: 'center' });

                // Date & ID - Reset font to standard for details
                doc.setFontSize(20);
                doc.setFont("helvetica", "normal");
                const dateStr = issueDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                
                doc.text(dateStr, 170, 545); 
                doc.text(certId, 170, 565);

                // Add QR Code
                const verifyUrl = `http://localhost:3000/verify-certificate.html?certId=${certId}`;
                const qrContainer = document.createElement('div');
                new QRCode(qrContainer, {
                    text: verifyUrl,
                    width: 128,
                    height: 128,
                    colorDark : "#000000",
                    colorLight : "#ffffff",
                    correctLevel : QRCode.CorrectLevel.H
                });

                // Wait for QR to be generated
                const qrImg = qrContainer.querySelector('img');
                if (qrImg) {
                    // If img is immediately available (sometimes QRCode.js is sync for small QRs or dataURLs)
                    // However, QRCode.js renders canvas first then can provide img.
                    // Let's assume it works. For better reliability we might need a small delay or check.
                    // QRCode.js usually appends a canvas and an img.
                    
                    // Let's use the data URL directly if possible.
                    // Actually, QRCode.js creates an img element with src data URI.
                    // We'll just take that src.
                    
                    const addQrAndSave = () => {
                        const qrDataUrl = qrImg.src;
                        // Place QR code in bottom right or appropriate corner
                        // PDF format is [842, 595]
                        // Let's put it at x=730, y=480, size 80x80
                        doc.addImage(qrDataUrl, 'PNG', 730, 480, 80, 80);
                        doc.save(`CareSim-Certificate-${studentName.replace(/\s+/g, '_')}.pdf`);
                        
                        btn.disabled = false;
                        btn.textContent = 'Download Certificate Again (PDF)';
                    };

                    if (qrImg.src && qrImg.src.startsWith('data:')) {
                        addQrAndSave();
                    } else {
                         qrImg.onload = addQrAndSave;
                    }
                } else {
                    // Fallback if QR gen fails (shouldn't with correct lib)
                     doc.save(`CareSim-Certificate-${studentName.replace(/\s+/g, '_')}.pdf`);
                     btn.disabled = false;
                     btn.textContent = 'Download Certificate Again (PDF)';
                }
            };
            
            img.onerror = () => {
                console.error('Image load error', img.src);
                alert('Failed to load certificate template.');
                btn.disabled = false;
                btn.textContent = originalText;
            }

        } catch (error) {
            console.error('Certificate generation error:', error);
            alert('Failed to generate certificate.');
            btn.disabled = false;
            btn.textContent = originalText;
        }
    });
});
