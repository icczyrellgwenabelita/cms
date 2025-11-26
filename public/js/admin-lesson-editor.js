// Admin Lesson Editor - Complete Rebuild
// This file handles lesson creation/editing with pages and assessments

const adminToken = localStorage.getItem('adminToken');

if (!adminToken) {
    window.location.href = '/admin-login';
}

const API_BASE = '/api/admin';

// Get URL parameters
const urlParams = new URLSearchParams(window.location.search);
const action = urlParams.get('action') || 'create';
let slot = urlParams.get('slot') ? parseInt(urlParams.get('slot')) : null;
const defaultTab = urlParams.get('tab') || 'content';

// State management
let currentLesson = null;
let currentTools = {};
let currentTab = defaultTab;
let currentLessonSlot = slot;
let allPages = [];
let currentPageAssessments = {};

// Error handling
let errorMessageContainer = null;

function initErrorMessageContainer() {
    const container = document.querySelector('.lesson-editor-page');
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
        alert(message);
    }
}

function showSuccess(message) {
    showAlertModal(message, 'Success');
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

// ============================================
// Initialization
// ============================================

async function initializeEditor() {
    try {
    if (action === 'edit' && slot) {
        await loadLessonFromAPI(slot);
    } else {
        // New lesson
        currentLesson = {
            slot: null,
            lessonName: '',
            lessonDescription: '',
            content: '',
            images: [],
                tools: {},
                status: 'draft'
        };
        currentLessonSlot = null;
        const titleEl = document.getElementById('editorPageTitle');
        if (titleEl) titleEl.textContent = 'Create New Lesson';
        const isNewEl = document.getElementById('isNewLesson');
        if (isNewEl) isNewEl.value = 'true';
            loadLessonData();
    }

    switchTab(currentTab);
    loadTools();
    } catch (error) {
        console.error('Initialization error:', error);
        showError('Failed to initialize editor: ' + error.message);
    }
}

// ============================================
// Lesson Loading
// ============================================

async function loadLessonFromAPI(lessonSlot) {
    try {
        const response = await fetch(`${API_BASE}/lessons`, {
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
            throw new Error('Failed to fetch lessons');
        }

        const data = await response.json();
        if (data.success && data.lessons) {
            currentLesson = data.lessons.find(l => l.slot === lessonSlot);
            if (currentLesson) {
                currentLessonSlot = currentLesson.slot || lessonSlot;
                slot = currentLessonSlot;
                currentTools = currentLesson.tools || {};
                currentLesson.tools = currentTools;
                loadLessonData();
                const deleteBtn = document.getElementById('deleteBtn');
                if (deleteBtn) deleteBtn.style.display = 'block';
                const titleEl = document.getElementById('editorPageTitle');
                if (titleEl) titleEl.textContent = `Edit Lesson ${lessonSlot}`;
                const isNewEl = document.getElementById('isNewLesson');
                if (isNewEl) isNewEl.value = 'false';
            } else {
                showAlertModal('Lesson not found', 'Error');
                setTimeout(() => goBack(), 2000);
            }
        }
    } catch (error) {
        console.error('Load lesson error:', error);
        showError('Failed to load lesson');
    }
}

function loadLessonData() {
    if (!currentLesson) return;
    
    const slotEl = document.getElementById('lessonSlot');
    const titleEl = document.getElementById('lessonTitle');
    const descEl = document.getElementById('lessonDescription');
    const bodyEl = document.getElementById('lessonBody');
    const statusEl = document.getElementById('lessonStatus');
    
    if (slotEl) slotEl.value = currentLesson.slot || '';
    if (titleEl) titleEl.value = currentLesson.lessonTitle || currentLesson.lessonName || '';
    if (descEl) descEl.value = currentLesson.description || currentLesson.lessonDescription || '';
    if (bodyEl) bodyEl.innerHTML = currentLesson.body || currentLesson.content || '';
    if (statusEl) statusEl.value = (currentLesson.status || 'draft');
    
    // Load images
    currentLesson.images = currentLesson.images || [];
    const previewContainer = document.getElementById('supportingImagesPreview');
    if (currentLesson.images.length > 0) {
        displaySupportingImages(currentLesson.images);
    } else if (previewContainer) {
        previewContainer.innerHTML = '';
    }
    
    // Load tools
    if (currentLesson.tools) {
        currentTools = currentLesson.tools;
        loadTools();
    }
    currentLesson.tools = currentTools;
}

// ============================================
// Tab Management
// ============================================

function switchTab(tabName) {
    currentTab = tabName;
    
    // Update tab buttons
    document.querySelectorAll('.editor-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    const tabButton = document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
    if (tabButton) tabButton.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.editor-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    const tabContent = document.getElementById(`${tabName}Tab`);
    if (tabContent) tabContent.classList.add('active');
    
    // Load tab-specific content
    if (tabName === 'preview') {
        renderPreview();
    } else if (tabName === 'pages') {
        loadPages();
    }
}

// ============================================
// Rich Text Editor
// ============================================

function formatText(command) {
    const editor = document.getElementById('lessonBody');
    if (!editor) return;
    
    editor.focus();
    
    if (command === 'bold') {
        document.execCommand('bold', false, null);
    } else if (command === 'italic') {
        document.execCommand('italic', false, null);
    } else if (command === 'underline') {
        document.execCommand('underline', false, null);
    } else if (command === 'heading') {
        const heading = prompt('Enter heading level (1-6):', '2');
        if (heading && heading >= 1 && heading <= 6) {
            document.execCommand('formatBlock', false, `<h${heading}>`);
        }
    } else if (command === 'list') {
        document.execCommand('insertUnorderedList', false, null);
    }
}

function insertImage() {
    const url = prompt('Enter image URL:');
    if (url) {
        const editor = document.getElementById('lessonBody');
        if (editor) {
            editor.focus();
            document.execCommand('insertImage', false, url);
        }
    }
}

// ============================================
// Image Management
// ============================================

function setupImageHandlers() {
    const imageInput = document.getElementById('supportingImages');
    if (imageInput) {
        imageInput.addEventListener('change', function(e) {
            const files = Array.from(e.target.files);
            const preview = document.getElementById('supportingImagesPreview');
            if (!preview) return;
            
            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const imgContainer = document.createElement('div');
                    imgContainer.className = 'preview-image-item';
                    imgContainer.innerHTML = `
                        <img src="${e.target.result}" class="preview-image">
                        <button type="button" class="remove-image" onclick="removeImage(this)">×</button>
                    `;
                    preview.appendChild(imgContainer);
                };
                reader.readAsDataURL(file);
            });
        });
    }
}

function displaySupportingImages(images) {
    const preview = document.getElementById('supportingImagesPreview');
    if (!preview) return;
    
    preview.innerHTML = '';
    images.forEach((img, index) => {
        const imgContainer = document.createElement('div');
        imgContainer.className = 'preview-image-item';
        imgContainer.innerHTML = `
            <img src="${img}" class="preview-image">
            <button type="button" class="remove-image" onclick="removeImage(this)">×</button>
        `;
        preview.appendChild(imgContainer);
    });
}

function removeImage(button) {
    if (button && button.parentElement) {
        button.parentElement.remove();
    }
}

// ============================================
// Tools Management
// ============================================

function loadTools() {
    const container = document.getElementById('toolsContainer');
    if (!container) return;
    
    if (!currentTools || Object.keys(currentTools).length === 0) {
        container.innerHTML = `
            <div class="empty-tools-state">
                <p>No tools added yet. Click "Add Tool" to get started.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = Object.entries(currentTools).map(([toolId, tool]) => {
        return `
        <div class="tool-card" data-tool-id="${toolId}">
            <div class="tool-card-header">
                <h3 class="tool-name">${tool.name || 'Unnamed Tool'}</h3>
                <div class="tool-card-actions">
                    <button class="btn-tool-edit" onclick="editTool('${toolId}')"><i class="fas fa-edit"></i> Edit</button>
                    <button class="btn-tool-delete" onclick="deleteTool('${toolId}')"><i class="fas fa-trash"></i> Delete</button>
                </div>
            </div>
            <div class="tool-card-content">
                <p class="tool-description">${tool.description || 'No description'}</p>
            </div>
        </div>
    `;
    }).join('');
}

function addNewTool() {
    document.getElementById('toolModalTitle').textContent = 'Add New Tool';
    document.getElementById('toolForm').reset();
    document.getElementById('toolId').value = '';
    document.getElementById('toolImagePreview').innerHTML = '';
    document.getElementById('toolModal').style.display = 'flex';
}

function editTool(toolId) {
    const tool = currentTools[toolId];
    if (!tool) return;
    
    document.getElementById('toolModalTitle').textContent = 'Edit Tool';
    document.getElementById('toolId').value = toolId;
    document.getElementById('toolName').value = tool.name || '';
    document.getElementById('toolDescription').value = tool.description || '';
    document.getElementById('toolCategory').value = tool.category || '';
    document.getElementById('toolInstructions').value = tool.instructions || '';
    
    const imagePreview = document.getElementById('toolImagePreview');
    if (tool.imageUrl || tool.imageURL) {
        imagePreview.innerHTML = `<img src="${tool.imageUrl || tool.imageURL}" alt="${tool.name}" style="max-width: 100%; max-height: 200px; border-radius: 4px;">`;
    } else {
        imagePreview.innerHTML = '';
    }
    
    document.getElementById('toolModal').style.display = 'flex';
}

function closeToolModal() {
    document.getElementById('toolModal').style.display = 'none';
}

async function saveTool(event) {
    event.preventDefault();
    
    try {
        const toolId = document.getElementById('toolId').value || Date.now().toString();
        const tool = {
            name: document.getElementById('toolName').value.trim(),
            description: document.getElementById('toolDescription').value.trim(),
            category: document.getElementById('toolCategory').value,
            instructions: document.getElementById('toolInstructions').value.trim()
        };
        
        const imageFile = document.getElementById('toolImage').files[0];
        if (imageFile) {
            const reader = new FileReader();
            tool.imageUrl = await new Promise((resolve) => {
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(imageFile);
            });
        } else if (currentTools[toolId]) {
            tool.imageUrl = currentTools[toolId].imageUrl || currentTools[toolId].imageURL || '';
        }
        
        currentTools[toolId] = tool;
        currentLesson = currentLesson || {};
        currentLesson.tools = { ...currentTools };
        
        closeToolModal();
        loadTools();
        showSuccess('Tool added to lesson. Remember to save the lesson to persist changes.');
    } catch (error) {
        console.error('Save tool error:', error);
        showError('Failed to save tool');
    }
}

function deleteTool(toolId) {
    if (confirm('Are you sure you want to delete this tool?')) {
        delete currentTools[toolId];
        currentLesson = currentLesson || {};
        currentLesson.tools = { ...currentTools };
        loadTools();
    }
}

// ============================================
// Lesson Save
// ============================================

async function saveLesson() {
    const titleEl = document.getElementById('lessonTitle');
    const descEl = document.getElementById('lessonDescription');
    const bodyEl = document.getElementById('lessonBody');
    const isNewEl = document.getElementById('isNewLesson');
    const statusEl = document.getElementById('lessonStatus');
    
    if (!titleEl || !descEl || !bodyEl) {
        showError('Form elements not found');
        return;
    }
    
    const title = titleEl.value.trim();
    const description = descEl.value.trim();
    const body = bodyEl.innerHTML.trim() || '<p></p>';
    const isNew = isNewEl ? isNewEl.value === 'true' : true;
    const status = statusEl ? statusEl.value : 'draft';
    
    if (!title || !description) {
        showAlertModal('Please fill in the title and description', 'Error');
        return;
    }
    
    // Get uploaded images from preview
    const imagePreviews = document.querySelectorAll('#supportingImagesPreview .preview-image-item img');
    const images = Array.from(imagePreviews).map(img => img.src).filter(src => src && src.trim() !== '');

    const toolsPayload = {};
    Object.entries(currentTools || {}).forEach(([toolId, tool]) => {
        toolsPayload[toolId] = { ...tool };
    });
    
    let lessonSlot = slot;
    if (isNew) {
        // For new lessons, find next available slot
        try {
            const response = await fetch(`${API_BASE}/lessons`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.lessons) {
                    const slots = data.lessons.map(l => l.slot).filter(s => s);
                    lessonSlot = slots.length > 0 ? Math.max(...slots) + 1 : 1;
                } else {
                    lessonSlot = 1;
                }
            } else {
                lessonSlot = 1;
            }
        } catch (error) {
            lessonSlot = 1;
        }
    }
    
    if (!lessonSlot) {
        showError('Invalid lesson slot');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/lessons/${lessonSlot}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                lessonTitle: title,
                description: description,
                body: body,
                images: images,
                tools: toolsPayload,
                status
            })
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to save lesson');
        }

        const data = await response.json();
        if (data.success) {
            currentLessonSlot = lessonSlot;
            slot = lessonSlot;
            currentLesson = {
                ...(currentLesson || {}),
                slot: lessonSlot,
                lessonTitle: title,
                lessonName: title,
                description,
                lessonDescription: description,
                body,
                images,
                tools: toolsPayload,
                status
            };
            currentTools = toolsPayload;
            const isNewElUpdated = document.getElementById('isNewLesson');
            if (isNewElUpdated) isNewElUpdated.value = 'false';
            const titleHeader = document.getElementById('editorPageTitle');
            if (titleHeader) titleHeader.textContent = `Edit Lesson ${lessonSlot}`;
            const deleteBtn = document.getElementById('deleteBtn');
            if (deleteBtn) deleteBtn.style.display = 'block';
            const slotInput = document.getElementById('lessonSlot');
            if (slotInput) slotInput.value = lessonSlot;
            window.history.replaceState({}, '', `/admin-lesson-editor?slot=${lessonSlot}&action=edit&tab=${currentTab}`);
            loadLessonData();
            // Reload pages if we're on the pages tab
            if (currentTab === 'pages') {
                loadPages();
            }
            showSuccess('Lesson saved successfully');
        }
    } catch (error) {
        console.error('Save lesson error:', error);
        showError(error.message || 'Failed to save lesson');
    }
}

// ============================================
// Page Management
// ============================================

async function loadPages() {
    if (!currentLessonSlot) {
        const emptyState = document.getElementById('pagesEmptyState');
        const container = document.getElementById('pagesContainer');
        if (container && emptyState) {
            container.innerHTML = '';
            const emptyStateClone = emptyState.cloneNode(true);
            container.appendChild(emptyStateClone);
        }
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/lessons/${currentLessonSlot}/pages`, {
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
            // If 404, lesson has no pages yet - that's okay
            if (response.status === 404) {
                allPages = [];
                renderPages();
                return;
            }
            throw new Error('Failed to fetch pages');
        }

        const data = await response.json();
        if (data.success) {
            allPages = data.pages || [];
            renderPages();
        }
    } catch (error) {
        console.error('Load pages error:', error);
        // Don't show error if it's just that pages don't exist yet
        if (error.message && !error.message.includes('404')) {
            showError('Failed to load pages');
        } else {
            allPages = [];
            renderPages();
        }
    }
}

function renderPages() {
    const container = document.getElementById('pagesContainer');
    const emptyState = document.getElementById('pagesEmptyState');
    if (!container) return;

    if (allPages.length === 0) {
        container.innerHTML = '';
        if (emptyState) {
            const emptyStateClone = emptyState.cloneNode(true);
            container.appendChild(emptyStateClone);
        }
        return;
    }

    container.innerHTML = allPages.map((page, index) => {
        const pageNumber = index + 1;
        const isFirst = index === 0;
        const isLast = index === allPages.length - 1;
        return `
            <div class="page-card" data-page-id="${page.id}" data-page-order="${page.order}" style="background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                            <span style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: #C19A6B; color: white; border-radius: 50%; font-weight: 600; font-size: 14px;">${pageNumber}</span>
                            <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #1F2937;">${escapeHtml(page.title || 'Untitled Page')}</h3>
                        </div>
                        <p style="margin: 0; color: #64748B; font-size: 14px; line-height: 1.5;">${escapeHtml((page.content || '').substring(0, 150))}${(page.content || '').length > 150 ? '...' : ''}</p>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        ${!isFirst ? `<button type="button" class="btn-secondary" onclick="movePageUp('${page.id}')" style="padding: 6px 10px; font-size: 12px; cursor: pointer;" title="Move Up"><i class="fas fa-arrow-up"></i></button>` : ''}
                        ${!isLast ? `<button type="button" class="btn-secondary" onclick="movePageDown('${page.id}')" style="padding: 6px 10px; font-size: 12px; cursor: pointer;" title="Move Down"><i class="fas fa-arrow-down"></i></button>` : ''}
                        <button type="button" class="btn-secondary" onclick="editPage('${page.id}')" style="padding: 8px 16px; font-size: 14px; cursor: pointer;">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button type="button" class="btn-secondary" onclick="deletePage('${page.id}')" style="padding: 8px 16px; font-size: 14px; color: #DC2626; cursor: pointer;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #E5E7EB;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <h4 style="margin: 0; font-size: 14px; font-weight: 600; color: #1F2937;">Assessment Questions</h4>
                        <button type="button" class="btn-primary" onclick="addAssessment('${page.id}')" style="padding: 6px 12px; font-size: 13px; cursor: pointer;">
                            <i class="fas fa-plus"></i> Add Question
                        </button>
                    </div>
                    <div id="assessments-${page.id}" class="assessments-list">
                        <!-- Assessments will be loaded here -->
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Load assessments for each page
    allPages.forEach(page => {
        loadPageAssessments(page.id);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function loadPageAssessments(pageId) {
    if (!currentLessonSlot) return;
    
    try {
        const response = await fetch(`${API_BASE}/lessons/${currentLessonSlot}/pages/${pageId}/assessments`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                currentPageAssessments[pageId] = data.assessments || [];
                renderPageAssessments(pageId);
            }
        } else if (response.status === 404) {
            // No assessments yet - that's okay
            currentPageAssessments[pageId] = [];
            renderPageAssessments(pageId);
        }
    } catch (error) {
        console.error('Load assessments error:', error);
        currentPageAssessments[pageId] = [];
        renderPageAssessments(pageId);
    }
}

function renderPageAssessments(pageId) {
    const container = document.getElementById(`assessments-${pageId}`);
    if (!container) return;

    const assessments = currentPageAssessments[pageId] || [];
    
    if (assessments.length === 0) {
        container.innerHTML = '<p style="color: #9CA3AF; font-size: 13px; margin: 0;">No assessment questions yet. Click "Add Question" to create one.</p>';
        return;
    }

    container.innerHTML = assessments.map(assessment => {
        const correctAnswer = assessment.correctAnswer || '';
        return `
            <div class="assessment-item" style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1;">
                        <p style="margin: 0 0 8px 0; font-weight: 500; color: #1F2937; font-size: 14px;">${escapeHtml(assessment.question || 'No question')}</p>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px; color: #64748B;">
                            <div>A: ${escapeHtml(assessment.answerA || '')}</div>
                            <div>B: ${escapeHtml(assessment.answerB || '')}</div>
                            <div>C: ${escapeHtml(assessment.answerC || '')}</div>
                            <div>D: ${escapeHtml(assessment.answerD || '')}</div>
                        </div>
                        <div style="margin-top: 8px; font-size: 12px; color: #C19A6B; font-weight: 500;">Correct: ${correctAnswer}</div>
                    </div>
                    <div style="display: flex; gap: 4px;">
                        <button type="button" class="btn-secondary" onclick="editAssessment('${pageId}', '${assessment.id}')" style="padding: 4px 8px; font-size: 12px; cursor: pointer;">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button type="button" class="btn-secondary" onclick="deleteAssessment('${pageId}', '${assessment.id}')" style="padding: 4px 8px; font-size: 12px; color: #DC2626; cursor: pointer;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function addNewPage() {
    if (!currentLessonSlot) {
        showAlertModal('Please save the lesson first before adding pages.', 'Info');
        return;
    }
    
    document.getElementById('pageModalTitle').textContent = 'Add New Page';
    document.getElementById('pageId').value = '';
    document.getElementById('pageTitle').value = '';
    document.getElementById('pageContent').value = '';
    document.getElementById('pageModal').style.display = 'flex';
}

function editPage(pageId) {
    const page = allPages.find(p => p.id === pageId);
    if (!page) return;
    
    document.getElementById('pageModalTitle').textContent = 'Edit Page';
    document.getElementById('pageId').value = pageId;
    document.getElementById('pageTitle').value = page.title || '';
    document.getElementById('pageContent').value = page.content || '';
    document.getElementById('pageModal').style.display = 'flex';
}

async function savePage(event) {
    event.preventDefault();
    if (!currentLessonSlot) {
        showAlertModal('Please save the lesson first.', 'Info');
        return;
    }
    
    const pageId = document.getElementById('pageId').value;
    const title = document.getElementById('pageTitle').value.trim();
    const content = document.getElementById('pageContent').value;
    
    if (!title) {
        showError('Page title is required');
        return;
    }
    
    try {
        const url = pageId 
            ? `${API_BASE}/lessons/${currentLessonSlot}/pages/${pageId}`
            : `${API_BASE}/lessons/${currentLessonSlot}/pages`;
        const method = pageId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title, content })
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to save page');
        }

        const data = await response.json();
        if (data.success) {
            showSuccess('Page saved successfully');
            closePageModal();
            await loadPages();
        }
    } catch (error) {
        console.error('Save page error:', error);
        showError(error.message || 'Failed to save page');
    }
}

async function deletePage(pageId) {
    if (!confirm('Are you sure you want to delete this page? All assessments will also be deleted.')) {
        return;
    }
    
    if (!currentLessonSlot) return;
    
    try {
        const response = await fetch(`${API_BASE}/lessons/${currentLessonSlot}/pages/${pageId}`, {
            method: 'DELETE',
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
            throw new Error(errorData.error || 'Failed to delete page');
        }

        const data = await response.json();
        if (data.success) {
            showSuccess('Page deleted successfully');
            await loadPages();
        }
    } catch (error) {
        console.error('Delete page error:', error);
        showError(error.message || 'Failed to delete page');
    }
}

function closePageModal() {
    document.getElementById('pageModal').style.display = 'none';
}

// Page reordering
async function movePageUp(pageId) {
    const pageIndex = allPages.findIndex(p => p.id === pageId);
    if (pageIndex <= 0) return;
    
    const page = allPages[pageIndex];
    const prevPage = allPages[pageIndex - 1];
    
    // Swap orders
    const tempOrder = page.order;
    page.order = prevPage.order;
    prevPage.order = tempOrder;
    
    // Reorder array
    allPages[pageIndex] = prevPage;
    allPages[pageIndex - 1] = page;
    
    await savePageOrder();
}

async function movePageDown(pageId) {
    const pageIndex = allPages.findIndex(p => p.id === pageId);
    if (pageIndex < 0 || pageIndex >= allPages.length - 1) return;
    
    const page = allPages[pageIndex];
    const nextPage = allPages[pageIndex + 1];
    
    // Swap orders
    const tempOrder = page.order;
    page.order = nextPage.order;
    nextPage.order = tempOrder;
    
    // Reorder array
    allPages[pageIndex] = nextPage;
    allPages[pageIndex + 1] = page;
    
    await savePageOrder();
}

async function savePageOrder() {
    if (!currentLessonSlot) return;
    
    try {
        // Create array of { pageId, order } in the new order
        const pageOrders = allPages.map((page, index) => ({
            pageId: page.id,
            order: index
        }));
        
        const response = await fetch(`${API_BASE}/lessons/${currentLessonSlot}/pages/reorder`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ pageOrders })
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to reorder pages');
        }

        // Reload pages to get updated order
        await loadPages();
    } catch (error) {
        console.error('Save page order error:', error);
        showError('Failed to reorder pages');
        // Reload to restore original order
        await loadPages();
    }
}

// ============================================
// Assessment Management
// ============================================

function addAssessment(pageId) {
    document.getElementById('assessmentModalTitle').textContent = 'Add Assessment Question';
    document.getElementById('assessmentPageId').value = pageId;
    document.getElementById('assessmentId').value = '';
    document.getElementById('assessmentQuestion').value = '';
    document.getElementById('assessmentAnswerA').value = '';
    document.getElementById('assessmentAnswerB').value = '';
    document.getElementById('assessmentAnswerC').value = '';
    document.getElementById('assessmentAnswerD').value = '';
    document.getElementById('assessmentCorrectAnswer').value = '';
    document.getElementById('assessmentExplanation').value = '';
    document.getElementById('assessmentModal').style.display = 'flex';
}

async function editAssessment(pageId, assessmentId) {
    const assessments = currentPageAssessments[pageId] || [];
    const assessment = assessments.find(a => a.id === assessmentId);
    if (!assessment) return;
    
    document.getElementById('assessmentModalTitle').textContent = 'Edit Assessment Question';
    document.getElementById('assessmentPageId').value = pageId;
    document.getElementById('assessmentId').value = assessmentId;
    document.getElementById('assessmentQuestion').value = assessment.question || '';
    document.getElementById('assessmentAnswerA').value = assessment.answerA || '';
    document.getElementById('assessmentAnswerB').value = assessment.answerB || '';
    document.getElementById('assessmentAnswerC').value = assessment.answerC || '';
    document.getElementById('assessmentAnswerD').value = assessment.answerD || '';
    document.getElementById('assessmentCorrectAnswer').value = assessment.correctAnswer || '';
    document.getElementById('assessmentExplanation').value = assessment.explanation || '';
    document.getElementById('assessmentModal').style.display = 'flex';
}

async function saveAssessment(event) {
    event.preventDefault();
    if (!currentLessonSlot) {
        showAlertModal('Please save the lesson first.', 'Info');
        return;
    }
    
    const pageId = document.getElementById('assessmentPageId').value;
    const assessmentId = document.getElementById('assessmentId').value;
    const question = document.getElementById('assessmentQuestion').value.trim();
    const answerA = document.getElementById('assessmentAnswerA').value.trim();
    const answerB = document.getElementById('assessmentAnswerB').value.trim();
    const answerC = document.getElementById('assessmentAnswerC').value.trim();
    const answerD = document.getElementById('assessmentAnswerD').value.trim();
    const correctAnswer = (document.getElementById('assessmentCorrectAnswer').value || '').trim().toUpperCase();
    const explanation = document.getElementById('assessmentExplanation').value.trim();
    
    if (!question || !answerA || !answerB || !answerC || !answerD || !correctAnswer) {
        showError('All fields are required');
        return;
    }
    
    try {
        const url = assessmentId
            ? `${API_BASE}/lessons/${currentLessonSlot}/pages/${pageId}/assessments/${assessmentId}`
            : `${API_BASE}/lessons/${currentLessonSlot}/pages/${pageId}/assessments`;
        const method = assessmentId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                question,
                answerA,
                answerB,
                answerC,
                answerD,
                correctAnswer,
                explanation
            })
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to save assessment');
        }

        const data = await response.json();
        if (data.success) {
            showSuccess('Assessment question saved successfully');
            closeAssessmentModal();
            await loadPageAssessments(pageId);
        }
    } catch (error) {
        console.error('Save assessment error:', error);
        showError(error.message || 'Failed to save assessment');
    }
}

async function deleteAssessment(pageId, assessmentId) {
    if (!confirm('Are you sure you want to delete this assessment question?')) {
        return;
    }
    
    if (!currentLessonSlot) return;
    
    try {
        const response = await fetch(`${API_BASE}/lessons/${currentLessonSlot}/pages/${pageId}/assessments/${assessmentId}`, {
            method: 'DELETE',
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
            throw new Error(errorData.error || 'Failed to delete assessment');
        }

        const data = await response.json();
        if (data.success) {
            showSuccess('Assessment deleted successfully');
            await loadPageAssessments(pageId);
        }
    } catch (error) {
        console.error('Delete assessment error:', error);
        showError(error.message || 'Failed to delete assessment');
    }
}

function closeAssessmentModal() {
    document.getElementById('assessmentModal').style.display = 'none';
}


// ============================================
// Preview
// ============================================

function renderPreview() {
    const previewContent = document.getElementById('previewContent');
    if (!previewContent) return;
    
    const titleEl = document.getElementById('lessonTitle');
    const descEl = document.getElementById('lessonDescription');
    const bodyEl = document.getElementById('lessonBody');
    
    const title = titleEl ? titleEl.value : '';
    const description = descEl ? descEl.value : '';
    const body = bodyEl ? bodyEl.innerHTML : '';
    
    previewContent.innerHTML = `
        <div class="preview-lesson">
            <h1 class="preview-title">${escapeHtml(title || 'Untitled Lesson')}</h1>
            <p class="preview-description">${escapeHtml(description || 'No description')}</p>
            <div class="preview-body">${body || '<p>No content yet</p>'}</div>
        </div>
    `;
}

// ============================================
// Navigation & Utilities
// ============================================

function goBack() {
    window.location.href = '/admin-lessons';
}

function deleteLesson() {
    document.getElementById('deleteModal').style.display = 'flex';
}

function closeDeleteModal() {
    document.getElementById('deleteModal').style.display = 'none';
}

function confirmDelete() {
    showAlertModal('Delete functionality not yet implemented in backend', 'Info');
    closeDeleteModal();
}

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

// ============================================
// Global Function Exports
// ============================================

window.saveLesson = saveLesson;
window.formatText = formatText;
window.insertImage = insertImage;
window.switchTab = switchTab;
window.goBack = goBack;
window.addNewPage = addNewPage;
window.editPage = editPage;
window.deletePage = deletePage;
window.addAssessment = addAssessment;
window.editAssessment = editAssessment;
window.deleteAssessment = deleteAssessment;
window.closePageModal = closePageModal;
window.movePageUp = movePageUp;
window.movePageDown = movePageDown;
window.closeAssessmentModal = closeAssessmentModal;
window.addNewTool = addNewTool;
window.editTool = editTool;
window.deleteTool = deleteTool;
window.closeToolModal = closeToolModal;
window.saveTool = saveTool;
window.removeImage = removeImage;
window.logout = logout;
window.closeLogoutModal = closeLogoutModal;
window.confirmLogout = confirmLogout;
window.deleteLesson = deleteLesson;
window.closeDeleteModal = closeDeleteModal;
window.confirmDelete = confirmDelete;
window.closeAlertModal = closeAlertModal;

// ============================================
// Modal Close Handlers
// ============================================

window.onclick = function(event) {
    const modals = ['toolModal', 'logoutModal', 'deleteModal', 'alertModal', 'pageModal', 'assessmentModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (event.target === modal) {
            if (modalId === 'toolModal') closeToolModal();
            else if (modalId === 'logoutModal') closeLogoutModal();
            else if (modalId === 'deleteModal') closeDeleteModal();
            else if (modalId === 'alertModal') closeAlertModal();
            else if (modalId === 'pageModal') closePageModal();
            else if (modalId === 'assessmentModal') closeAssessmentModal();
        }
    });
};

// ============================================
// Initialize on DOM Ready
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    try {
    initErrorMessageContainer();
    setupImageHandlers();
    initializeEditor();
    } catch (error) {
        console.error('Initialization error:', error);
        alert('Error initializing editor: ' + error.message);
    }
});
