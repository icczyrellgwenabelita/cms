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

document.addEventListener('DOMContentLoaded', async function() {
    const loadingState = document.getElementById('loadingState');
    const validState = document.getElementById('validState');
    const errorState = document.getElementById('errorState');
    const downloadBtn = document.getElementById('downloadBtn');
    
    // Get certId from URL
    const urlParams = new URLSearchParams(window.location.search);
    const certId = urlParams.get('certId');
    
    // Check for Dev Mode (Super Admin)
    let isDev = false;
    try {
        const token = localStorage.getItem('adminToken');
        if (token) {
            const res = await fetch('/api/admin/config', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success && data.config.isDev) {
                isDev = true;
            }
        }
    } catch (e) {
        console.log("Not an admin or dev check failed");
    }

    if (!certId) {
        if (isDev) {
            // Show Dev UI
            loadingState.style.display = 'none';
            errorState.style.display = 'none';
            
            const container = document.querySelector('.certificate-card') || document.body;
            let devForm = document.getElementById('devForm');
            
            if (!devForm) {
                devForm = document.createElement('div');
                devForm.id = 'devForm';
                devForm.style.cssText = "padding: 20px; border: 2px dashed #F59E0B; background: #FFFBEB; border-radius: 8px; margin-top: 20px;";
                devForm.innerHTML = `
                    <h3 style="color: #92400E; margin-top: 0;">🛠️ DEV MODE: Generate Test Certificate</h3>
                    <p style="font-size: 13px; color: #B45309;">This form is only visible to Super Admins. Certificates generated here are NOT saved to the database.</p>
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #4B5563;">Test Student Name</label>
                        <input type="text" id="devName" placeholder="Enter name" style="width: 100%; padding: 10px; border: 1px solid #D1D5DB; border-radius: 6px;">
                    </div>
                    <button id="devGenerateBtn" class="btn-download-cert" style="background: #F59E0B; width: 100%;">Generate Test PDF</button>
                `;
                container.appendChild(devForm);
                
                document.getElementById('devGenerateBtn').addEventListener('click', () => {
                    const name = document.getElementById('devName').value.trim() || "Test User";
                    const fakeId = `PUB-TEST-${Date.now()}`;
                    generatePdf({ fullName: name, issuedAt: Date.now() }, fakeId);
                });
            }
        } else {
            loadingState.style.display = 'none';
            errorState.style.display = 'block';
            errorState.querySelector('p').textContent = "A valid certificate link is required. Please use the link sent to your email.";
        }
        return;
    }

    let certificateData = null;

    try {
        console.log('[Generic Cert] Fetching via public API:', `/api/public/certificate/${certId}`);
        const response = await fetch(`/api/public/certificate/${certId}`);
        const result = await response.json();
        
        if (result.success) {
            certificateData = result.data;
        } else {
            certificateData = null;
        }
        
        console.log('[Generic Cert] Data:', certificateData);

        loadingState.style.display = 'none';

        if (certificateData && certificateData.type === 'game_generic' && certificateData.status === 'valid') {
            // Valid
            document.getElementById('certName').textContent = certificateData.fullName;
            document.getElementById('certIdDisplay').textContent = certId;
            validState.style.display = 'block';
        } else {
            // Invalid
            errorState.style.display = 'block';
            errorState.querySelector('p').textContent = "Certificate not found or invalid.";
        }
    } catch (error) {
        console.error("Fetch error:", error);
        loadingState.style.display = 'none';
        errorState.style.display = 'block';
        errorState.querySelector('p').textContent = "An error occurred while retrieving certificate details.";
    }

    // Helper function to generate PDF
    const generatePdf = (data, cId) => {
        const btn = document.getElementById('downloadBtn') || document.getElementById('devGenerateBtn');
        const originalText = btn ? btn.textContent : 'Download';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="loading-spinner"></span> Generating...';
        }

        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({
                orientation: 'landscape',
                unit: 'px',
                format: [842, 595]
            });

            const img = new Image();
            img.src = '/certificates/Generic-Certificate.png';
            img.src += '?t=' + new Date().getTime();
            img.crossOrigin = "Anonymous";
            
            img.onload = () => {
                const width = doc.internal.pageSize.getWidth();
                const height = doc.internal.pageSize.getHeight();
                
                doc.addImage(img, 'PNG', 0, 0, width, height);

                // Text Config
                doc.setTextColor(50, 50, 50);
                
                // Name - Centered
                doc.setFontSize(50);
                doc.setFont("helvetica", "bold");
                doc.text(data.fullName, width / 2, 285, { align: 'center' });

                // Date & ID
                doc.setFontSize(20);
                doc.setFont("helvetica", "normal");
                const issueDate = new Date(data.issuedAt);
                const dateStr = issueDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                
                doc.text(dateStr, 415, 470); 
                doc.text(cId, 405, 495);

                // Add QR Code
                const verifyUrl = `https://asat-caresim.online/verify-certificate.html?certId=${cId}`;
                const qrContainer = document.createElement('div');
                new QRCode(qrContainer, {
                    text: verifyUrl,
                    width: 128,
                    height: 128,
                    colorDark : "#000000",
                    colorLight : "#ffffff",
                    correctLevel : QRCode.CorrectLevel.H
                });

                const qrImg = qrContainer.querySelector('img');
                
                const addQrAndSave = () => {
                    const qrDataUrl = qrImg.src;
                    // Place QR code at x=730, y=480, w=80, h=80
                    doc.addImage(qrDataUrl, 'PNG', 80, 440, 80, 80);
                    
                    doc.save(`CareSim-Certificate-${data.fullName.replace(/\s+/g, '_')}.pdf`);
                    
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = originalText;
                    }
                };

                if (qrImg && qrImg.src && qrImg.src.startsWith('data:')) {
                    addQrAndSave();
                } else if (qrImg) {
                    qrImg.onload = addQrAndSave;
                } else {
                    // Fallback
                    doc.save(`CareSim-Certificate-${data.fullName.replace(/\s+/g, '_')}.pdf`);
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = originalText;
                    }
                }
            };

            img.onerror = () => {
                alert('Failed to load certificate template.');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            };

        } catch (error) {
            console.error('Generation error:', error);
            alert('Failed to generate certificate.');
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }
    };

    // Download Handler
    if (downloadBtn) {
        downloadBtn.addEventListener('click', function() {
            if (!certificateData) return;
            generatePdf(certificateData, certId);
        });
    }
});
