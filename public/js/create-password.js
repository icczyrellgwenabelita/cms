// Create Password Flow for invited students

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

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

function getQueryParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

async function checkInviteStatus(email) {
    const res = await fetch(`/api/admin/users/invite-status?email=${encodeURIComponent(email)}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
        throw new Error(data.error || 'Invite invalid or expired');
    }
    return data;
}

async function completeInvite(email) {
    const res = await fetch('/api/admin/users/complete-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to complete invite');
    }
    return data;
}

document.addEventListener('DOMContentLoaded', async () => {
    const oobCode = getQueryParam('oobCode');
    const mode = getQueryParam('mode');
    const form = document.getElementById('createPasswordForm');
    const inviteMessage = document.getElementById('inviteMessage');
    const errorEl = document.getElementById('inviteError');
    const successEl = document.getElementById('inviteSuccess');

    if (!oobCode || mode !== 'resetPassword') {
        inviteMessage.textContent = 'This link is invalid.';
        return;
    }

    try {
        const email = await auth.verifyPasswordResetCode(oobCode);
        const invite = await checkInviteStatus(email);
        if (invite.inviteStatus !== 'pending') {
            inviteMessage.textContent = 'Your account is already set up. Please log in.';
            return;
        }
        const expiresAt = invite.inviteExpiresAt ? new Date(invite.inviteExpiresAt).getTime() : 0;
        if (expiresAt && Date.now() > expiresAt) {
            inviteMessage.textContent = 'This invite link has expired. Please contact your administrator to request a new invite.';
            return;
        }

        inviteMessage.textContent = `Setting password for ${email}`;
        form.style.display = 'block';

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorEl.style.display = 'none';
            successEl.style.display = 'none';

            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            if (!newPassword || newPassword.length < 8) {
                errorEl.textContent = 'Password must be at least 8 characters.';
                errorEl.style.display = 'block';
                return;
            }
            if (newPassword !== confirmPassword) {
                errorEl.textContent = 'Passwords do not match.';
                errorEl.style.display = 'block';
                return;
            }

            try {
                await auth.confirmPasswordReset(oobCode, newPassword);
                await completeInvite(email);
                successEl.textContent = 'Password set successfully. You can now log in.';
                successEl.style.display = 'block';
                form.style.display = 'none';
            } catch (err) {
                console.error('Complete invite error:', err);
                errorEl.textContent = err.message || 'Failed to set password.';
                errorEl.style.display = 'block';
            }
        }, { once: true });
    } catch (err) {
        console.error('Invite validation error:', err);
        inviteMessage.textContent = 'This link has expired or is invalid.';
    }
});










