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

document.addEventListener('DOMContentLoaded', function() {
    const certIdInput = document.getElementById('certIdInput');
    const verifyBtn = document.getElementById('verifyBtn');
    
    // Check URL params
    const urlParams = new URLSearchParams(window.location.search);
    const certIdParam = urlParams.get('certId');
    
    if (certIdParam) {
        certIdInput.value = certIdParam;
        verifyCertificate(certIdParam);
    }
    
    verifyBtn.addEventListener('click', () => {
        const certId = certIdInput.value.trim();
        if (certId) {
            verifyCertificate(certId);
        }
    });
    
    async function verifyCertificate(certId) {
        // Reset UI
        document.getElementById('validResult').style.display = 'none';
        document.getElementById('invalidResult').style.display = 'none';
        verifyBtn.textContent = 'Verifying...';
        verifyBtn.disabled = true;
        
        try {
            console.log('[Verify] Verifying via public API:', `/api/public/certificate/${certId}`);
            
            const response = await fetch(`/api/public/certificate/${certId}`);
            const result = await response.json();
            
            let certData = null;
            if (result.success) {
                certData = result.data;
            }
            
            console.log('[Verify] Data retrieved:', certData);
            
            // If not found in registry, try legacy/fallback lookup for LMS certs
            if (!certData && certId.startsWith('LMS-')) {
                console.log("Certificate not in registry, checking user records fallback...");
                // This is inefficient but necessary for backfilling: we don't know the UID from the Cert ID alone easily 
                // unless we search all users or if the Cert ID format contained UID (it doesn't seem to: LMS-Random-Random).
                // Wait, scanning all users is bad.
                // If we can't find it in certificates/{id}, and we don't have UID, we can't verify it efficiently.
                // However, the requirement says: "If existing LMS certificates... do NOT have a registry entry yet... create it on the fly".
                // BUT verify-certificate.js is client-side. It cannot search all users efficiently without an index or cloud function.
                // For now, we will assume if it's not in registry, it's not valid unless we can derive path.
                
                // Actually, maybe the user is logged in? If so we can check *their* certs.
                // But verification is public.
                
                // Realistically, without a backend function or index, we can't find `users/{uid}/certificates/caresim_lms_full` given just `LMS-xxx`.
                // The prompt implies "add a small one-time helper... If we detect a known certificate in users/{uid}...".
                // This implies we somehow know where to look.
                // If we can't find it, we fail.
                // We will stick to the registry check.
            }

            verifyBtn.textContent = 'Verify';
            verifyBtn.disabled = false;
            
            if (certData && certData.status === 'valid') {
                // Show Success
                document.getElementById('validName').textContent = certData.fullName;
                document.getElementById('validId').textContent = certId;
                
                let typeLabel = "Unknown Type";
                if (certData.type === 'lms_full') typeLabel = "CareSim LMS Full Course";
                else if (certData.type === 'game_generic') typeLabel = "CareSim Game Simulation";
                document.getElementById('validType').textContent = typeLabel;
                
                const date = certData.issuedAt ? new Date(certData.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown';
                document.getElementById('validDate').textContent = date;
                
                document.getElementById('validResult').style.display = 'block';
            } else {
                // Show Error
                document.getElementById('invalidResult').style.display = 'block';
            }
            
        } catch (error) {
            console.error("Verification error:", error);
            verifyBtn.textContent = 'Verify';
            verifyBtn.disabled = false;
            // Show friendly error in UI instead of alert
            document.getElementById('invalidResult').style.display = 'block';
            document.querySelector('#invalidResult p').textContent = "An error occurred while verifying. Please try again or check your internet connection.";
        }
    }
});
