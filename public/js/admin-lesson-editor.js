// Admin Lesson Editor - API Integration
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

// Current lesson data
let currentLesson = null;
let currentTools = {};
let currentTab = defaultTab;
let currentLessonSlot = slot;

const MODEL_ALLOWED_EXTENSIONS = ['fbx', 'glb', 'gltf', 'obj', 'stl'];
const MODEL_CONVERTIBLE_EXTENSIONS = ['fbx', 'obj', 'stl'];
const MAX_MODEL_FILE_SIZE = 50 * 1024 * 1024;
const MODEL_CONTENT_TYPES = {
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    obj: 'text/plain',
    fbx: 'application/octet-stream',
    stl: 'model/stl'
};

let pendingModelUploadBlob = null;
let pendingModelUploadExtension = '';
let pendingModelUploadFileName = '';
let pendingOriginalModelType = '';
let pendingModelFileSize = 0;
let pendingModelPreviewUrl = null;
let modelSelectionToken = 0;

// Error message container
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

function disposeModelPreview() {
    cleanupPendingModelPreview();
    const container = document.getElementById('tool3DModelPreview');
    if (container) {
        container.innerHTML = '<div class="model-preview-empty">No 3D model selected</div>';
    }
}

function cleanupPendingModelPreview() {
    if (pendingModelPreviewUrl && pendingModelPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(pendingModelPreviewUrl);
    }
    pendingModelPreviewUrl = null;
}

function resetModelSelectionState() {
    cleanupPendingModelPreview();
    pendingModelUploadBlob = null;
    pendingModelUploadExtension = '';
    pendingModelUploadFileName = '';
    pendingOriginalModelType = '';
    pendingModelFileSize = 0;
}

function setModelUploadSpinner(isVisible, text = 'Uploading 3D model...') {
    const spinner = document.getElementById('toolUploadSpinner');
    const spinnerText = document.getElementById('toolUploadSpinnerText');
    if (spinner && spinnerText) {
        spinnerText.textContent = text;
        spinner.classList.toggle('hidden', !isVisible);
    }
    
    const modelUploadSpinner = document.getElementById('modelUploadSpinner');
    const modelUploadSpinnerText = document.getElementById('modelUploadSpinnerText');
    if (modelUploadSpinner && modelUploadSpinnerText) {
        modelUploadSpinnerText.textContent = text;
        modelUploadSpinner.classList.toggle('hidden', !isVisible);
    }
}

function showModelPreviewMessage(message) {
    const container = document.getElementById('tool3DModelPreview');
    if (container) {
        container.innerHTML = `<div class="model-preview-empty">${message || 'No 3D model selected'}</div>`;
    }
}

function renderModelViewerPreview(src) {
    const container = document.getElementById('tool3DModelPreview');
    if (!container) return;
    container.innerHTML = `
        <model-viewer
            src="${src}"
            auto-rotate
            camera-controls
            shadow-intensity="1"
            style="width: 100%; height: 260px; background: #F8FAFC; border-radius: 12px;"
        >
        </model-viewer>
    `;
}

function setModelFileLabels({ fileName = '', downloadUrl = '' } = {}) {
    if (toolModelFileLabel) {
        if (fileName) {
            toolModelFileLabel.textContent = fileName;
            toolModelFileLabel.classList.remove('hidden');
        } else {
            toolModelFileLabel.textContent = '';
            toolModelFileLabel.classList.add('hidden');
        }
    }
    if (toolModelUrlDisplay) {
        if (downloadUrl) {
            toolModelUrlDisplay.innerHTML = `<a href="${downloadUrl}" target="_blank" rel="noopener">View stored model</a>`;
            toolModelUrlDisplay.classList.remove('hidden');
        } else {
            toolModelUrlDisplay.textContent = '';
            toolModelUrlDisplay.classList.add('hidden');
        }
    }
}

function validateModelFile(file) {
    if (!file) {
        return { valid: false, message: 'No file selected' };
    }
    const extension = getModelExtension(file.name);
    if (!extension || !MODEL_ALLOWED_EXTENSIONS.includes(extension)) {
        return { valid: false, extension, message: 'Unsupported 3D model format. Allowed: FBX, OBJ, GLB, GLTF, STL.' };
    }
    if (file.size > MAX_MODEL_FILE_SIZE) {
        return { valid: false, extension, message: '3D model exceeds the 50MB limit.' };
    }
    return { valid: true, extension };
}

function getContentTypeByExtension(ext = '') {
    return MODEL_CONTENT_TYPES[ext] || 'application/octet-stream';
}

function replaceFileExtension(fileName = '', newExt = '.glb') {
    if (!fileName) return `model${newExt}`;
    if (fileName.includes('.')) {
        return fileName.replace(/\.[^/.]+$/, newExt);
    }
    return `${fileName}${newExt}`;
}

async function convertModelIfNeeded(file, extension) {
    if (!MODEL_CONVERTIBLE_EXTENSIONS.includes(extension)) {
        return {
            blob: file,
            extension,
            fileName: file.name
        };
    }

    if (typeof THREE === 'undefined' || typeof THREE.GLTFExporter === 'undefined') {
        throw new Error('3D conversion libraries not loaded');
    }

    const exporter = new THREE.GLTFExporter();

    const exportToGlb = (object) => {
        return new Promise((resolve, reject) => {
            try {
                exporter.parse(
                    object,
                    (result) => {
                        if (result instanceof ArrayBuffer) {
                            resolve(new Blob([result], { type: 'model/gltf-binary' }));
                        } else if (result && typeof result === 'object') {
                            resolve(new Blob([JSON.stringify(result)], { type: 'application/json' }));
                        } else {
                            reject(new Error('Unexpected GLTF export result'));
                        }
                    },
                    { binary: true }
                );
            } catch (error) {
                reject(error);
            }
        });
    };

    let objectForExport = null;

    if (extension === 'fbx') {
        const buffer = await file.arrayBuffer();
        const loader = new THREE.FBXLoader();
        objectForExport = loader.parse(buffer, file.name);
    } else if (extension === 'obj') {
        const textContent = await file.text();
        const loader = new THREE.OBJLoader();
        objectForExport = loader.parse(textContent);
    } else if (extension === 'stl') {
        const buffer = await file.arrayBuffer();
        const loader = new THREE.STLLoader();
        const geometry = loader.parse(buffer);
        const material = new THREE.MeshStandardMaterial({ color: 0xd1d5db });
        objectForExport = new THREE.Mesh(geometry, material);
    }

    if (!objectForExport) {
        throw new Error('Unable to prepare 3D object for conversion');
    }

    const glbBlob = await exportToGlb(objectForExport);
    return {
        blob: glbBlob,
        extension: 'glb',
        fileName: replaceFileExtension(file.name, '.glb')
    };
}

async function handleModelFileSelection(file) {
    const validation = validateModelFile(file);
    if (!validation.valid) {
        showAlertModal(validation.message, 'Invalid File');
        return;
    }

    modelSelectionToken += 1;
    const selectionId = modelSelectionToken;

    pendingOriginalModelType = validation.extension;
    setModelFileLabels({ fileName: file.name });
    if (toolModelUrlDisplay) {
        toolModelUrlDisplay.classList.add('hidden');
    }

    showModelPreviewMessage('Preparing 3D preview...');
    setModelUploadSpinner(true, MODEL_CONVERTIBLE_EXTENSIONS.includes(validation.extension) ? 'Converting 3D model...' : 'Preparing preview...');

    try {
        const { blob, extension, fileName } = await convertModelIfNeeded(file, validation.extension);
        if (selectionId !== modelSelectionToken) {
            return;
        }

        pendingModelUploadBlob = blob;
        pendingModelUploadExtension = extension;
        pendingModelUploadFileName = fileName;
        pendingModelFileSize = blob.size;

        cleanupPendingModelPreview();
        pendingModelPreviewUrl = URL.createObjectURL(blob);
        renderModelViewerPreview(pendingModelPreviewUrl);
    } catch (error) {
        if (selectionId !== modelSelectionToken) {
            return;
        }
        console.error('3D model processing error:', error);
        resetModelSelectionState();
        setModelFileLabels();
        showModelPreviewMessage('Unable to preview this 3D model.');
        showError('Failed to process the selected 3D model. Please try a different file.');
    } finally {
        if (selectionId === modelSelectionToken) {
            setModelUploadSpinner(false);
        }
    }
}

async function uploadToolModelBlob(lessonSlotValue, toolId, blob, fileName, extension) {
    if (!blob) {
        throw new Error('3D model data missing');
    }

    const payload = {
        fileName: fileName || replaceFileExtension(toolId, '.glb'),
        contentType: getContentTypeByExtension(extension),
        data: await blobToBase64(blob)
    };

    const response = await fetch(`${API_BASE}/lessons/${lessonSlotValue}/tools/${toolId}/model`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('adminToken');
        window.location.href = '/admin-login';
        return Promise.reject(new Error('Unauthorized'));
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to upload 3D model');
    }

    return response.json();
}

async function loadModelPreviewFromStoredData(url, type) {
    resetModelSelectionState();
    if (!url || !type) {
        showModelPreviewMessage('No 3D model selected');
        return;
    }
    if (MODEL_CONVERTIBLE_EXTENSIONS.includes(type.toLowerCase())) {
        showModelPreviewMessage('Preview available after re-upload as GLB/GLTF.');
        return;
    }
    renderModelViewerPreview(url);
}

function getModelExtension(fileName = '') {
    const parts = fileName.toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : null;
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            resolve(null);
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result || '';
            if (typeof result === 'string') {
                const base64 = result.includes(',') ? result.split(',')[1] : result;
                resolve(base64);
            } else {
                reject(new Error('Unable to encode file'));
            }
        };
        reader.onerror = () => reject(new Error('Failed to encode file'));
        reader.readAsDataURL(blob);
    });
}

let toolModelFileLabel = null;
let toolModelUrlDisplay = null;

function setupModelInputHandler() {
    const modelInput = document.getElementById('tool3DModel');
    toolModelFileLabel = document.getElementById('tool3DModelFileName');
    toolModelUrlDisplay = document.getElementById('tool3DModelUrl');
    if (!modelInput) return;

    modelInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            handleModelFileSelection(file);
        }
    });
}

// Initialize editor
async function initializeEditor() {
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
            tools: {}
        };
        currentLessonSlot = null;
        const titleEl = document.getElementById('editorPageTitle');
        if (titleEl) titleEl.textContent = 'Create New Lesson';
        const isNewEl = document.getElementById('isNewLesson');
        if (isNewEl) isNewEl.value = 'true';
    }

    switchTab(currentTab);
    loadTools();
}

async function fetchNextLessonSlot() {
    try {
        const response = await fetch(`${API_BASE}/lessons`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error('Failed to fetch lessons');
        }
        const data = await response.json();
        const slots = Array.isArray(data.lessons)
            ? data.lessons.map(l => l.slot).filter((value) => Number.isFinite(value))
            : [];
        return slots.length > 0 ? Math.max(...slots) + 1 : 1;
    } catch (error) {
        console.error('Next lesson slot error:', error);
        return currentLessonSlot || slot || 1;
    }
}

async function ensureLessonSlotValue(forceFetch = false) {
    if (!forceFetch) {
        if (currentLessonSlot) return currentLessonSlot;
        if (slot) {
            currentLessonSlot = slot;
            return slot;
        }
        const slotInput = document.getElementById('lessonSlot');
        if (slotInput && slotInput.value) {
            const parsed = parseInt(slotInput.value, 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
                currentLessonSlot = parsed;
                slot = parsed;
                return parsed;
            }
        }
    }

    const nextSlot = await fetchNextLessonSlot();
    currentLessonSlot = nextSlot;
    slot = nextSlot;
    const slotInput = document.getElementById('lessonSlot');
    if (slotInput) slotInput.value = nextSlot;
    return nextSlot;
}

// Load lesson from API
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
    
    if (slotEl) slotEl.value = currentLesson.slot || '';
    if (titleEl) titleEl.value = currentLesson.lessonTitle || currentLesson.lessonName || '';
    if (descEl) descEl.value = currentLesson.description || currentLesson.lessonDescription || '';
    if (bodyEl) bodyEl.innerHTML = currentLesson.body || currentLesson.content || '';
    
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

// Tab Management
function switchTab(tabName) {
    currentTab = tabName;
    
    document.querySelectorAll('.editor-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.editor-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const tabContent = document.getElementById(`${tabName}Tab`);
    const tabButton = document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
    
    if (tabContent) tabContent.classList.add('active');
    if (tabButton) tabButton.classList.add('active');
    
    if (tabName === 'preview') {
        renderPreview();
    }
}

// Rich Text Editor Functions
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

// Image Management
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

// Tools Management
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
        const modelType = tool.modelType || tool.modelUrl ? (tool.modelType || (tool.modelUrl ? 'unknown' : null)) : null;
        const modelBadge = modelType ? `<span class="tool-model-badge" style="display: inline-block; padding: 4px 8px; background: #C19A6B; color: white; border-radius: 4px; font-size: 12px; margin-left: 8px;">3D Model: ${modelType.toUpperCase()}</span>` : '';
        const hasModel = !!(tool.modelUrl && tool.modelType);
        
        return `
        <div class="tool-card" data-tool-id="${toolId}">
            <div class="tool-card-header">
                <h3 class="tool-name">${tool.name || 'Unnamed Tool'}${modelBadge}</h3>
                <div class="tool-card-actions">
                    <button class="btn-tool-edit" onclick="editTool('${toolId}')"><i class="fas fa-edit"></i> Edit</button>
                    <button class="btn-tool-delete" onclick="deleteTool('${toolId}')"><i class="fas fa-trash"></i> Delete</button>
                </div>
            </div>
            <div class="tool-card-content">
                <p class="tool-description">${tool.description || 'No description'}</p>
                ${tool.category ? `<span class="tool-category">${tool.category}</span>` : ''}
                ${(tool.imageUrl || tool.imageURL) ? `
                    <div class="tool-image-preview">
                        <img src="${tool.imageUrl || tool.imageURL}" alt="${tool.name}">
                    </div>
                ` : ''}
                <div class="tool-3d-model-actions" style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
                    ${hasModel ? `
                        <button class="btn-tool-3d-preview" onclick="previewToolModel('${toolId}')" style="padding: 6px 12px; background: #C19A6B; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
                            <i class="fas fa-eye"></i> Preview 3D Model
                        </button>
                        <button class="btn-tool-3d-replace" onclick="replaceToolModel('${toolId}')" style="padding: 6px 12px; background: #556B2F; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
                            <i class="fas fa-exchange-alt"></i> Replace 3D Model
                        </button>
                        <button class="btn-tool-3d-delete" onclick="deleteToolModel('${toolId}')" style="padding: 6px 12px; background: #EF4444; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
                            <i class="fas fa-trash"></i> Delete 3D Model
                        </button>
                    ` : `
                        <button class="btn-tool-3d-upload" onclick="uploadToolModel('${toolId}')" style="padding: 6px 12px; background: #C19A6B; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
                            <i class="fas fa-upload"></i> Upload 3D Model
                        </button>
                    `}
                </div>
            </div>
        </div>
    `;
    }).join('');
    currentLesson = currentLesson || {};
    currentLesson.tools = currentTools;
}

function addNewTool() {
    document.getElementById('toolModalTitle').textContent = 'Add New Tool';
    document.getElementById('toolForm').reset();
    document.getElementById('toolId').value = '';
    document.getElementById('toolImagePreview').innerHTML = '';
    const modelInput = document.getElementById('tool3DModel');
    if (modelInput) modelInput.value = '';
    setModelFileLabels();
    resetModelSelectionState();
    disposeModelPreview();
    setModelUploadSpinner(false);
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
    
    const modelInput = document.getElementById('tool3DModel');
    if (modelInput) modelInput.value = '';

    setModelFileLabels({
        fileName: tool.modelFileName || '',
        downloadUrl: tool.modelUrl || ''
    });
    resetModelSelectionState();

    if (tool.modelUrl && tool.modelType) {
        loadModelPreviewFromStoredData(tool.modelUrl, tool.modelType);
    } else {
        disposeModelPreview();
    }
    
    setModelUploadSpinner(false);
    document.getElementById('toolModal').style.display = 'flex';
}

function closeToolModal() {
    document.getElementById('toolModal').style.display = 'none';
    setModelUploadSpinner(false);
    resetModelSelectionState();
    disposeModelPreview();
}

async function saveTool(event) {
    event.preventDefault();
    
    try {
        const toolId = document.getElementById('toolId').value || Date.now().toString();
        const existingTool = currentTools[toolId] || {};
        const tool = {
            ...existingTool,
            name: document.getElementById('toolName').value.trim(),
            description: document.getElementById('toolDescription').value.trim(),
            category: document.getElementById('toolCategory').value,
            instructions: document.getElementById('toolInstructions').value.trim()
        };

        const imageFile = document.getElementById('toolImage').files[0];
        if (imageFile) {
            tool.imageUrl = await readFileAsDataURL(imageFile);
        } else if (existingTool.imageUrl || existingTool.imageURL) {
            tool.imageUrl = existingTool.imageUrl || existingTool.imageURL;
        } else {
            delete tool.imageUrl;
        }

        if (pendingModelUploadBlob) {
            const lessonSlotValue = await ensureLessonSlotValue(!currentLessonSlot);
            setModelUploadSpinner(true, 'Uploading 3D model...');
            const uploadResult = await uploadToolModelBlob(
                lessonSlotValue,
                toolId,
                pendingModelUploadBlob,
                pendingModelUploadFileName || existingTool.modelFileName || replaceFileExtension(toolId, '.glb'),
                pendingModelUploadExtension || existingTool.modelType || 'glb'
            );

            tool.modelUrl = uploadResult.modelUrl;
            tool.modelType = (pendingModelUploadExtension || existingTool.modelType || 'glb').toLowerCase();
            tool.modelFileName = uploadResult.fileName || pendingModelUploadFileName || existingTool.modelFileName;
            tool.modelStoragePath = uploadResult.storagePath;
            tool.modelContentType = uploadResult.contentType || getContentTypeByExtension(tool.modelType);
            tool.modelSize = uploadResult.fileSize || pendingModelFileSize || existingTool.modelSize || 0;
            tool.originalModelType = pendingOriginalModelType || tool.originalModelType || tool.modelType;

            setModelFileLabels({
                fileName: tool.modelFileName || '',
                downloadUrl: tool.modelUrl
            });
            resetModelSelectionState();
            const modelInput = document.getElementById('tool3DModel');
            if (modelInput) modelInput.value = '';
        } else if (!tool.modelUrl && existingTool.modelUrl) {
            tool.modelUrl = existingTool.modelUrl;
            tool.modelType = existingTool.modelType;
            tool.modelFileName = existingTool.modelFileName;
            tool.modelStoragePath = existingTool.modelStoragePath;
            tool.modelContentType = existingTool.modelContentType;
            tool.modelSize = existingTool.modelSize;
            tool.originalModelType = existingTool.originalModelType || existingTool.modelType;
        } else if (!tool.modelUrl) {
            delete tool.modelType;
            delete tool.modelFileName;
            delete tool.modelStoragePath;
            delete tool.modelContentType;
            delete tool.modelSize;
            delete tool.originalModelType;
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
        setModelUploadSpinner(false);
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

// Save lesson to API
async function saveLesson() {
    const titleEl = document.getElementById('lessonTitle');
    const descEl = document.getElementById('lessonDescription');
    const bodyEl = document.getElementById('lessonBody');
    const isNewEl = document.getElementById('isNewLesson');
    
    if (!titleEl || !descEl || !bodyEl) {
        showError('Form elements not found');
        return;
    }
    
    const title = titleEl.value.trim();
    const description = descEl.value.trim();
    const body = bodyEl.innerHTML.trim();
    const isNew = isNewEl ? isNewEl.value === 'true' : true;
    
    if (!title || !description) {
        showAlertModal('Please fill in the title and description', 'Error');
        return;
    }
    
    if (!body || body === '<br>' || body === '<div><br></div>') {
        showAlertModal('Please add lesson content', 'Error');
        return;
    }
    
    // Get uploaded images from preview
    const imagePreviews = document.querySelectorAll('#supportingImagesPreview .preview-image-item img');
    const images = Array.from(imagePreviews).map(img => img.src).filter(src => src && src.trim() !== '');

    const toolsPayload = {};
    Object.entries(currentTools || {}).forEach(([toolId, tool]) => {
        toolsPayload[toolId] = { ...tool };
    });
    
    const lessonSlot = await ensureLessonSlotValue(isNew);
    
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
                tools: toolsPayload
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
                tools: toolsPayload
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
            showSuccess('Lesson saved successfully');
        }
    } catch (error) {
        console.error('Save lesson error:', error);
        showError(error.message || 'Failed to save lesson');
    }
}


function renderPreview() {
    const previewContent = document.getElementById('previewContent');
    if (!previewContent) return;
    
    const titleEl = document.getElementById('lessonTitle');
    const descEl = document.getElementById('lessonDescription');
    const bodyEl = document.getElementById('lessonBody');
    
    const title = titleEl ? titleEl.value : '';
    const description = descEl ? descEl.value : '';
    const body = bodyEl ? bodyEl.innerHTML : '';
    
    // Get current tools
    const tools = currentTools || {};
    const toolKeys = Object.keys(tools);
    
    let toolsHtml = '';
    if (toolKeys.length > 0) {
        toolsHtml = `
            <div class="preview-tools-section" style="margin-top: 32px; padding-top: 32px; border-top: 1px solid #E5E7EB;">
                <h2 style="font-size: 20px; font-weight: 600; color: #1F2937; margin-bottom: 20px;">Tools Used in This Lesson</h2>
                <div class="preview-tools-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px;">
                    ${toolKeys.map(toolId => {
                        const tool = tools[toolId];
                        const toolName = tool.name || 'Unnamed Tool';
                        const toolDesc = tool.description || 'No description';
                        const toolImage = tool.imageUrl || tool.imageURL;
                        const toolModelUrl = tool.modelUrl;
                        const toolModelType = tool.modelType;
                        const firstLetter = toolName.charAt(0).toUpperCase();
                        
                        return `
                            <div class="preview-tool-card" style="background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                                <div style="display: flex; gap: 16px; margin-bottom: 16px;">
                                    <div style="flex-shrink: 0;">
                                        ${toolImage ? 
                                            `<img src="${toolImage}" alt="${toolName}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid #E5E7EB;">` :
                                            `<div style="width: 80px; height: 80px; background: #C19A6B; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-size: 32px; font-weight: 600;">${firstLetter}</div>`
                                        }
                                    </div>
                                    <div style="flex: 1;">
                                        <h3 style="font-size: 16px; font-weight: 600; color: #1F2937; margin: 0 0 8px 0;">${toolName}</h3>
                                        <p style="font-size: 14px; color: #64748B; margin: 0; line-height: 1.5;">${toolDesc}</p>
                                        ${toolModelType ? `<span style="display: inline-block; margin-top: 8px; padding: 4px 8px; background: #C19A6B; color: white; border-radius: 4px; font-size: 11px; font-weight: 500;">3D Model: ${toolModelType.toUpperCase()}</span>` : ''}
                                    </div>
                                </div>
                                ${toolModelUrl ? `
                                    <model-viewer
                                        src="${toolModelUrl}"
                                        auto-rotate
                                        camera-controls
                                        style="width: 100%; height: 220px; background: #F9FAFB; border-radius: 8px; margin-top: 12px;"
                                    ></model-viewer>
                                ` : `
                                    <div style="padding: 20px; text-align: center; color: #9CA3AF; font-size: 14px; background: #F9FAFB; border-radius: 8px; margin-top: 12px;">No 3D model attached.</div>
                                `}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }
    
    previewContent.innerHTML = `
        <div class="preview-lesson">
            <h1 class="preview-title">${title || 'Untitled Lesson'}</h1>
            <p class="preview-description">${description || 'No description'}</p>
            <div class="preview-body">${body || '<p>No content yet</p>'}</div>
            ${toolsHtml}
        </div>
    `;
    
}

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
    // Note: Backend doesn't have delete endpoint yet, so this is a placeholder
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

// Modal close on outside click
window.onclick = function(event) {
    const modals = ['toolModal', 'logoutModal', 'deleteModal', 'alertModal', 'modelPreviewModal', 'modelUploadModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (event.target === modal) {
            if (modalId === 'toolModal') closeToolModal();
            else if (modalId === 'logoutModal') closeLogoutModal();
            else if (modalId === 'deleteModal') closeDeleteModal();
            else if (modalId === 'alertModal') closeAlertModal();
            else if (modalId === 'modelPreviewModal') closeModelPreviewModal();
            else if (modalId === 'modelUploadModal') closeModelUploadModal();
        }
    });
};

// 3D Model Management Functions
let currentModelPreviewCleanup = null;
let currentModelUploadToolId = null;

function previewToolModel(toolId) {
    const tool = currentTools[toolId];
    if (!tool || !tool.modelUrl || !tool.modelType) {
        showAlertModal('No 3D model available for this tool.', 'Error');
        return;
    }
    
    document.getElementById('modelPreviewModal').style.display = 'flex';
    const previewContainer = document.getElementById('modelPreviewContainer');
    previewContainer.innerHTML = '';
    
    // Use the unified viewer (should already be loaded via script tag in HTML)
    if (typeof renderToolModel === 'undefined') {
        console.error('renderToolModel not available. Ensure /js/common/3d-viewer.js is loaded after Three.js loaders.');
        previewContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #DC2626;">3D viewer not loaded. Please refresh the page.</div>';
        return;
    }
    
    // Verify loaders are available before rendering
    if (typeof THREE === 'undefined' || typeof THREE.FBXLoader === 'undefined' && tool.modelType && tool.modelType.toLowerCase() === 'fbx') {
        console.error('FBXLoader not available. Check script loading order.');
        previewContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #DC2626;">FBXLoader not available. Please refresh the page.</div>';
        return;
    }
    
    currentModelPreviewCleanup = renderToolModel(previewContainer, tool.modelUrl, tool.modelType);
}

function closeModelPreviewModal() {
    if (currentModelPreviewCleanup) {
        currentModelPreviewCleanup();
        currentModelPreviewCleanup = null;
    }
    document.getElementById('modelPreviewModal').style.display = 'none';
}

function uploadToolModel(toolId) {
    currentModelUploadToolId = toolId;
    document.getElementById('modelUploadModalTitle').textContent = 'Upload 3D Model';
    document.getElementById('modelUploadForm').reset();
    document.getElementById('modelUploadPreview').innerHTML = '<div class="model-preview-empty">No 3D model selected</div>';
    resetModelSelectionState();
    setModelUploadSpinner(false);
    document.getElementById('modelUploadModal').style.display = 'flex';
}

function replaceToolModel(toolId) {
    currentModelUploadToolId = toolId;
    document.getElementById('modelUploadModalTitle').textContent = 'Replace 3D Model';
    document.getElementById('modelUploadForm').reset();
    document.getElementById('modelUploadPreview').innerHTML = '<div class="model-preview-empty">No 3D model selected</div>';
    resetModelSelectionState();
    setModelUploadSpinner(false);
    document.getElementById('modelUploadModal').style.display = 'flex';
}

function closeModelUploadModal() {
    currentModelUploadToolId = null;
    document.getElementById('modelUploadModal').style.display = 'none';
    resetModelSelectionState();
    setModelUploadSpinner(false);
}

async function saveModelUpload(event) {
    event.preventDefault();
    
    if (!currentModelUploadToolId) {
        showError('No tool selected');
        return;
    }
    
    if (!pendingModelUploadBlob) {
        showError('Please select a 3D model file');
        return;
    }
    
    try {
        const lessonSlotValue = await ensureLessonSlotValue(!currentLessonSlot);
        setModelUploadSpinner(true, 'Uploading 3D model...');
        
        const uploadResult = await uploadToolModelBlob(
            lessonSlotValue,
            currentModelUploadToolId,
            pendingModelUploadBlob,
            pendingModelUploadFileName || replaceFileExtension(currentModelUploadToolId, '.glb'),
            pendingModelUploadExtension || 'glb'
        );
        
        // Update tool in currentTools
        const tool = currentTools[currentModelUploadToolId] || {};
        tool.modelUrl = uploadResult.modelUrl;
        tool.modelType = (pendingModelUploadExtension || 'glb').toLowerCase();
        tool.modelFileName = uploadResult.fileName || pendingModelUploadFileName;
        tool.modelStoragePath = uploadResult.storagePath;
        tool.storagePath = uploadResult.storagePath;
        tool.modelContentType = uploadResult.contentType || getContentTypeByExtension(tool.modelType);
        tool.contentType = uploadResult.contentType || getContentTypeByExtension(tool.modelType);
        tool.modelSize = uploadResult.fileSize || pendingModelFileSize || 0;
        
        currentTools[currentModelUploadToolId] = tool;
        currentLesson = currentLesson || {};
        currentLesson.tools = { ...currentTools };
        
        closeModelUploadModal();
        loadTools();
        showSuccess('3D model uploaded successfully. Remember to save the lesson to persist changes.');
    } catch (error) {
        console.error('Upload model error:', error);
        showError(error.message || 'Failed to upload 3D model');
    } finally {
        setModelUploadSpinner(false);
    }
}

async function deleteToolModel(toolId) {
    if (!confirm('Are you sure you want to delete the 3D model for this tool? This action cannot be undone.')) {
        return;
    }
    
    const tool = currentTools[toolId];
    if (!tool) {
        showError('Tool not found');
        return;
    }
    
    if (!tool.modelUrl) {
        showAlertModal('No 3D model to delete.', 'Info');
        return;
    }
    
    try {
        const lessonSlotValue = await ensureLessonSlotValue(!currentLessonSlot);
        
        const response = await fetch(`${API_BASE}/lessons/${lessonSlotValue}/tools/${toolId}/model`, {
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
            throw new Error(errorData.error || 'Failed to delete 3D model');
        }
        
        // Update tool locally
        delete tool.modelUrl;
        delete tool.modelType;
        delete tool.storagePath;
        delete tool.modelStoragePath;
        delete tool.fileName;
        delete tool.modelFileName;
        delete tool.contentType;
        delete tool.modelContentType;
        
        currentTools[toolId] = tool;
        currentLesson = currentLesson || {};
        currentLesson.tools = { ...currentTools };
        
        loadTools();
        showSuccess('3D model deleted successfully. Remember to save the lesson to persist changes.');
    } catch (error) {
        console.error('Delete model error:', error);
        showError(error.message || 'Failed to delete 3D model');
    }
}

// Setup model upload input handler for modal
function setupModelUploadInputHandler() {
    const modelInput = document.getElementById('modelUploadFileInput');
    if (!modelInput) return;
    
    modelInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            handleModelFileSelectionForUpload(file);
        }
    });
}

function handleModelFileSelectionForUpload(file) {
    const validation = validateModelFile(file);
    if (!validation.valid) {
        showAlertModal(validation.message, 'Invalid File');
        return;
    }
    
    modelSelectionToken += 1;
    const selectionId = modelSelectionToken;
    
    pendingOriginalModelType = validation.extension;
    
    const previewContainer = document.getElementById('modelUploadPreview');
    if (previewContainer) {
        previewContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748B;">Preparing 3D preview...</div>';
    }
    
    setModelUploadSpinner(true, MODEL_CONVERTIBLE_EXTENSIONS.includes(validation.extension) ? 'Converting 3D model...' : 'Preparing preview...');
    
    convertModelIfNeeded(file, validation.extension)
        .then(({ blob, extension, fileName }) => {
            if (selectionId !== modelSelectionToken) {
                return;
            }
            
            pendingModelUploadBlob = blob;
            pendingModelUploadExtension = extension;
            pendingModelUploadFileName = fileName;
            pendingModelFileSize = blob.size;
            
            cleanupPendingModelPreview();
            pendingModelPreviewUrl = URL.createObjectURL(blob);
            
            if (previewContainer) {
                renderModelViewerPreviewForUpload(pendingModelPreviewUrl);
            }
        })
        .catch((error) => {
            if (selectionId !== modelSelectionToken) {
                return;
            }
            console.error('3D model processing error:', error);
            resetModelSelectionState();
            if (previewContainer) {
                previewContainer.innerHTML = '<div class="model-preview-empty">Unable to preview this 3D model.</div>';
            }
            showError('Failed to process the selected 3D model. Please try a different file.');
        })
        .finally(() => {
            if (selectionId === modelSelectionToken) {
                setModelUploadSpinner(false);
            }
        });
}

function renderModelViewerPreviewForUpload(src) {
    const container = document.getElementById('modelUploadPreview');
    if (!container) return;
    container.innerHTML = `
        <model-viewer
            src="${src}"
            auto-rotate
            camera-controls
            shadow-intensity="1"
            style="width: 100%; height: 260px; background: #F8FAFC; border-radius: 12px;"
        >
        </model-viewer>
    `;
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initErrorMessageContainer();
    setupImageHandlers();
    setupModelInputHandler();
    setupModelUploadInputHandler();
    initializeEditor();
});



