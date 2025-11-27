// Admin Users Management - API Integration
const adminToken = localStorage.getItem('adminToken');

if (!adminToken) {
    window.location.href = '/admin-login';
}

let allUsers = [];
let allInstructors = [];
let currentRoleTab = 'students';
let currentEditUserId = null;
let currentModalRole = 'student';
let isBulkMode = false;
let pendingArchiveUid = null;

const PAGE_SIZE = 20;
const paginationState = {
    students: { page: 1 },
    instructors: { page: 1 },
    admins: { page: 1 },
    public: { page: 1 },
    archived: { page: 1 }
};

const ROLE_TAB_MAP = {
    students: 'student',
    instructors: 'instructor',
    admins: 'admin',
    public: 'public',
    archived: 'student'
};

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

function getPaginationState(tab) {
    if (!paginationState[tab]) {
        paginationState[tab] = { page: 1 };
    }
    return paginationState[tab];
}

function resetPagination(tab) {
    const state = getPaginationState(tab);
    state.page = 1;
}

function paginateList(list, tab) {
    const state = getPaginationState(tab);
    const totalItems = list.length;

    if (totalItems === 0) {
        state.page = 1;
        return {
            items: [],
            page: 1,
            totalPages: 1,
            totalItems: 0
        };
    }

    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;

    const start = (state.page - 1) * PAGE_SIZE;
    return {
        items: list.slice(start, start + PAGE_SIZE),
        page: state.page,
        totalPages,
        totalItems
    };
}

function updatePaginationControls(tab, page, totalPages, totalItems) {
    const info = document.getElementById(`${tab}PageInfo`);
    const prevBtn = document.getElementById(`${tab}PrevBtn`);
    const nextBtn = document.getElementById(`${tab}NextBtn`);

    if (info) {
        if (totalItems === 0) {
            info.textContent = 'Page 0 of 0';
        } else {
            info.textContent = `Page ${page} of ${totalPages}`;
        }
    }

    if (prevBtn) {
        prevBtn.disabled = totalItems === 0 || page <= 1;
    }

    if (nextBtn) {
        nextBtn.disabled = totalItems === 0 || page >= totalPages;
    }
}

function changePage(tab, direction) {
    const state = getPaginationState(tab);
    state.page += direction;
    if (state.page < 1) state.page = 1;
    if (tab === currentRoleTab) {
        renderUsers();
    }
}

function capitalizeName(name) {
    if (!name) return '';
    return name.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

function validateEmail(email) {
    return String(email).toLowerCase().match(/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/);
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildDetailRow(label, value, options = {}) {
    const hasValue = value !== null && value !== undefined && value !== '';
    const displayValue = hasValue ? value : 'N/A';
    const safeValue = options.allowHtml ? displayValue : escapeHtml(displayValue);
    return `
        <div class="detail-item">
            <span class="detail-label">${escapeHtml(label)}</span>
            <span>${safeValue}</span>
        </div>
    `;
}

function formatContactNumber(value) {
    if (!value) return 'N/A';
    const digits = String(value).replace(/\D/g, '');
    if (digits.length === 10) {
        return `+63 ${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('0')) {
        return `+63 ${digits.slice(1)}`;
    }
    if (digits.length === 12 && digits.startsWith('63')) {
        return `+${digits}`;
    }
    return value;
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
            allInstructors = (data.instructors || []).filter(inst => (inst.role || 'instructor') === 'instructor');
        }
    } catch (error) {
        console.error('Load instructors error:', error);
    }
}

// Load all users from API
async function loadUsers() {
    try {
        // Show loading state
        const tbodyElements = ['studentsTableBody', 'archivedTableBody', 'instructorsTableBody', 'adminsTableBody', 'publicTableBody'];
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
        allInstructors = allUsers
            .filter(user => user.role === 'instructor')
            .map(user => ({
                id: user.uid,
                name: user.name || user.email || 'Instructor',
                email: user.email || '',
                role: 'instructor',
                department: user.department || ''
            }));
        renderUsers();
    } catch (error) {
        console.error('Load users error:', error);
        showError(error.message || 'Failed to load users');
        
        // Show empty state
        const tbodyElements = ['studentsTableBody', 'archivedTableBody', 'instructorsTableBody', 'adminsTableBody', 'publicTableBody'];
        tbodyElements.forEach(id => {
            const tbody = document.getElementById(id);
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 40px; color: #64748B;">No users found</td></tr>';
            }
        });
    }
}

function filterUsersByTab(tab) {
    const searchTerm = (document.getElementById('searchBar')?.value || '').trim().toLowerCase();
    const batchFilter = document.getElementById('filterBatch')?.value || '';

    const list = allUsers.filter(user => {
        if (!isUserInCurrentTab(user, tab)) return false;

        if ((tab === 'students' || tab === 'archived') && batchFilter) {
            if ((user.studentInfo?.batch || '') !== batchFilter) return false;
        }

        if (searchTerm) {
            const haystack = [
                user.name,
                user.email,
                user.role,
                user.studentInfo?.studentNumber,
                user.studentInfo?.batch,
                user.department,
                user.contactNumber,
                user.assignedInstructor ? getInstructorName(user.assignedInstructor) : ''
            ]
                .filter(Boolean)
                .map(value => String(value).toLowerCase());

            const match = haystack.some(value => value.includes(searchTerm));
            if (!match) return false;
        }

        return true;
    });

    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// Render users based on current tab and filters
function renderUsers() {
    // Hide/Show filters based on tab
    const filterBatchEl = document.getElementById('filterBatch');
    const btnBulk = document.getElementById('btnBulkActions');
    
    if (currentRoleTab === 'students') {
        if (filterBatchEl) filterBatchEl.style.display = 'inline-block';
        if (btnBulk) btnBulk.style.display = 'inline-flex';
    } else {
        if (filterBatchEl) filterBatchEl.style.display = 'none';
        if (btnBulk) {
            btnBulk.style.display = 'none';
            // Exit bulk mode if leaving students tab
            if (isBulkMode) toggleBulkMode();
        }
    }

    const filtered = filterUsersByTab(currentRoleTab);
    const pagination = paginateList(filtered, currentRoleTab);

    if (currentRoleTab === 'students') {
        renderStudentsTable(pagination.items, pagination.totalItems);
    } else if (currentRoleTab === 'archived') {
        renderArchivedStudentsTable(pagination.items, pagination.totalItems);
    } else if (currentRoleTab === 'instructors') {
        renderInstructorsTable(pagination.items, pagination.totalItems);
    } else if (currentRoleTab === 'admins') {
        renderAdminsTable(pagination.items, pagination.totalItems);
    } else if (currentRoleTab === 'public') {
        renderPublicTable(pagination.items, pagination.totalItems);
    }

    updatePaginationControls(currentRoleTab, pagination.page, pagination.totalPages, pagination.totalItems);
}

function isUserInCurrentTab(user, tab = currentRoleTab) {
    if (!user) return false;
    switch (tab) {
        case 'students':
            return user.role === 'student' && !user.archived;
        case 'archived':
            return user.role === 'student' && !!user.archived;
        case 'instructors':
            return user.role === 'instructor';
        case 'admins':
            return user.role === 'admin';
        case 'public':
            return !user.role || user.role === 'public';
        default:
            return false;
    }
}

function renderStudentsTable(students, totalCount) {
    const tbody = document.getElementById('studentsTableBody');
    const selectAllCheckbox = document.getElementById('selectAllStudents');
    const checkboxHeader = document.querySelector('.col-checkbox');
    
    if (!tbody) return;

    // Handle Bulk Mode Visibility
    if (checkboxHeader) {
        checkboxHeader.style.display = isBulkMode ? 'table-cell' : 'none';
    }
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
    }

    if (!totalCount) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px; color:#64748B;">No students found</td></tr>';
        return;
    }
    if (!students.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px; color:#64748B;">No students on this page</td></tr>';
        return;
    }

    tbody.innerHTML = students.map(user => {
        const studentInfo = user.studentInfo || {};
        const instructorName = getInstructorName(user.assignedInstructor);
        
        // Status Logic: Verified vs Pending
        const isVerified = user.verified === true;
        const statusLabel = isVerified ? 'Verified' : 'Pending';
        const statusClass = isVerified ? 'status-verified' : 'status-pending';

        const showResend = !user.archived && !isVerified;
        const showAssign = !user.assignedInstructor && !isBulkMode;

        return `
            <tr data-uid="${user.uid}" onclick="handleRowClick(event, '${user.uid}')">
                <td class="col-checkbox" style="${isBulkMode ? 'display: table-cell;' : 'display: none;'}">
                    <input type="checkbox" class="student-select-checkbox" value="${user.uid}" onclick="event.stopPropagation();">
                </td>
                <td class="col-primary">${user.name || 'N/A'}</td>
                <td class="col-primary">${user.email || 'N/A'}</td>
                <td class="col-optional">${studentInfo.studentNumber || 'N/A'}</td>
                <td class="col-optional">${studentInfo.batch || 'N/A'}</td>
                <td class="col-optional">
                    <span class="instructor-badge">${instructorName}</span>
                    ${showAssign ? `
                    <button class="btn-action btn-assign-small" onclick="event.stopPropagation(); assignInstructor('${user.uid}')" title="Assign Instructor">
                        <i class="fas fa-user-plus"></i>
                    </button>` : ''}
                </td>
                <td class="col-primary"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                <td class="col-optional" style="text-align: right;">
                    <div class="action-buttons" style="justify-content: flex-end;" onclick="event.stopPropagation();">
                        <button class="btn-action btn-edit-small" onclick="editUser('${user.uid}')" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        ${showResend ? `
                            <button class="btn-action btn-resend-small" onclick="resendInvite('${user.uid}', this)" title="Resend Invite" style="background: #0D9488; color: white; border-color: #0D9488;">
                                <i class="fas fa-paper-plane"></i>
                            </button>` : ''}
                        <button class="btn-action btn-disable-small" onclick="archiveStudent('${user.uid}')" title="Archive Student">
                            <i class="fas fa-box-archive"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Bulk Actions Logic
function toggleBulkMode() {
    isBulkMode = !isBulkMode;
    const toolbar = document.getElementById('bulkActionsToolbar');
    const btn = document.getElementById('btnBulkActions');
    
    if (toolbar) toolbar.style.display = isBulkMode ? 'flex' : 'none';
    if (btn) {
        btn.innerHTML = isBulkMode ? '<i class="fas fa-times"></i> Cancel Selection' : '<i class="fas fa-list-check"></i> Select Students';
    }
    
    renderUsers(); // Re-render to show/hide checkboxes
}

function toggleSelectAll(source) {
    const checkboxes = document.querySelectorAll('.student-select-checkbox');
    checkboxes.forEach(cb => cb.checked = source.checked);
}

function getSelectedUids() {
    return Array.from(document.querySelectorAll('.student-select-checkbox:checked')).map(cb => cb.value);
}

function bulkAssignInstructor() {
    const selected = getSelectedUids();
    if (selected.length === 0) {
        showError('Please select at least one student.');
        return;
    }
    
    // Create modal for bulk assignment
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';
    modal.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 12px; max-width: 500px; width: 90%;">
            <h2 style="margin: 0 0 20px 0;">Assign Instructor to Selected</h2>
            <p style="margin: 0 0 15px 0; color: #64748B;">Select an instructor for <strong>${selected.length}</strong> student(s):</p>
            <select id="bulkAssignSelect" style="width: 100%; padding: 10px; margin-bottom: 20px; border: 2px solid #E2E8F0; border-radius: 8px; font-size: 14px;">
                <option value="">-- No Instructor (Unassign) --</option>
                ${allInstructors.map(inst => 
                    `<option value="${inst.id}">${inst.name} (${inst.email})</option>`
                ).join('')}
            </select>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button onclick="this.closest('div[style*=\"position: fixed\"]').remove()" style="padding: 10px 20px; border: 1px solid #E2E8F0; background: white; border-radius: 8px; cursor: pointer;">Cancel</button>
                <button id="btnConfirmBulkAssign" onclick="confirmBulkAssign()" style="padding: 10px 20px; background: #556B2F; color: white; border: none; border-radius: 8px; cursor: pointer;">Assign</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    window.currentBulkAssignModal = modal;
}

async function confirmBulkAssign() {
    const selected = getSelectedUids();
    const instructorId = document.getElementById('bulkAssignSelect').value;
    const btn = document.getElementById('btnConfirmBulkAssign');
    
    if (selected.length === 0) return;
    
    btn.disabled = true;
    btn.textContent = 'Assigning...';
    
    try {
        const response = await fetch(`${API_BASE}/users/assign-instructor-batch`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uids: selected, instructorId })
        });
        
        if (!response.ok) throw new Error('Batch assignment failed');
        
        const data = await response.json();
        showSuccess(`Updated ${data.count} student(s).`);
        
        if (window.currentBulkAssignModal) {
            window.currentBulkAssignModal.remove();
            window.currentBulkAssignModal = null;
        }
        
        toggleBulkMode(); // Exit bulk mode
        loadUsers();
    } catch (error) {
        console.error('Bulk assign error:', error);
        showError('Failed to assign instructor to selected students');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Assign';
        }
    }
}

function bulkArchiveStudents() {
    const selected = getSelectedUids();
    if (selected.length === 0) {
        showError('Please select at least one student.');
        return;
    }
    
    const modal = document.getElementById('bulkArchiveModal');
    const msg = document.getElementById('bulkArchiveMessage');
    if (modal && msg) {
        msg.textContent = `Are you sure you want to archive ${selected.length} selected students?`;
        modal.style.display = 'flex';
    }
}

function closeBulkArchiveModal() {
    document.getElementById('bulkArchiveModal').style.display = 'none';
}

async function confirmBulkArchive() {
    const selected = getSelectedUids();
    const btn = document.getElementById('confirmBulkArchiveBtn');
    
    if (selected.length === 0) return;
    
    btn.disabled = true;
    btn.textContent = 'Archiving...';
    
    try {
        const response = await fetch(`${API_BASE}/users/archive-batch`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uids: selected })
        });
        
        if (!response.ok) throw new Error('Batch archive failed');
        
        const data = await response.json();
        showSuccess(`Successfully archived ${data.count} student(s).`);
        
        closeBulkArchiveModal();
        toggleBulkMode(); // Exit bulk mode
        loadUsers();
    } catch (error) {
        console.error('Bulk archive error:', error);
        showError('Failed to archive selected students');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Archive';
        }
    }
}

function renderArchivedStudentsTable(students, totalCount) {
    const tbody = document.getElementById('archivedTableBody');
    if (!tbody) return;

    if (!totalCount) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:#64748B;">No archived students</td></tr>';
        return;
    }
    if (!students.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:#64748B;">No archived students on this page</td></tr>';
        return;
    }

    tbody.innerHTML = students.map(user => {
        const studentInfo = user.studentInfo || {};
        // For archived tab, we can just show "Archived" badge
        const statusClass = 'status-archived';
        const statusLabel = 'Archived';

        return `
            <tr data-uid="${user.uid}" onclick="handleRowClick(event, '${user.uid}')">
                <td class="col-primary">${user.name || 'N/A'}</td>
                <td class="col-primary">${user.email || 'N/A'}</td>
                <td class="col-optional">${studentInfo.studentNumber || 'N/A'}</td>
                <td class="col-optional">${studentInfo.batch || 'N/A'}</td>
                <td class="col-primary"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                <td class="col-optional">
                    <div class="action-buttons" onclick="event.stopPropagation();">
                        <button class="btn-action btn-edit-small" onclick="restoreStudent('${user.uid}')" title="Restore Student">
                            <i class="fas fa-undo"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function getInstructorName(instructorId) {
    if (!instructorId) return 'Not Assigned';
    const instructor = allInstructors.find(inst => inst.id === instructorId);
    if (!instructor) return 'Not Assigned';
    return instructor.name || instructor.email || 'Instructor';
}

function countAssignedStudents(instructorId) {
    if (!instructorId) return 0;
    return allUsers.filter(user => user.role === 'student' && !user.archived && user.assignedInstructor === instructorId).length;
}

function getStudentStatus(user) {
    // Legacy helper, kept for other views if needed, but renderStudentsTable has its own logic now
    if (user.archived) {
        return { key: 'archived', label: 'Archived', className: 'status-archived' };
    }
    if (user.verified) {
        return { key: 'verified', label: 'Verified', className: 'status-verified' };
    }
    return { key: 'pending', label: 'Pending', className: 'status-pending' };
}

function deriveStatusMeta(user) {
    if (!user) {
        return { label: 'Unknown', className: 'status-pending' };
    }
    if (user.role === 'student') {
        return user.verified
            ? { label: 'Verified', className: 'status-verified' }
            : { label: 'Pending', className: 'status-pending' };
    }
    return user.active !== false
        ? { label: 'Active', className: 'status-active' }
        : { label: 'Deactivated', className: 'status-deactivated' };
}

function formatDateTime(value) {
    if (!value) return 'Never';
    try {
        return new Date(value).toLocaleString();
    } catch (error) {
        return value;
    }
}

function formatDateDisplay(value, fallback = 'N/A') {
    if (!value) return fallback;
    try {
        return new Date(value).toLocaleString();
    } catch (error) {
        return value;
    }
}

function formatDateOnly(value, fallback = 'N/A') {
    if (!value) return fallback;
    try {
        return new Date(value).toLocaleDateString();
    } catch (error) {
        return value;
    }
}

function calculateLessonProgress(user) {
    // Kept if needed for other views, but removed from Students Table
    const progress = user.progress || {};
    const completed = Object.values(progress).filter(item => {
        if (!item) return false;
        if (item.completed) return true;
        if (typeof item.progress === 'number' && item.progress >= 100) return true;
        if (item.status && item.status.toLowerCase() === 'completed') return true;
        return false;
    }).length;
    const total = 6;
    const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    return { completed, total, percent };
}

function renderInstructorsTable(instructors, totalCount) {
    const tbody = document.getElementById('instructorsTableBody');
    if (!tbody) return;

    if (!totalCount) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #64748B;">No instructors found</td></tr>';
        return;
    }
    if (!instructors.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #64748B;">No instructors on this page</td></tr>';
        return;
    }

    tbody.innerHTML = instructors.map(user => {
        const department = user.department || 'N/A';
        const assignedCount = countAssignedStudents(user.uid);
        const statusClass = user.active !== false ? 'status-active' : 'status-deactivated';
        const statusLabel = user.active !== false ? 'Active' : 'Deactivated';
        return `
            <tr data-uid="${user.uid}" onclick="handleRowClick(event, '${user.uid}')">
                <td class="col-primary">${user.name || 'N/A'}</td>
                <td class="col-primary">${user.email || 'N/A'}</td>
                <td class="col-optional">${department}</td>
                <td class="col-primary">
                    <label class="status-toggle" onclick="event.stopPropagation();">
                        <input type="checkbox" ${user.active !== false ? 'checked' : ''} 
                               onchange="toggleUserActive('${user.uid}', this.checked)">
                        <span class="status-badge ${statusClass}">
                            ${statusLabel}
                        </span>
                    </label>
                </td>
                <td class="col-optional">${assignedCount}</td>
                <td class="col-optional">${formatDateTime(user.lastLogin)}</td>
                <td class="col-optional">
                    <div class="action-buttons" onclick="event.stopPropagation();">
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

function renderAdminsTable(admins, totalCount) {
    const tbody = document.getElementById('adminsTableBody');
    if (!tbody) return;

    if (!totalCount) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: #64748B;">No admins found</td></tr>';
        return;
    }
    if (!admins.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: #64748B;">No admins on this page</td></tr>';
        return;
    }

    tbody.innerHTML = admins.map(user => {
        const statusClass = user.active !== false ? 'status-active' : 'status-deactivated';
        const statusLabel = user.active !== false ? 'Active' : 'Deactivated';
        return `
        <tr data-uid="${user.uid}" onclick="handleRowClick(event, '${user.uid}')">
            <td class="col-primary">${user.name || 'N/A'}</td>
            <td class="col-primary">${user.email || 'N/A'}</td>
            <td class="col-optional">${(user.role || 'admin').toUpperCase()}</td>
            <td class="col-optional">${formatDateTime(user.lastLogin)}</td>
            <td class="col-optional">
                <div class="action-buttons" onclick="event.stopPropagation();">
                    <label class="status-toggle" onclick="event.stopPropagation();">
                        <input type="checkbox" ${user.active !== false ? 'checked' : ''} 
                               onchange="toggleUserActive('${user.uid}', this.checked)">
                        <span class="status-badge ${statusClass}">
                            ${statusLabel}
                        </span>
                    </label>
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

function renderPublicTable(publicUsers, totalCount) {
    const tbody = document.getElementById('publicTableBody');
    if (!tbody) return;

    if (!totalCount) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px; color: #64748B;">No public users found</td></tr>';
        return;
    }
    if (!publicUsers.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px; color: #64748B;">No public users on this page</td></tr>';
        return;
    }

    tbody.innerHTML = publicUsers.map(user => {
        const statusClass = user.active !== false ? 'status-active' : 'status-deactivated';
        const statusLabel = user.active !== false ? 'Active' : 'Deactivated';
        const created = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A';
        const convertedFlag = user.convertedToStudent || !!user.convertedToStudentAt;
        const converted = convertedFlag
            ? '<i class="fas fa-check-circle" style="color: #10B981;"></i> Yes'
            : '<i class="fas fa-times-circle" style="color: #EF4444;"></i> No';
        return `
        <tr data-uid="${user.uid}" onclick="handleRowClick(event, '${user.uid}')">
            <td class="col-primary">${user.name || 'N/A'}</td>
            <td class="col-primary">${user.email || 'N/A'}</td>
            <td class="col-optional">${created}</td>
            <td class="col-optional">${converted}</td>
            <td class="col-optional">
                <label class="status-toggle" onclick="event.stopPropagation();">
                    <input type="checkbox" ${user.active !== false ? 'checked' : ''} 
                           onchange="toggleUserActive('${user.uid}', this.checked)">
                    <span class="status-badge ${statusClass}">
                        ${statusLabel}
                    </span>
                </label>
            </td>
            <td class="col-optional">
                <div class="action-buttons" onclick="event.stopPropagation();">
                    <button class="btn-action btn-convert-small" onclick="openConvertModal('${user.uid}')" title="Convert to Student">
                        <i class="fas fa-exchange-alt"></i>
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

function handleRowClick(event, uid) {
    const target = event.target;
    if (currentRoleTab === 'students' && isBulkMode) {
        return;
    }
    if (
        target.closest('.action-buttons') ||
        target.closest('button') ||
        target.closest('input') ||
        target.closest('label')
    ) {
        return;
    }
    showUserDetails(uid);
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
    
    updateTabActionButtons();
    renderUsers();
}

function updateTabActionButtons() {
    document.querySelectorAll('.tab-action-btn').forEach(button => {
        if (button.dataset.tab === currentRoleTab) {
            button.classList.add('active');
            button.style.display = 'inline-flex';
        } else {
            button.classList.remove('active');
            button.style.display = 'none';
        }
    });
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

// Edit user
async function editUser(uid) {
    currentEditUserId = uid;
    const user = allUsers.find(u => u.uid === uid);
    if (!user) {
        showError('User not found');
        return;
    }
    
    // Reset errors
    document.querySelectorAll('.form-error').forEach(el => {
        el.style.display = 'none';
        el.textContent = '';
    });
    document.querySelectorAll('.form-group input, .form-group select').forEach(el => {
        el.style.borderColor = '#E2E8F0';
    });
    
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
    if (!uid) return;

    // Reset validation UI
    document.querySelectorAll('.form-error').forEach(el => el.style.display = 'none');
    document.querySelectorAll('input, select').forEach(el => el.style.borderColor = '#E2E8F0');

    const name = capitalizeName(document.getElementById('editUserName').value.trim());
    const email = document.getElementById('editUserEmail').value.trim();
    const role = document.getElementById('editUserRole')?.value;
    
    // Basic validation
    if (!name) {
        showError('Name is required');
        return;
    }
    if (!email || !validateEmail(email)) {
        showError('Valid email is required');
        return;
    }

    // Check email uniqueness (excluding current user)
    const emailExists = allUsers.some(u => u.uid !== uid && (u.email || '').toLowerCase() === email.toLowerCase());
    if (emailExists) {
        const emailInput = document.getElementById('editUserEmail');
        emailInput.style.borderColor = '#EF4444';
        showError('Email already exists');
        return;
    }

    const updateData = { name, email };
    if (role) updateData.role = role;
    
    const status = document.getElementById('editUserStatus')?.value;
    if (status !== undefined) updateData.active = status === 'active';

    // Shared fields
    const phone = document.getElementById('editUserPhone')?.value.trim();
    if (phone) {
        if (!/^\d{10}$/.test(phone)) {
            const phoneInput = document.getElementById('editUserPhone');
            const errorSpan = document.getElementById('errorEditPhone');
            phoneInput.style.borderColor = '#EF4444';
            if (errorSpan) {
                errorSpan.textContent = 'Contact number must be exactly 10 digits';
                errorSpan.style.display = 'block';
            }
            return;
        }
        updateData.contactNumber = phone;
    }
    updateData.address = document.getElementById('editUserAddress')?.value.trim();
    updateData.birthday = document.getElementById('editUserBirthday')?.value;

    // Student specific validation
    const assignedInstructorSelect = document.getElementById('editAssignedInstructor');
    const assignedInstructorValue = assignedInstructorSelect ? assignedInstructorSelect.value : undefined;

    if (role === 'student') {
        const studentNumber = document.getElementById('editStudentNumber').value.trim();
        const batch = document.getElementById('editBatch').value.trim();

        let hasError = false;

        if (!studentNumber) {
            document.getElementById('editStudentNumber').style.borderColor = '#EF4444';
            document.getElementById('errorEditStudentNumber').textContent = 'Student number is required';
            document.getElementById('errorEditStudentNumber').style.display = 'block';
            hasError = true;
        } else if (!/^\d+$/.test(studentNumber)) {
            document.getElementById('editStudentNumber').style.borderColor = '#EF4444';
            document.getElementById('errorEditStudentNumber').textContent = 'Student number must be numeric';
            document.getElementById('errorEditStudentNumber').style.display = 'block';
            hasError = true;
        } else {
            // Check uniqueness
            const snExists = allUsers.some(u => u.uid !== uid && u.studentInfo && u.studentInfo.studentNumber === studentNumber);
            if (snExists) {
                document.getElementById('editStudentNumber').style.borderColor = '#EF4444';
                document.getElementById('errorEditStudentNumber').textContent = 'Student number already exists';
                document.getElementById('errorEditStudentNumber').style.display = 'block';
                hasError = true;
            }
        }

        if (!batch) {
            document.getElementById('editBatch').style.borderColor = '#EF4444';
            document.getElementById('errorEditBatch').textContent = 'Batch is required';
            document.getElementById('errorEditBatch').style.display = 'block';
            hasError = true;
        }

        if (hasError) return;

        const existingUser = allUsers.find(u => u.uid === uid) || {};
        updateData.studentInfo = {
            ...(existingUser.studentInfo || {}),
            studentNumber,
            batch,
            contactNumber: phone,
            address: updateData.address,
            birthday: updateData.birthday
        };
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

        if (!response.ok) throw new Error('Failed to update user');

        if (role === 'student' && assignedInstructorValue !== undefined) {
            await assignInstructorToStudent(uid, assignedInstructorValue);
        }

        showSuccess('User updated successfully');
        closeEditUserPage();
        await loadUsers();
    } catch (error) {
        console.error('Save user edit error:', error);
        showError(error.message || 'Failed to update user');
    }
}

async function assignInstructorToStudent(uid, instructorId) {
    try {
        await fetch(`${API_BASE}/users/${uid}/assign-instructor`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ instructorId: instructorId || '' })
        });
        return true;
    } catch (error) {
        console.error('Assign instructor error:', error);
        return false;
    }
}

// Add User Modal functions
function openAddUserModal(roleOverride) {
    const resolvedRole = roleOverride || ROLE_TAB_MAP[currentRoleTab] || 'student';
    currentModalRole = resolvedRole;
    const modal = document.getElementById('addUserModal');
    const form = document.getElementById('addUserForm');
    if (form) form.reset();
    
    // Reset validation errors
    document.querySelectorAll('.form-error').forEach(el => {
        el.style.display = 'none';
        el.textContent = '';
    });
    document.querySelectorAll('.form-group input, .form-group select').forEach(el => {
        el.style.borderColor = '#E2E8F0';
    });

    document.getElementById('addUserRoleValue').value = resolvedRole;
    const titleEl = document.getElementById('addUserModalTitle');
    if (titleEl) {
        titleEl.textContent = resolvedRole === 'student'
            ? 'Invite Student'
            : resolvedRole === 'instructor'
                ? 'Add Instructor'
                : 'Add Admin';
    }
    const studentFields = document.getElementById('studentFields');
    const passwordGroup = document.getElementById('addUserPasswordGroup');
    const passwordInput = document.getElementById('addUserPassword');
    const submitButton = document.getElementById('addUserSubmitButton');

    if (studentFields) {
        studentFields.style.display = resolvedRole === 'student' ? 'block' : 'none';
    }
    if (passwordGroup && passwordInput) {
        if (resolvedRole === 'student') {
            passwordGroup.style.display = 'none';
            passwordInput.required = false;
            passwordInput.value = '';
        } else {
            passwordGroup.style.display = 'block';
            passwordInput.required = true;
        }
    }
    if (submitButton) {
        submitButton.textContent = resolvedRole === 'student' ? 'Invite Student' : 'Add User';
    }
    modal.style.display = 'flex';
}

function closeAddUserModal() {
    document.getElementById('addUserModal').style.display = 'none';
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

async function saveNewUser(event) {
    event.preventDefault();
    const role = currentModalRole;
    
    // Reset validation UI
    document.querySelectorAll('.form-error').forEach(el => el.style.display = 'none');
    document.querySelectorAll('input, select').forEach(el => el.style.borderColor = '#E2E8F0');

    const name = capitalizeName(document.getElementById('addUserName').value.trim());
    const email = document.getElementById('addUserEmail').value.trim();

    if (!name || !email) {
        showError('Name and email are required');
        return;
    }

    if (role === 'student') {
        const studentNumber = document.getElementById('addStudentNumber').value.trim();
        const batch = document.getElementById('addBatch').value.trim();
        const phone = document.getElementById('addStudentPhone').value.trim();
        
        let hasError = false;

        // Validate Student Number
        if (!studentNumber) {
            document.getElementById('addStudentNumber').style.borderColor = '#EF4444';
            document.getElementById('errorStudentNumber').textContent = 'Student number is required';
            document.getElementById('errorStudentNumber').style.display = 'block';
            hasError = true;
        } else if (!/^\d+$/.test(studentNumber)) {
            document.getElementById('addStudentNumber').style.borderColor = '#EF4444';
            document.getElementById('errorStudentNumber').textContent = 'Student number must be numeric';
            document.getElementById('errorStudentNumber').style.display = 'block';
            hasError = true;
        } else {
            // Uniqueness Check
            const exists = allUsers.some(u => u.studentInfo && u.studentInfo.studentNumber === studentNumber);
            if (exists) {
                document.getElementById('addStudentNumber').style.borderColor = '#EF4444';
                document.getElementById('errorStudentNumber').textContent = 'Student number already exists';
                document.getElementById('errorStudentNumber').style.display = 'block';
                hasError = true;
            }
        }

        // Validate Batch
        if (!batch) {
            document.getElementById('addBatch').style.borderColor = '#EF4444';
            document.getElementById('errorBatch').textContent = 'Batch is required';
            document.getElementById('errorBatch').style.display = 'block';
            hasError = true;
        }

        // Validate Phone (Optional but strictly formatted if present)
        if (phone && !/^\d{10}$/.test(phone)) {
            document.getElementById('addStudentPhone').style.borderColor = '#EF4444';
            document.getElementById('errorPhone').textContent = 'Contact number must be exactly 10 digits';
            document.getElementById('errorPhone').style.display = 'block';
            hasError = true;
        }

        // Email Uniqueness
        const emailExists = allUsers.some(u => (u.email || '').toLowerCase() === email.toLowerCase());
        if (emailExists) {
            document.getElementById('addUserEmail').style.borderColor = '#EF4444';
            showError('Email already exists');
            hasError = true;
        }

        if (hasError) return;

        const payload = {
            name,
            email,
            studentInfo: {
                studentNumber,
                batch,
                contactNumber: phone,
                birthday: document.getElementById('addStudentBirthday').value,
                address: document.getElementById('addStudentAddress').value.trim()
            }
        };

        const submitButton = document.getElementById('addUserSubmitButton');
        const originalText = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = 'Inviting...';

        try {
            const response = await fetch(`${API_BASE}/users/invite-student`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error('Failed to invite student');

            showSuccess('Student invited successfully. An email has been sent so they can set their password.');
            closeAddUserModal();
            await loadUsers();
        } catch (error) {
            console.error('Invite student error:', error);
            showError(error.message || 'Failed to invite student');
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = originalText;
            }
        }
        return;
    }

    const passwordInput = document.getElementById('addUserPassword');
    const password = passwordInput ? passwordInput.value : '';
    if (!password) {
        showError('Password is required');
        return;
    }

    const payload = { name, email, password, role };

    try {
        const endpoint = role === 'instructor'
            ? `${API_BASE}/users/create-instructor`
            : `${API_BASE}/users/create-admin`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error('Failed to create user');
        
        showSuccess(role === 'instructor' ? 'Instructor created successfully' : 'Admin created successfully');
        closeAddUserModal();
        await loadUsers();
    } catch (error) {
        console.error('Create user error:', error);
        showError(error.message || 'Failed to create user');
    }
}

function openConvertModal(uid) {
    const modal = document.getElementById('convertUserModal');
    const form = document.getElementById('convertUserForm');
    if (form) form.reset();
    document.getElementById('convertUserId').value = uid;
    modal.style.display = 'flex';
}

function closeConvertModal() {
    document.getElementById('convertUserModal').style.display = 'none';
}

async function submitConvertToStudent(event) {
    event.preventDefault();
    const uid = document.getElementById('convertUserId').value;
    if (!uid) {
        showError('User ID missing');
        return;
    }
    const payload = {
        studentNumber: document.getElementById('convertStudentNumber').value.trim(),
        batch: document.getElementById('convertBatch').value.trim(),
        address: document.getElementById('convertAddress').value.trim(),
        birthday: document.getElementById('convertBirthday').value,
        contactNumber: document.getElementById('convertContact').value.trim()
    };
    if (!payload.studentNumber || !payload.batch) {
        showError('Student number and batch are required');
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/users/${uid}/convert-to-student`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to convert user');
        showSuccess('User converted to student');
        closeConvertModal();
        await loadUsers();
    } catch (error) {
        console.error('Convert user error:', error);
        showError(error.message || 'Failed to convert user');
    }
}

async function resendInvite(uid, btnElement) {
    let originalContent = '';
    if (btnElement) {
        originalContent = btnElement.innerHTML;
        btnElement.disabled = true;
        btnElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    }

    try {
        const response = await fetch(`${API_BASE}/users/${uid}/resend-invite`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Failed to resend invite');

        showSuccess('Invite resent successfully');
        await loadUsers();
    } catch (error) {
        console.error('Resend invite error:', error);
        showError(error.message || 'Failed to resend invite');
    } finally {
        if (btnElement) {
            btnElement.innerHTML = originalContent;
            btnElement.disabled = false;
        }
    }
}

async function sendArchiveRequest(uid) {
    const response = await fetch(`${API_BASE}/users/${uid}/archive`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) throw new Error('Failed to archive student');

    showSuccess('Student archived');
    await loadUsers();
}

function archiveStudent(uid) {
    pendingArchiveUid = uid;
    const modal = document.getElementById('archiveStudentModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeArchiveModal() {
    const modal = document.getElementById('archiveStudentModal');
    if (modal) {
        modal.style.display = 'none';
    }
    pendingArchiveUid = null;
    const btn = document.getElementById('confirmArchiveBtn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Confirm';
    }
}

async function confirmArchiveStudent() {
    if (!pendingArchiveUid) return;
    const uid = pendingArchiveUid;
    const btn = document.getElementById('confirmArchiveBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Archiving...';
    }
    try {
        await sendArchiveRequest(uid);
        closeArchiveModal();
    } catch (error) {
        console.error('Archive student error:', error);
        showError(error.message || 'Failed to archive student');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Confirm';
        }
    }
}

async function restoreStudent(uid) {
    try {
        const response = await fetch(`${API_BASE}/users/${uid}/restore`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Failed to restore student');

        showSuccess('Student restored');
        await loadUsers();
    } catch (error) {
        console.error('Restore student error:', error);
        showError(error.message || 'Failed to restore student');
    }
}

// User Details Popup
function showUserDetails(uid) {
    const user = allUsers.find(u => u.uid === uid);
    if (!user) {
        showError('User not found');
        return;
    }

    const role = (user.role || 'public').toLowerCase();
    const statusMeta = deriveStatusMeta(user);

    const body = document.getElementById('userDetailsBody');
    if (body) {
        const rows = [];
        rows.push({
            label: 'Role',
            value: `<span class="role-badge role-${role}">${role}</span>`,
            allowHtml: true
        });
        rows.push({
            label: 'Status',
            value: `<span class="status-badge ${statusMeta.className}">${statusMeta.label}</span>`,
            allowHtml: true
        });
        rows.push({ label: 'Email', value: user.email || 'N/A' });
        rows.push({ label: 'Last Login', value: formatDateDisplay(user.lastLogin, 'Never') });
        rows.push({ label: 'Created At', value: formatDateDisplay(user.createdAt) });
        rows.push({ label: 'Login Count', value: user.loginCount || 0 });
        rows.push({ label: 'Last Active', value: formatDateDisplay(user.lastActiveAt, 'N/A') });

        if (role === 'student') {
            const studentInfo = user.studentInfo || {};
            rows.push({ label: 'Student Number', value: studentInfo.studentNumber || 'N/A' });
            rows.push({ label: 'Batch', value: studentInfo.batch || 'N/A' });
            rows.push({ label: 'Assigned Instructor', value: getInstructorName(user.assignedInstructor) });
            rows.push({ label: 'Invite Status', value: (user.inviteStatus || (user.verified ? 'completed' : 'pending')).toUpperCase() });
            rows.push({ label: 'Contact Number', value: formatContactNumber(studentInfo.contactNumber || user.contactNumber) });
            rows.push({ label: 'Birthday', value: formatDateOnly(studentInfo.birthday || user.birthday) });
            rows.push({ label: 'Address', value: studentInfo.address || user.address || 'N/A' });
        } else if (role === 'instructor') {
            rows.push({ label: 'Department', value: user.department || 'N/A' });
            rows.push({ label: 'Assigned Students', value: countAssignedStudents(user.uid) });
            rows.push({ label: 'Contact Number', value: formatContactNumber(user.contactNumber) });
        } else if (role === 'admin') {
            rows.push({ label: 'Contact Number', value: formatContactNumber(user.contactNumber) });
        } else {
            rows.push({ label: 'Converted to Student', value: user.role === 'student' ? 'Yes' : 'No' });
            rows.push({ label: 'Active', value: user.active !== false ? 'Yes' : 'No' });
        }

        body.innerHTML = rows.map(row => buildDetailRow(row.label, row.value, { allowHtml: row.allowHtml })).join('');
    }

    document.getElementById('userDetailsName').textContent = user.name || 'N/A';
    document.getElementById('userDetailsEmail').textContent = user.email || 'N/A';

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

// Assign instructor to student (Single)
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
                <button onclick="this.closest('div[style*=\\'position: fixed\\']').remove()" style="padding: 10px 20px; border: 1px solid #E2E8F0; background: white; border-radius: 8px; cursor: pointer;">Cancel</button>
                <button id="btnConfirmAssign" onclick="confirmAssignInstructor('${uid}')" style="padding: 10px 20px; background: #556B2F; color: white; border: none; border-radius: 8px; cursor: pointer;">Assign</button>
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
    const btn = document.getElementById('btnConfirmAssign');
    
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Assigning...';
    }
    
    try {
        const response = await fetch(`${API_BASE}/users/${uid}/assign-instructor`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ instructorId })
        });

        if (!response.ok) throw new Error('Failed to assign instructor');

        const data = await response.json();
        if (data.success) {
            showSuccess(instructorId ? 'Instructor assigned successfully' : 'Instructor assignment removed');
            if (window.currentAssignModal) {
                window.currentAssignModal.remove();
                window.currentAssignModal = null;
            }
            await loadUsers();
        }
    } catch (error) {
        console.error('Assign instructor error:', error);
        showError(error.message || 'Failed to assign instructor');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Assign';
        }
    }
}

// Modal close on outside click
window.onclick = function(event) {
    const modals = ['logoutModal', 'addUserModal', 'alertModal', 'userDetailsPopup', 'bulkArchiveModal', 'archiveStudentModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (event.target === modal) {
            if (modalId === 'logoutModal') closeLogoutModal();
            else if (modalId === 'addUserModal') closeAddUserModal();
            else if (modalId === 'alertModal') closeAlertModal();
            else if (modalId === 'userDetailsPopup') closeUserDetailsPopup();
            else if (modalId === 'bulkArchiveModal') closeBulkArchiveModal();
            else if (modalId === 'archiveStudentModal') closeArchiveModal();
        }
    });
    // Also handle dynamic modals
    if (window.currentAssignModal && event.target === window.currentAssignModal) {
        window.currentAssignModal.remove();
        window.currentAssignModal = null;
    }
    if (window.currentBulkAssignModal && event.target === window.currentBulkAssignModal) {
        window.currentBulkAssignModal.remove();
        window.currentBulkAssignModal = null;
    }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', async function() {
    initErrorMessageContainer();
    
    // Add event listeners
    const searchBar = document.getElementById('searchBar');
    const filterBatch = document.getElementById('filterBatch');
    const sortBy = document.getElementById('sortBy'); // Sort UI removed from DOM but checking just in case
    
    if (searchBar) searchBar.addEventListener('input', () => {
        resetPagination(currentRoleTab);
        renderUsers();
    });
    if (filterBatch) filterBatch.addEventListener('change', () => {
        resetPagination(currentRoleTab);
        renderUsers();
    });
    
    // Load instructors and users on page load
    await loadInstructors();
    await loadUsers();
    switchRoleTab(currentRoleTab);
});
