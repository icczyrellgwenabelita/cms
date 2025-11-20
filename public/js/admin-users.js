// Admin Users Management - API Integration
const adminToken = localStorage.getItem('adminToken');

if (!adminToken) {
    window.location.href = '/admin-login';
}

let allUsers = [];
let allInstructors = [];
let currentRoleTab = 'students';
let currentEditUserId = null;

// API Base URL
const API_BASE = '/api/admin';

// Error message container
let errorMessageContainer = null;

// Initialize error message container
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
            if (errorMessageContainer) {
                errorMessageContainer.style.display = 'none';
            }
        }, 5000);
    } else {
        console.error('Error:', message);
        alert(message);
    }
}

function showSuccess(message) {
    showAlertModal(message, 'Success');
}

// Load all instructors from API
async function loadInstructors() {
    try {
        const response = await fetch(`${API_BASE}/instructors`, {
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
            console.error('Failed to fetch instructors');
            return;
        }

        const data = await response.json();
        if (data.success && data.instructors) {
            allInstructors = data.instructors || [];
        }
    } catch (error) {
        console.error('Load instructors error:', error);
    }
}

// Load all users from API
async function loadUsers() {
    try {
        // Show loading state
        const tbodyElements = ['studentsTableBody', 'instructorsTableBody', 'adminsTableBody', 'publicTableBody'];
        tbodyElements.forEach(id => {
            const tbody = document.getElementById(id);
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 40px; color: #64748B;">Loading users...</td></tr>';
            }
        });

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
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to fetch users');
        }

        const data = await response.json();
        if (!data.success || !data.users) {
            throw new Error('Invalid response from server');
        }

        allUsers = data.users || [];
        renderUsers();
    } catch (error) {
        console.error('Load users error:', error);
        showError(error.message || 'Failed to load users');
        
        // Show empty state
        const tbodyElements = ['studentsTableBody', 'instructorsTableBody', 'adminsTableBody', 'publicTableBody'];
        tbodyElements.forEach(id => {
            const tbody = document.getElementById(id);
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 40px; color: #64748B;">No users found</td></tr>';
            }
        });
    }
}

// Render users based on current tab and filters
function renderUsers() {
    const searchName = document.getElementById('searchName')?.value.toLowerCase() || '';
    const searchEmail = document.getElementById('searchEmail')?.value.toLowerCase() || '';
    const filterStatus = document.getElementById('filterStatus')?.value || '';
    
    let filtered = allUsers.filter(user => {
        const matchesRole = 
            (currentRoleTab === 'students' && user.role === 'student') ||
            (currentRoleTab === 'instructors' && user.role === 'instructor') ||
            (currentRoleTab === 'admins' && user.role === 'admin') ||
            (currentRoleTab === 'public' && (!user.role || user.role === 'public'));
        
        const matchesName = !searchName || (user.name || '').toLowerCase().includes(searchName);
        const matchesEmail = !searchEmail || (user.email || '').toLowerCase().includes(searchEmail);
        const matchesStatus = !filterStatus || 
            (filterStatus === 'active' && user.active !== false) ||
            (filterStatus === 'deactivated' && user.active === false) ||
            (filterStatus === 'pending' && !user.verified);
        
        return matchesRole && matchesName && matchesEmail && matchesStatus;
    });

    // Sort
    const sortBy = document.getElementById('sortBy')?.value || 'newest';
    if (sortBy === 'newest') {
        filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else if (sortBy === 'oldest') {
        filtered.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    } else if (sortBy === 'name') {
        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    // Render based on current tab
    if (currentRoleTab === 'students') {
        renderStudentsTable(filtered);
    } else if (currentRoleTab === 'instructors') {
        renderInstructorsTable(filtered);
    } else if (currentRoleTab === 'admins') {
        renderAdminsTable(filtered);
    } else if (currentRoleTab === 'public') {
        renderPublicTable(filtered);
    }
}

function renderStudentsTable(students) {
    const tbody = document.getElementById('studentsTableBody');
    if (!tbody) return;

    if (students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: #64748B;">No students found</td></tr>';
        return;
    }

    tbody.innerHTML = students.map(user => {
        const studentInfo = user.studentInfo || {};
        const progress = user.progress || {};
        const lessonsCompleted = Object.values(progress).filter(p => p?.quiz?.completed).length || 0;
        const simulationsCompleted = Object.values(progress).filter(p => p?.simulation?.completed).length || 0;
        
        // Find assigned instructor name
        const assignedInstructorId = user.assignedInstructor || '';
        const assignedInstructor = allInstructors.find(inst => inst.id === assignedInstructorId);
        const instructorName = assignedInstructor ? assignedInstructor.name : (assignedInstructorId ? 'Unknown' : 'Not Assigned');
        
        return `
            <tr data-uid="${user.uid}">
                <td><a href="#" onclick="showUserDetails('${user.uid}'); return false;" class="user-name-link">${user.name || 'N/A'}</a></td>
                <td>${user.email || 'N/A'}</td>
                <td>${studentInfo.studentNumber || 'N/A'}</td>
                <td>${studentInfo.batch || 'N/A'}</td>
                <td>
                    <span class="instructor-badge">${instructorName}</span>
                    ${assignedInstructorId ? `<button class="btn-action btn-assign-small" onclick="assignInstructor('${user.uid}')" title="Change Instructor">
                        <i class="fas fa-user-edit"></i>
                    </button>` : `<button class="btn-action btn-assign-small" onclick="assignInstructor('${user.uid}')" title="Assign Instructor">
                        <i class="fas fa-user-plus"></i>
                    </button>`}
                </td>
                <td>
                    <label class="status-toggle">
                        <input type="checkbox" ${user.active !== false ? 'checked' : ''} 
                               onchange="toggleUserActive('${user.uid}', this.checked)">
                        <span class="status-badge status-${user.active !== false ? 'active' : 'deactivated'}">
                            ${user.active !== false ? 'Active' : 'Deactivated'}
                        </span>
                    </label>
                </td>
                <td>${user.lastLogin || 'Never'}</td>
                <td>
                    <div class="progress-indicator">
                        <div class="progress-bar-small">
                            <div class="progress-fill-small" style="width: ${Math.round((lessonsCompleted / 6) * 100)}%"></div>
                        </div>
                        <span>${lessonsCompleted}/6</span>
                    </div>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action btn-edit-small" onclick="editUser('${user.uid}')" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-action btn-disable-small" onclick="toggleUserActive('${user.uid}', ${user.active !== false ? 'false' : 'true'})" 
                                title="${user.active !== false ? 'Disable' : 'Enable'}">
                            <i class="fas fa-${user.active !== false ? 'ban' : 'check-circle'}"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderInstructorsTable(instructors) {
    const tbody = document.getElementById('instructorsTableBody');
    if (!tbody) return;

    if (instructors.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #64748B;">No instructors found</td></tr>';
        return;
    }

    tbody.innerHTML = instructors.map(user => {
        // Note: Instructors are stored in admins/ collection, but we're showing users with role=instructor
        // For now, we'll show basic info. You may need to fetch from admins/ separately if needed.
        return `
            <tr data-uid="${user.uid}">
                <td><a href="#" onclick="showUserDetails('${user.uid}'); return false;" class="user-name-link">${user.name || 'N/A'}</a></td>
                <td>${user.email || 'N/A'}</td>
                <td>N/A</td>
                <td>
                    <label class="status-toggle">
                        <input type="checkbox" ${user.active !== false ? 'checked' : ''} 
                               onchange="toggleUserActive('${user.uid}', this.checked)">
                        <span class="status-badge status-${user.active !== false ? 'active' : 'deactivated'}">
                            ${user.active !== false ? 'Active' : 'Deactivated'}
                        </span>
                    </label>
                </td>
                <td>0</td>
                <td>${user.lastLogin || 'Never'}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action btn-edit-small" onclick="editUser('${user.uid}')" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-action btn-disable-small" onclick="toggleUserActive('${user.uid}', ${user.active !== false ? 'false' : 'true'})" 
                                title="${user.active !== false ? 'Disable' : 'Enable'}">
                            <i class="fas fa-${user.active !== false ? 'ban' : 'check-circle'}"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderAdminsTable(admins) {
    const tbody = document.getElementById('adminsTableBody');
    if (!tbody) return;

    if (admins.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px; color: #64748B;">No admins found</td></tr>';
        return;
    }

    tbody.innerHTML = admins.map(user => `
        <tr data-uid="${user.uid}">
            <td><a href="#" onclick="showUserDetails('${user.uid}'); return false;" class="user-name-link">${user.name || 'N/A'}</a></td>
            <td>${user.email || 'N/A'}</td>
            <td>System</td>
            <td>
                <label class="status-toggle">
                    <input type="checkbox" ${user.active !== false ? 'checked' : ''} 
                           onchange="toggleUserActive('${user.uid}', this.checked)">
                    <span class="status-badge status-${user.active !== false ? 'active' : 'deactivated'}">
                        ${user.active !== false ? 'Active' : 'Deactivated'}
                    </span>
                </label>
            </td>
            <td>${user.lastLogin || 'Never'}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-action btn-edit-small" onclick="editUser('${user.uid}')" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-action btn-disable-small" onclick="toggleUserActive('${user.uid}', ${user.active !== false ? 'false' : 'true'})" 
                            title="${user.active !== false ? 'Disable' : 'Enable'}">
                        <i class="fas fa-${user.active !== false ? 'ban' : 'check-circle'}"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderPublicTable(publicUsers) {
    const tbody = document.getElementById('publicTableBody');
    if (!tbody) return;

    if (publicUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px; color: #64748B;">No public users found</td></tr>';
        return;
    }

    tbody.innerHTML = publicUsers.map(user => `
        <tr data-uid="${user.uid}">
            <td><a href="#" onclick="showUserDetails('${user.uid}'); return false;" class="user-name-link">${user.name || 'N/A'}</a></td>
            <td>${user.email || 'N/A'}</td>
            <td>${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</td>
            <td>${user.role === 'student' ? '<i class="fas fa-check-circle" style="color: #10B981;"></i> Yes' : '<i class="fas fa-times-circle" style="color: #EF4444;"></i> No'}</td>
            <td>
                <label class="status-toggle">
                    <input type="checkbox" ${user.active !== false ? 'checked' : ''} 
                           onchange="toggleUserActive('${user.uid}', this.checked)">
                    <span class="status-badge status-${user.active !== false ? 'active' : 'deactivated'}">
                        ${user.active !== false ? 'Active' : 'Deactivated'}
                    </span>
                </label>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn-action btn-edit-small" onclick="editUser('${user.uid}')" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-action btn-disable-small" onclick="toggleUserActive('${user.uid}', ${user.active !== false ? 'false' : 'true'})" 
                            title="${user.active !== false ? 'Disable' : 'Enable'}">
                        <i class="fas fa-${user.active !== false ? 'ban' : 'check-circle'}"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Role Tab Management
function switchRoleTab(role) {
    currentRoleTab = role;
    
    document.querySelectorAll('.user-role-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    const tabId = `tab${role.charAt(0).toUpperCase() + role.slice(1)}`;
    const tabElement = document.getElementById(tabId);
    if (tabElement) {
        tabElement.classList.add('active');
    }
    
    document.querySelectorAll('.role-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    const contentElement = document.getElementById(`${role}Tab`);
    if (contentElement) {
        contentElement.classList.add('active');
    }
    
    renderUsers();
}

// Toggle user active status
async function toggleUserActive(uid, newStatus) {
    try {
        const response = await fetch(`${API_BASE}/users/${uid}/status`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ active: newStatus })
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to update user status');
        }

        const data = await response.json();
        if (data.success) {
            showSuccess(`User ${newStatus ? 'activated' : 'deactivated'} successfully`);
            await loadUsers();
        }
    } catch (error) {
        console.error('Toggle user active error:', error);
        showError(error.message || 'Failed to update user status');
    }
}

// Create instructor
async function createInstructor(event) {
    event.preventDefault();
    
    const name = document.getElementById('addUserName').value.trim();
    const email = document.getElementById('addUserEmail').value.trim();
    const password = document.getElementById('addUserPassword').value;
    const department = document.getElementById('addInstructorDepartment')?.value.trim() || '';
    const idNumber = document.getElementById('addInstructorIdNumber')?.value.trim() || '';

    if (!name || !email || !password) {
        showError('Name, email, and password are required');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/users/create-instructor`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, email, password, department, idNumber })
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to create instructor');
        }

        const data = await response.json();
        if (data.success) {
            showSuccess('Instructor created successfully');
            closeAddUserModal();
            await loadUsers();
        }
    } catch (error) {
        console.error('Create instructor error:', error);
        showError(error.message || 'Failed to create instructor');
    }
}

// Edit user
async function editUser(uid) {
    currentEditUserId = uid;
    const user = allUsers.find(u => u.uid === uid);
    if (!user) {
        showError('User not found');
        return;
    }
    
    document.querySelector('.portal-container').style.display = 'none';
    document.getElementById('editUserPage').style.display = 'block';
    
    document.getElementById('editUserId').value = uid;
    document.getElementById('editUserName').value = user.name || '';
    document.getElementById('editUserEmail').value = user.email || '';
    document.getElementById('editUserRole').value = user.role || 'public';
    document.getElementById('editUserStatus').value = user.active !== false ? 'active' : 'deactivated';
    document.getElementById('editUserPhone').value = user.studentInfo?.contactNumber || user.contactNumber || '';
    document.getElementById('editUserBirthday').value = user.studentInfo?.birthday || user.birthday || '';
    document.getElementById('editUserAddress').value = user.studentInfo?.address || user.address || '';
    
    if (user.role === 'student' && user.studentInfo) {
        document.getElementById('editStudentNumber').value = user.studentInfo.studentNumber || '';
        document.getElementById('editBatch').value = user.studentInfo.batch || '';
    }
    
    // Populate instructor dropdown
    const instructorSelect = document.getElementById('editAssignedInstructor');
    if (instructorSelect) {
        instructorSelect.innerHTML = '<option value="">-- No Instructor Assigned --</option>' +
            allInstructors.map(inst => 
                `<option value="${inst.id}" ${user.assignedInstructor === inst.id ? 'selected' : ''}>${inst.name} (${inst.email})</option>`
            ).join('');
    }
    
    toggleEditRoleFields();
    document.getElementById('editPageTitle').textContent = `Edit User: ${user.name || 'Unknown'}`;
}

function toggleEditRoleFields() {
    const role = document.getElementById('editUserRole')?.value || '';
    const studentFields = document.getElementById('editStudentFields');
    const instructorFields = document.getElementById('editInstructorFields');
    
    if (studentFields) {
        studentFields.style.display = role === 'student' ? 'block' : 'none';
    }
    if (instructorFields) {
        instructorFields.style.display = role === 'instructor' ? 'block' : 'none';
    }
}

function closeEditUserPage() {
    document.getElementById('editUserPage').style.display = 'none';
    document.querySelector('.portal-container').style.display = 'block';
    currentEditUserId = null;
}

async function saveUserEdit(event) {
    event.preventDefault();
    
    const uid = document.getElementById('editUserId').value;
    if (!uid) {
        showError('User ID is missing');
        return;
    }

    const updateData = {};
    const existingUser = allUsers.find(u => u.uid === uid) || {};
    const name = document.getElementById('editUserName').value.trim();
    const email = document.getElementById('editUserEmail').value.trim();
    const role = document.getElementById('editUserRole')?.value;
    const status = document.getElementById('editUserStatus')?.value;
    const phoneInput = document.getElementById('editUserPhone');
    const phone = phoneInput ? phoneInput.value.trim() : undefined;
    const birthdayInput = document.getElementById('editUserBirthday');
    const birthday = birthdayInput ? birthdayInput.value : undefined;
    const addressInput = document.getElementById('editUserAddress');
    const address = addressInput ? addressInput.value.trim() : undefined;
    const assignedInstructorSelect = document.getElementById('editAssignedInstructor');
    const assignedInstructorValue = assignedInstructorSelect ? assignedInstructorSelect.value : undefined;

    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (role) updateData.role = role;
    if (status !== undefined) updateData.active = status === 'active';

    if (phone !== undefined) {
        updateData.contactNumber = phone;
    }
    if (address !== undefined) {
        updateData.address = address;
    }
    if (birthday !== undefined) {
        updateData.birthday = birthday;
    }

    if (role === 'student') {
        const studentNumberInput = document.getElementById('editStudentNumber');
        const batchInput = document.getElementById('editBatch');
        const studentNumber = studentNumberInput ? studentNumberInput.value.trim() : undefined;
        const batch = batchInput ? batchInput.value.trim() : undefined;
        const existingStudentInfo = existingUser.studentInfo || {};
        const updatedStudentInfo = { ...existingStudentInfo };

        if (studentNumber !== undefined) {
            updatedStudentInfo.studentNumber = studentNumber;
        }
        if (batch !== undefined) {
            updatedStudentInfo.batch = batch;
        }
        if (phone !== undefined) {
            updatedStudentInfo.contactNumber = phone;
        }
        if (address !== undefined) {
            updatedStudentInfo.address = address;
        }
        if (birthday !== undefined) {
            updatedStudentInfo.birthday = birthday;
        }

        updateData.studentInfo = updatedStudentInfo;
    }

    if (Object.keys(updateData).length === 0) {
        showError('No fields to update');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/users/${uid}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to update user');
        }

        const data = await response.json();
        if (data.success) {
            if (role === 'student' && assignedInstructorValue !== undefined) {
                const assignmentResult = await assignInstructorToStudent(uid, assignedInstructorValue);
                if (!assignmentResult) {
                    return;
                }
            }

            showSuccess('User updated successfully');
            closeEditUserPage();
            await loadUsers();
        }
    } catch (error) {
        console.error('Save user edit error:', error);
        showError(error.message || 'Failed to update user');
    }
}

async function assignInstructorToStudent(uid, instructorId) {
    try {
        const response = await fetch(`${API_BASE}/users/${uid}/assign-instructor`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ instructorId: instructorId || '' })
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return false;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to assign instructor');
        }

        return true;
    } catch (error) {
        console.error('Assign instructor error:', error);
        showError(error.message || 'Failed to assign instructor');
        return false;
    }
}

// Add User Modal functions
function openAddUserModal() {
    document.getElementById('addUserModal').style.display = 'flex';
    document.getElementById('addUserForm').reset();
    document.getElementById('studentFields').style.display = 'none';
    document.getElementById('instructorFields').style.display = 'none';
}

function closeAddUserModal() {
    document.getElementById('addUserModal').style.display = 'none';
}

function toggleRoleFields() {
    const role = document.getElementById('addUserRole')?.value;
    const studentFields = document.getElementById('studentFields');
    const instructorFields = document.getElementById('instructorFields');
    
    if (studentFields) {
        studentFields.style.display = role === 'student' ? 'block' : 'none';
    }
    if (instructorFields) {
        instructorFields.style.display = role === 'instructor' ? 'block' : 'none';
    }
}

function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    const icon = button.querySelector('i');
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

function generatePassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    document.getElementById('addUserPassword').value = password;
}

async function createAdmin(event) {
    event.preventDefault();
    
    const name = document.getElementById('addUserName').value.trim();
    const email = document.getElementById('addUserEmail').value.trim();
    const password = document.getElementById('addUserPassword').value;

    if (!name || !email || !password) {
        showError('Name, email, and password are required');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/users/create-admin`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, email, password })
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to create admin');
        }

        const data = await response.json();
        if (data.success) {
            showSuccess('Admin created successfully');
            closeAddUserModal();
            await loadUsers();
        }
    } catch (error) {
        console.error('Create admin error:', error);
        showError(error.message || 'Failed to create admin');
    }
}

function saveNewUser(event) {
    event.preventDefault();
    const role = document.getElementById('addUserRole')?.value;
    
    if (role === 'instructor') {
        createInstructor(event);
    } else if (role === 'admin') {
        createAdmin(event);
    } else {
        showError('Only instructor and admin creation are currently supported via API');
    }
}

// User Details Popup
function showUserDetails(uid) {
    const user = allUsers.find(u => u.uid === uid);
    if (!user) {
        showError('User not found');
        return;
    }
    
    document.getElementById('userDetailsName').textContent = user.name || 'N/A';
    document.getElementById('userDetailsEmail').textContent = user.email || 'N/A';
    document.getElementById('userDetailsRole').innerHTML = `<span class="role-badge role-${user.role || 'public'}">${user.role || 'public'}</span>`;
    document.getElementById('userDetailsStatus').innerHTML = `<span class="status-badge status-${user.active !== false ? 'active' : 'deactivated'}">${user.active !== false ? 'Active' : 'Deactivated'}</span>`;
    document.getElementById('userDetailsLastLogin').textContent = user.lastLogin || 'Never';
    document.getElementById('userDetailsCreated').textContent = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A';
    
    currentEditUserId = uid;
    document.getElementById('userDetailsPopup').style.display = 'flex';
}

function closeUserDetailsPopup() {
    document.getElementById('userDetailsPopup').style.display = 'none';
}

function editUserFromPopup() {
    closeUserDetailsPopup();
    if (currentEditUserId) {
        editUser(currentEditUserId);
    }
}

// Utility functions
function logout() {
    document.getElementById('logoutModal').style.display = 'flex';
}

function closeLogoutModal() {
    document.getElementById('logoutModal').style.display = 'none';
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

// Assign instructor to student
async function assignInstructor(uid) {
    const user = allUsers.find(u => u.uid === uid);
    if (!user || user.role !== 'student') {
        showError('Student not found');
        return;
    }
    
    // Create a simple modal for instructor selection
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';
    modal.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 12px; max-width: 500px; width: 90%;">
            <h2 style="margin: 0 0 20px 0;">Assign Instructor</h2>
            <p style="margin: 0 0 15px 0; color: #64748B;">Select an instructor for ${user.name || 'this student'}:</p>
            <select id="assignInstructorSelect" style="width: 100%; padding: 10px; margin-bottom: 20px; border: 2px solid #E2E8F0; border-radius: 8px; font-size: 14px;">
                <option value="">-- No Instructor --</option>
                ${allInstructors.map(inst => 
                    `<option value="${inst.id}" ${user.assignedInstructor === inst.id ? 'selected' : ''}>${inst.name} (${inst.email})</option>`
                ).join('')}
            </select>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button onclick="this.closest('div[style*=\"position: fixed\"]').remove()" style="padding: 10px 20px; border: 1px solid #E2E8F0; background: white; border-radius: 8px; cursor: pointer;">Cancel</button>
                <button onclick="confirmAssignInstructor('${uid}')" style="padding: 10px 20px; background: #556B2F; color: white; border: none; border-radius: 8px; cursor: pointer;">Assign</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Store modal reference for cleanup
    window.currentAssignModal = modal;
}

async function confirmAssignInstructor(uid) {
    const select = document.getElementById('assignInstructorSelect');
    const instructorId = select?.value || '';
    
    try {
        if (instructorId) {
            const response = await fetch(`${API_BASE}/users/${uid}/assign-instructor`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ instructorId })
            });

            if (response.status === 401 || response.status === 403) {
                localStorage.removeItem('adminToken');
                window.location.href = '/admin-login';
                return;
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to assign instructor');
            }

            const data = await response.json();
            if (data.success) {
                showSuccess('Instructor assigned successfully');
                if (window.currentAssignModal) {
                    window.currentAssignModal.remove();
                    window.currentAssignModal = null;
                }
                await loadUsers();
            }
        } else {
            // Remove instructor assignment
            const user = allUsers.find(u => u.uid === uid);
            if (user && user.assignedInstructor) {
                // Update user to remove assignedInstructor
                const response = await fetch(`${API_BASE}/users/${uid}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${adminToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ assignedInstructor: null })
                });

                if (response.ok) {
                    showSuccess('Instructor assignment removed');
                    if (window.currentAssignModal) {
                        window.currentAssignModal.remove();
                        window.currentAssignModal = null;
                    }
                    await loadUsers();
                }
            } else {
                if (window.currentAssignModal) {
                    window.currentAssignModal.remove();
                    window.currentAssignModal = null;
                }
            }
        }
    } catch (error) {
        console.error('Assign instructor error:', error);
        showError(error.message || 'Failed to assign instructor');
    }
}

// Modal close on outside click
window.onclick = function(event) {
    const modals = ['logoutModal', 'addUserModal', 'alertModal', 'userDetailsPopup'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (event.target === modal) {
            if (modalId === 'logoutModal') closeLogoutModal();
            else if (modalId === 'addUserModal') closeAddUserModal();
            else if (modalId === 'alertModal') closeAlertModal();
            else if (modalId === 'userDetailsPopup') closeUserDetailsPopup();
        }
    });
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', async function() {
    initErrorMessageContainer();
    
    // Add event listeners for search and filters
    const searchName = document.getElementById('searchName');
    const searchEmail = document.getElementById('searchEmail');
    const filterStatus = document.getElementById('filterStatus');
    const sortBy = document.getElementById('sortBy');
    
    if (searchName) searchName.addEventListener('input', renderUsers);
    if (searchEmail) searchEmail.addEventListener('input', renderUsers);
    if (filterStatus) filterStatus.addEventListener('change', renderUsers);
    if (sortBy) sortBy.addEventListener('change', renderUsers);
    
    // Load instructors and users on page load
    await loadInstructors();
    await loadUsers();
});



