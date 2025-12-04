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
let currentToolModelFile = null;
let isDirty = false; // Track unsaved changes
let pendingNavigateToLessons = false;
let pageContentEditor = null; // Quill editor instance

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

// Mark as dirty on input changes
function markDirty() {
    isDirty = true;
}

function setupDirtyListeners() {
    const inputs = document.querySelectorAll('input, textarea, select, .rich-text-editor');
    inputs.forEach(input => {
        input.addEventListener('change', markDirty);
        input.addEventListener('input', markDirty);
    });
    
    // Observer for rich text editor changes
    const richText = document.getElementById('lessonBody');
    if (richText) {
        const observer = new MutationObserver(markDirty);
        observer.observe(richText, { childList: true, characterData: true, subtree: true });
    }
}

function checkUnsavedAndGoBack() {
    if (isDirty) {
        pendingNavigateToLessons = true;
        const modal = document.getElementById('unsavedChangesModal');
        if (modal) modal.style.display = 'flex';
    } else {
        goBack();
    }
}

function closeUnsavedChangesModal() {
    const modal = document.getElementById('unsavedChangesModal');
    if (modal) modal.style.display = 'none';
    // If we close it without choosing, we probably shouldn't navigate, so reset pending flag?
    // Usually closing via outside click implies "Cancel/Stay".
    pendingNavigateToLessons = false; 
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
            introVideoUrl: null,
            introVideoStoragePath: null,
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
    setupDirtyListeners();
    setupAutoNumbering();
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
    const videoPreviewEl = document.getElementById('introVideoPreview');
    
    if (slotEl) slotEl.value = currentLesson.slot || '';
    if (titleEl) titleEl.value = currentLesson.lessonTitle || currentLesson.lessonName || '';
    if (descEl) descEl.value = currentLesson.description || currentLesson.lessonDescription || '';
    if (bodyEl) bodyEl.innerHTML = currentLesson.body || currentLesson.content || '';
    if (statusEl) statusEl.value = (currentLesson.status || 'draft');
    
    // Load intro video preview if exists
    if (videoPreviewEl) {
        if (currentLesson.introVideoUrl) {
            videoPreviewEl.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: #F9FAFB; border: 1px solid #E2E8F0; border-radius: 6px;">
                    <i class="fas fa-video" style="color: #C19A6B;"></i>
                    <div style="flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        Video attached
                    </div>
                    <a href="${currentLesson.introVideoUrl}" target="_blank" style="font-size: 12px; color: #0369a1; text-decoration: none;">View</a>
                </div>
            `;
        } else {
            videoPreviewEl.innerHTML = '';
        }
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
    if (tabName === 'pages') {
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
// Tool Instructions Auto-Numbering
// ============================================

function setupAutoNumbering() {
    const instructionsEl = document.getElementById('toolInstructions');
    if (!instructionsEl) return;

    instructionsEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            
            const cursorPosition = this.selectionStart;
            const text = this.value;
            const beforeText = text.substring(0, cursorPosition);
            const afterText = text.substring(cursorPosition);
            
            // Find the current number if the previous line had one
            const lines = beforeText.split('\n');
            const currentLine = lines[lines.length - 1];
            
            // Check if we are in a list context (heuristic: look for "1. " etc)
            // Or just scan for the highest number so far
            const matches = text.match(/^(\d+)\.\s/gm);
            let nextNum = 1;
            
            if (matches) {
                const nums = matches.map(m => parseInt(m));
                nextNum = Math.max(...nums) + 1;
            } else {
                // If no numbers found but we are pressing enter, check if we want to start list?
                // The requirement says: "Insert a newline plus the next number and a space"
                // If new tool and empty, it initializes with "1. ".
            }
            
            // Only auto-number if the previous line looked like a list item or we just want to continue
            // Simplified approach as per req: scan each line that starts with <number>. 
            
            const nextStepStr = `\n${nextNum}. `;
            
            this.value = beforeText + nextStepStr + afterText;
            this.selectionStart = this.selectionEnd = cursorPosition + nextStepStr.length;
            
            // Trigger dirty check
            markDirty();
        }
    });
}

// Update addNewTool to init instructions
const originalAddNewTool = addNewTool;
addNewTool = function() {
    originalAddNewTool();
    const instructionsEl = document.getElementById('toolInstructions');
    if (instructionsEl && !instructionsEl.value) {
        instructionsEl.value = '1. ';
    }
}

// ============================================
// Image Management (Removed for Lesson Content, kept helper if needed)
// ============================================

function setupImageHandlers() {
    // Only tool 3D model handler remains
    const tool3DModelInput = document.getElementById('tool3DModel');
    if (tool3DModelInput) {
        tool3DModelInput.addEventListener('change', (e) => {
            currentToolModelFile = e.target.files && e.target.files[0] ? e.target.files[0] : null;
            
            // Basic validation preview text
            const preview = document.getElementById('tool3DModelPreview');
            if (preview) {
                if (currentToolModelFile) {
                    preview.innerHTML = `<p style="color: #64748B; font-size: 12px;">Selected: ${currentToolModelFile.name} (${(currentToolModelFile.size / 1024 / 1024).toFixed(2)} MB)</p>`;
                } else {
                    preview.innerHTML = '';
                }
            }
        });
    }
}

function displaySupportingImages(images) {
    // Deprecated for lesson content
}

function removeImage(button) {
    // Deprecated for lesson content
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
        // Determine if it has a 3D model
        const hasModel = (tool.modelUrl || tool.storagePath || (tool.model && (tool.model.url || tool.model.storagePath))) ? true : false;
        
        // Determine thumbnail
        let thumbSrc = tool.imageUrl || tool.imageURL;
        let thumbContent = '';
        
        if (thumbSrc) {
            thumbContent = `<img src="${thumbSrc}" alt="${tool.name}" style="width: 100%; height: 100%; object-fit: cover;">`;
        } else {
            thumbContent = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; background: #F3F4F6; color: #9CA3AF;">
                    <i class="fas fa-wrench" style="font-size: 32px; margin-bottom: 8px;"></i>
                    <span style="font-size: 12px; font-weight: 500;">No Preview</span>
                </div>
            `;
        }

        return `
        <div class="tool-card" data-tool-id="${toolId}" style="position: relative; display: flex; flex-direction: column; background: white; border: 1px solid #E5E7EB; border-radius: 12px; overflow: hidden; transition: all 0.2s;">
            <!-- 3D Badge -->
            ${hasModel ? `
            <div style="position: absolute; top: 12px; right: 12px; background: rgba(255,255,255,0.9); color: #0369a1; padding: 4px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); z-index: 2;">
                <i class="fas fa-cube"></i> 3D
            </div>` : ''}
            
            <!-- Thumbnail -->
            <div style="height: 160px; width: 100%; border-bottom: 1px solid #E5E7EB;">
                ${thumbContent}
            </div>
            
            <!-- Content -->
            <div style="padding: 16px; flex: 1; display: flex; flex-direction: column;">
                <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #1F2937;">${tool.name || 'Unnamed Tool'}</h3>
                <p style="margin: 0 0 12px 0; font-size: 13px; color: #6B7280; line-height: 1.5; flex: 1; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
                    ${tool.description || 'No description'}
                </p>
                ${tool.category ? `<div style="margin-bottom: 12px;"><span style="font-size: 11px; padding: 2px 8px; background: #F3F4F6; border-radius: 4px; color: #4B5563;">${tool.category}</span></div>` : ''}
                
                <!-- Actions -->
                <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: auto; padding-top: 12px; border-top: 1px solid #F3F4F6;">
                    ${hasModel ? `
                    <button class="btn-secondary" onclick="view3DModel('${toolId}')" style="padding: 6px 10px; font-size: 12px;">
                        <i class="fas fa-cube"></i> View 3D
                    </button>` : ''}
                    <button class="btn-tool-edit" onclick="editTool('${toolId}')" style="padding: 6px 10px; font-size: 12px; border: 1px solid #E5E7EB; background: white; border-radius: 6px; cursor: pointer;">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-tool-delete" onclick="deleteTool('${toolId}')" style="padding: 6px 10px; font-size: 12px; border: 1px solid #E5E7EB; background: white; border-radius: 6px; cursor: pointer; color: #EF4444;">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
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
    document.getElementById('tool3DModelPreview').innerHTML = '';
    currentToolModelFile = null;
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

    // 3D Model Preview in Edit Mode
    const modelPreview = document.getElementById('tool3DModelPreview');
    if (modelPreview) {
        if (tool.model && tool.model.url) {
            modelPreview.innerHTML = `
                <div style="margin-top: 10px; padding: 10px; background: #f9fafb; border-radius: 8px; border: 1px solid #E2E8F0;">
                    <p style="font-size: 13px; margin: 0 0 5px 0; color: #1F2937; font-weight: 500;">
                        <i class="fas fa-cube" style="color: #0369a1;"></i> 3D Model Attached
                    </p>
                    <p style="font-size: 12px; color: #64748B; margin: 0 0 10px 0;">
                        Format: ${tool.model.format || 'Unknown'}
                    </p>
                    <div style="display: flex; gap: 10px;">
                        <span style="font-size: 12px; color: #64748B;">Preview temporarily disabled.</span>
                    </div>
                </div>`;
        } else {
            modelPreview.innerHTML = '';
        }
    }
    
    currentToolModelFile = null; // Reset selected file on edit open
    document.getElementById('toolModal').style.display = 'flex';
}

function closeToolModal() {
    document.getElementById('toolModal').style.display = 'none';
}

async function saveTool(event) {
    event.preventDefault();
    
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.textContent : 'Save Tool';
    
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
    }

    try {
        const toolId = document.getElementById('toolId').value || Date.now().toString();
        const tool = {
            name: document.getElementById('toolName').value.trim(),
            description: document.getElementById('toolDescription').value.trim(),
            category: document.getElementById('toolCategory').value,
            instructions: document.getElementById('toolInstructions').value.trim()
        };
        
        // Handle 2D Image
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
        
        // Handle 3D Model Upload
        if (currentToolModelFile) {
            if (submitBtn) submitBtn.textContent = 'Uploading 3D Model...';
            console.log('Starting 3D model upload...', currentToolModelFile.name);
            
            const formData = new FormData();
            formData.append('modelFile', currentToolModelFile);
            formData.append('lessonSlot', currentLessonSlot || 'unassigned');
            formData.append('toolId', toolId);

            const uploadResponse = await fetch(`${API_BASE}/tools/upload-model`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                },
                body: formData
            });

            if (!uploadResponse.ok) {
                const errorText = await uploadResponse.text();
                console.error('Upload failed response:', errorText);
                let errorMessage = 'Failed to upload 3D model';
                try {
                    const errorJson = JSON.parse(errorText);
                    errorMessage = errorJson.error || errorJson.message || errorMessage;
                } catch (e) {
                    errorMessage += ` (Status ${uploadResponse.status})`;
                }
                throw new Error(errorMessage);
            }

            const modelData = await uploadResponse.json();
            console.log('Upload success:', modelData);
            
            // Map the response + local file info to the structure requested
            tool.modelUrl = modelData.modelUrl;
            tool.storagePath = modelData.storagePath;
            tool.modelFileName = currentToolModelFile.name;
            tool.modelMimeType = currentToolModelFile.type || 'application/octet-stream';
            tool.modelSizeBytes = currentToolModelFile.size;
            
            // Also keep the old structure nested for backward compatibility if needed, 
            // but top-level fields are what were requested.
            tool.model = {
                url: modelData.modelUrl,
                storagePath: modelData.storagePath,
                format: modelData.format
            };
        } else if (currentTools[toolId] && (currentTools[toolId].modelUrl || currentTools[toolId].storagePath)) {
            // Preserve existing model data if no new one selected
            tool.modelUrl = currentTools[toolId].modelUrl;
            tool.storagePath = currentTools[toolId].storagePath;
            tool.modelFileName = currentTools[toolId].modelFileName;
            tool.modelMimeType = currentTools[toolId].modelMimeType;
            tool.modelSizeBytes = currentTools[toolId].modelSizeBytes;
            tool.model = currentTools[toolId].model;
        } else if (currentTools[toolId] && currentTools[toolId].model) {
             // Fallback for old structure
             tool.model = currentTools[toolId].model;
             tool.modelUrl = tool.model.url;
             tool.storagePath = tool.model.storagePath;
        }
        
        currentTools[toolId] = tool;
        currentLesson = currentLesson || {};
        currentLesson.tools = { ...currentTools };
        
        closeToolModal();
        loadTools();
        showSuccess('Tool saved. Remember to save the lesson to persist changes.');
    } catch (error) {
        console.error('Save tool error:', error);
        showError(error.message || 'Failed to save tool');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
        currentToolModelFile = null;
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
    const introVideoEl = document.getElementById('lessonIntroVideo');
    
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
    
    // Resolve lesson slot first if new
    let lessonSlot = currentLessonSlot || slot;
    
    if (isNew && !lessonSlot) {
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

    // Handle Video Upload if file selected
    let introVideoUrl = currentLesson?.introVideoUrl || null;
    let introVideoStoragePath = currentLesson?.introVideoStoragePath || null;

    if (introVideoEl && introVideoEl.files && introVideoEl.files[0]) {
        const videoFile = introVideoEl.files[0];
        try {
            // Show saving status
            const saveBtn = document.querySelector('button[onclick="saveLesson()"]');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Uploading Video...';
            }

            const formData = new FormData();
            formData.append('videoFile', videoFile);
            formData.append('lessonSlot', lessonSlot);

            const uploadResponse = await fetch(`${API_BASE}/lessons/upload-intro`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                },
                body: formData
            });

            if (!uploadResponse.ok) {
                throw new Error('Video upload failed');
            }

            const videoData = await uploadResponse.json();
            introVideoUrl = videoData.introVideoUrl;
            introVideoStoragePath = videoData.introVideoStoragePath;

        } catch (error) {
            console.error('Video upload error:', error);
            showError('Failed to upload intro video: ' + error.message);
            const saveBtn = document.querySelector('button[onclick="saveLesson()"]');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Lesson';
            }
            return;
        }
    }

    const toolsPayload = {};
    Object.entries(currentTools || {}).forEach(([toolId, tool]) => {
        toolsPayload[toolId] = { ...tool };
    });
    
    try {
        const saveBtn = document.querySelector('button[onclick="saveLesson()"]');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving Lesson...';
        }

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
                images: [], // Removed supporting images
                tools: toolsPayload,
                status,
                introVideoUrl,
                introVideoStoragePath
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
                introVideoUrl,
                introVideoStoragePath,
                tools: toolsPayload,
                status
            };
            currentTools = toolsPayload;
            isDirty = false; // Clear dirty flag on success
            
            const isNewElUpdated = document.getElementById('isNewLesson');
            if (isNewElUpdated) isNewElUpdated.value = 'false';
            const titleHeader = document.getElementById('editorPageTitle');
            if (titleHeader) titleHeader.textContent = `Edit Lesson ${lessonSlot}`;
            const deleteBtn = document.getElementById('topDeleteBtn');
            if (deleteBtn) deleteBtn.style.display = 'block';
            const slotInput = document.getElementById('lessonSlot');
            if (slotInput) slotInput.value = lessonSlot;
            
            window.history.replaceState({}, '', `/admin-lesson-editor?slot=${lessonSlot}&action=edit&tab=${currentTab}`);
            loadLessonData();
            // Reload pages if we're on the pages tab
            if (currentTab === 'pages') {
                loadPages();
            }
            
            if (pendingNavigateToLessons) {
                goBack();
                pendingNavigateToLessons = false;
            } else {
            showSuccess('Lesson saved successfully');
            }
        }
    } catch (error) {
        console.error('Save lesson error:', error);
        showError(error.message || 'Failed to save lesson');
    } finally {
        const saveBtn = document.querySelector('button[onclick="saveLesson()"]');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Lesson';
        }
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
    
    // Initialize or reset Quill editor
    initializePageEditor();
    if (pageContentEditor) {
        pageContentEditor.setContents([]);
    }
    
    document.getElementById('pageModal').style.display = 'flex';
}

function editPage(pageId) {
    const page = allPages.find(p => p.id === pageId);
    if (!page) return;
    
    document.getElementById('pageModalTitle').textContent = 'Edit Page';
    document.getElementById('pageId').value = pageId;
    document.getElementById('pageTitle').value = page.title || '';
    
    // Initialize or update Quill editor with existing content
    initializePageEditor();
    if (pageContentEditor) {
        // If content is HTML, set it directly; if plain text, convert to HTML
        const content = page.content || '';
        if (content.trim()) {
            // Check if content is HTML (contains tags)
            if (content.includes('<') && content.includes('>')) {
                // It's HTML, set it directly
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = content;
                pageContentEditor.root.innerHTML = content;
            } else {
                // It's plain text, convert to HTML paragraphs
                const paragraphs = content.split('\n').filter(p => p.trim());
                if (paragraphs.length > 0) {
                    const htmlContent = paragraphs.map(p => `<p>${p}</p>`).join('');
                    pageContentEditor.root.innerHTML = htmlContent;
                } else {
                    pageContentEditor.setContents([]);
                }
            }
        } else {
            pageContentEditor.setContents([]);
        }
    }
    
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
    
    // Get HTML content from Quill editor
    let content = '';
    if (pageContentEditor) {
        content = pageContentEditor.root.innerHTML.trim();
        // If empty, set to empty paragraph
        if (!content) {
            content = '<p></p>';
        }
    } else {
        // Fallback if editor not initialized
        const editorEl = document.getElementById('pageContentEditor');
        if (editorEl) {
            content = editorEl.innerHTML.trim() || '<p></p>';
        } else {
            content = '<p></p>';
        }
    }
    
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

// Initialize Quill editor for page content
function initializePageEditor() {
    const editorContainer = document.getElementById('pageContentEditor');
    if (!editorContainer) {
        console.warn('Page content editor container not found');
        return;
    }
    
    // Check if Quill is available
    if (typeof Quill === 'undefined') {
        console.error('Quill.js is not loaded. Please ensure the Quill.js script is included in the page.');
        return;
    }
    
    // If editor already exists, don't reinitialize
    if (pageContentEditor) {
        return;
    }
    
    // Wait a bit for DOM to be ready
    setTimeout(() => {
        try {
            // Initialize Quill editor
            pageContentEditor = new Quill('#pageContentEditor', {
                theme: 'snow',
                modules: {
                    toolbar: [
                        [{ 'header': [1, 2, 3, 4, false] }],
                        ['bold', 'italic', 'underline'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        ['blockquote', 'code-block'],
                        ['link', 'image'],
                        [{ 'align': [] }],
                        ['clean']
                    ]
                },
                placeholder: 'Enter the content for this page...'
            });
            
            // Track changes for dirty flag
            if (pageContentEditor) {
                pageContentEditor.on('text-change', markDirty);
            }
        } catch (error) {
            console.error('Error initializing Quill editor:', error);
        }
    }, 100);
}

function closePageModal() {
    document.getElementById('pageModal').style.display = 'none';
    // Don't destroy the editor, just keep it for next use
    // The editor will be reset when opening add/edit
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
    
    // Tools section HTML
    let toolsHtml = '';
    const toolsList = Object.values(currentTools || {});
    
    if (toolsList.length > 0) {
        toolsHtml = `
            <div class="preview-tools-section" style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px;">
                <h3 style="font-size: 20px; margin-bottom: 15px;">Tools Used</h3>
                <div class="preview-tools-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px;">
                    ${toolsList.map(tool => `
                        <div class="preview-tool-card" style="border: 1px solid #eee; border-radius: 8px; padding: 15px; background: #fff;">
                            ${tool.imageUrl ? `<img src="${tool.imageUrl}" alt="${tool.name}" style="width: 100%; height: 150px; object-fit: cover; border-radius: 4px; margin-bottom: 10px;">` : ''}
                            <h4 style="margin: 0 0 5px 0; font-size: 16px;">${tool.name}</h4>
                            <p style="font-size: 13px; color: #666; margin-bottom: 10px;">${tool.description || ''}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    previewContent.innerHTML = `
        <div class="preview-lesson">
            <h1 class="preview-title">${escapeHtml(title || 'Untitled Lesson')}</h1>
            <p class="preview-description">${escapeHtml(description || 'No description')}</p>
            <div class="preview-body">${body || '<p>No content yet</p>'}</div>
            ${toolsHtml}
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

async function confirmDelete() {
    const slot = currentLessonSlot || document.getElementById('lessonSlot')?.value;
    
    if (!slot) {
        showError('No lesson slot found');
        closeDeleteModal();
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/lessons/${slot}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to delete lesson');
        }
        
        showSuccess('Lesson deleted successfully');
        closeDeleteModal();
        
        // Navigate back to lessons list after a short delay
        setTimeout(() => {
            window.location.href = '/admin-lessons';
        }, 1000);
        
    } catch (error) {
        console.error('Delete lesson error:', error);
        showError(error.message || 'Failed to delete lesson');
        closeDeleteModal();
    }
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
// 3D Preview Logic
// ============================================

function view3DModel(toolId) {
    const tool = currentTools[toolId];
    if (!tool) {
        alert("Tool not found.");
        return;
    }

    // Prefer storagePath, fallback to modelUrl if available (but proxy route expects storage path usually)
    const modelPath = tool.storagePath || (tool.model && tool.model.storagePath);
    
    if (!modelPath) {
        alert("No 3D model file path available for this tool.");
        return;
    }

    const modal = document.getElementById("tool3DPreviewModal");
    const titleEl = document.getElementById("tool3DPreviewTitle");
    const viewer = document.getElementById("toolModelViewer");
    const errorEl = document.getElementById("tool3DPreviewError");

    if (!modal || !viewer) {
        console.error("3D preview modal elements not found.");
        alert("3D preview is not available.");
        return;
    }

    // Reset state
    if (errorEl) errorEl.textContent = "";
    if (titleEl) titleEl.textContent = `3D Preview: ${tool.name || "Tool"}`;

    // Show loading overlay
    const loadingOverlay = document.getElementById("modelLoadingOverlay");
    if (loadingOverlay) loadingOverlay.style.display = "flex";

    // Build proxied URL
    // Ensure modelPath is URL encoded
    const srcUrl = `/api/admin/tools/model?path=${encodeURIComponent(modelPath)}`;

    // Setup viewer
    // Remove existing error listeners to avoid duplicates
    const newHandleError = (event) => {
        console.error("model-viewer failed to load model:", event);
        if (loadingOverlay) loadingOverlay.style.display = "none";
        if (errorEl) {
            errorEl.textContent = "Failed to load 3D model. Please check the file or try again.";
        }
    };

    const newHandleLoad = (event) => {
        console.log("model-viewer loaded");
        if (loadingOverlay) loadingOverlay.style.display = "none";
    };

    // Reset handlers
    viewer.removeEventListener('error', viewer._errorHandler);
    viewer.removeEventListener('load', viewer._loadHandler);
    
    viewer._errorHandler = newHandleError;
    viewer._loadHandler = newHandleLoad;
    
    viewer.addEventListener('error', newHandleError);
    viewer.addEventListener('load', newHandleLoad);

    viewer.src = srcUrl;
    
    openModal("tool3DPreviewModal");
}

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = "flex";
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = "none";
        // Stop video/audio if any (for model viewer, clearing src stops loading)
        if (id === 'tool3DPreviewModal') {
            const viewer = document.getElementById("toolModelViewer");
            if (viewer) viewer.src = '';
            const loadingOverlay = document.getElementById("modelLoadingOverlay");
            if (loadingOverlay) loadingOverlay.style.display = "none";
        }
    }
}

window.view3DModel = view3DModel;
window.openModal = openModal;
window.closeModal = closeModal;
window.checkUnsavedAndGoBack = checkUnsavedAndGoBack; // Export for HTML button
window.addNewTool = addNewTool; // Export wrapped function

// ============================================
// Modal Close Handlers
// ============================================

window.onclick = function(event) {
    const modals = ['toolModal', 'logoutModal', 'deleteModal', 'alertModal', 'pageModal', 'assessmentModal', 'tool3DPreviewModal', 'unsavedChangesModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (event.target === modal) {
            if (modalId === 'toolModal') closeToolModal();
            else if (modalId === 'logoutModal') closeLogoutModal();
            else if (modalId === 'deleteModal') closeDeleteModal();
            else if (modalId === 'alertModal') closeAlertModal();
            else if (modalId === 'pageModal') closePageModal();
            else if (modalId === 'assessmentModal') closeAssessmentModal();
            else if (modalId === 'tool3DPreviewModal') closeModal(modalId);
            else if (modalId === 'unsavedChangesModal') closeUnsavedChangesModal();
        }
    });
};

// ============================================
// Initialize on DOM Ready
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    try {
        // Unsaved Changes Modal Buttons
        const unsavedDiscardBtn = document.getElementById('unsavedDiscardBtn');
        if (unsavedDiscardBtn) {
            unsavedDiscardBtn.addEventListener('click', function() {
                closeUnsavedChangesModal();
                isDirty = false;
                goBack();
            });
        }

        const unsavedSaveBtn = document.getElementById('unsavedSaveBtn');
        if (unsavedSaveBtn) {
            unsavedSaveBtn.addEventListener('click', function() {
                const modal = document.getElementById('unsavedChangesModal');
                if (modal) modal.style.display = 'none';
                // pendingNavigateToLessons is already true from checkUnsavedAndGoBack
                saveLesson();
            });
        }

    initErrorMessageContainer();
    setupImageHandlers();
    initializeEditor();
    } catch (error) {
        console.error('Initialization error:', error);
        alert('Error initializing editor: ' + error.message);
    }
});
