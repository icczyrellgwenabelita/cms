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
let currentToolModelCleanup = null;
let currentToolModelCleanup = null;
let currentTab = defaultTab;
let currentLessonSlot = slot;

const modelPreviewState = {
    renderer: null,
    scene: null,
    camera: null,
    animationId: null,
    currentObject: null,
    currentUrl: null
};

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
    if (modelPreviewState.animationId) {
        cancelAnimationFrame(modelPreviewState.animationId);
        modelPreviewState.animationId = null;
    }
    if (modelPreviewState.renderer) {
        modelPreviewState.renderer.dispose();
        if (modelPreviewState.renderer.domElement && modelPreviewState.renderer.domElement.parentNode) {
            modelPreviewState.renderer.domElement.parentNode.removeChild(modelPreviewState.renderer.domElement);
        }
        modelPreviewState.renderer = null;
    }
    modelPreviewState.scene = null;
    modelPreviewState.camera = null;
    modelPreviewState.currentObject = null;
    if (modelPreviewState.currentUrl && modelPreviewState.currentUrl.startsWith('blob:')) {
        URL.revokeObjectURL(modelPreviewState.currentUrl);
    }
    modelPreviewState.currentUrl = null;
    const container = document.getElementById('tool3DModelPreview');
    if (container) {
        container.innerHTML = '<div class="model-preview-empty">No 3D model selected</div>';
    }
}

function initializeModelPreviewScene() {
    const container = document.getElementById('tool3DModelPreview');
    if (!container || typeof THREE === 'undefined') {
        return false;
    }

    if (modelPreviewState.animationId) {
        cancelAnimationFrame(modelPreviewState.animationId);
        modelPreviewState.animationId = null;
    }
    if (modelPreviewState.renderer) {
        modelPreviewState.renderer.dispose();
        if (modelPreviewState.renderer.domElement && modelPreviewState.renderer.domElement.parentNode) {
            modelPreviewState.renderer.domElement.parentNode.removeChild(modelPreviewState.renderer.domElement);
        }
    }
    modelPreviewState.renderer = null;
    modelPreviewState.scene = null;
    modelPreviewState.camera = null;
    modelPreviewState.currentObject = null;

    container.innerHTML = '';
    const width = container.clientWidth || 320;
    const height = container.clientHeight || 220;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(2.5, 2, 4);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(5, 10, 7.5);
    scene.add(dirLight);

    modelPreviewState.renderer = renderer;
    modelPreviewState.scene = scene;
    modelPreviewState.camera = camera;

    const animate = () => {
        modelPreviewState.animationId = requestAnimationFrame(animate);
        if (modelPreviewState.currentObject) {
            modelPreviewState.currentObject.rotation.y += 0.01;
        }
        renderer.render(scene, camera);
    };
    animate();
    return true;
}

function loadModelPreview(url, type) {
    if (!url || !type) {
        disposeModelPreview();
        return;
    }

    const lowerType = type.toLowerCase();
    if (!initializeModelPreviewScene()) {
        disposeModelPreview();
        return;
    }

    const scene = modelPreviewState.scene;
    if (!scene || typeof THREE === 'undefined') {
        return;
    }

    const cleanupPreviousObject = () => {
        if (modelPreviewState.currentObject) {
            scene.remove(modelPreviewState.currentObject);
            modelPreviewState.currentObject.traverse?.((child) => {
                if (child.isMesh && child.geometry) {
                    child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => mat.dispose && mat.dispose());
                        } else {
                            child.material.dispose && child.material.dispose();
                        }
                    }
                }
            });
        }
        modelPreviewState.currentObject = null;
    };

    const onLoad = (object) => {
        cleanupPreviousObject();
        const container = document.getElementById('tool3DModelPreview');
        if (!container) return;

        let model = object;
        if (object.scene) {
            model = object.scene;
        }

        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 2 / maxDim;
        model.scale.setScalar(scale);

        const boxCenter = new THREE.Vector3();
        box.getCenter(boxCenter);
        model.position.sub(boxCenter);

        scene.add(model);
        modelPreviewState.currentObject = model;
    };

    const onError = () => {
        disposeModelPreview();
        const container = document.getElementById('tool3DModelPreview');
        if (container) {
            container.innerHTML = '<div class="model-preview-error">Unable to preview this 3D model.</div>';
        }
    };

    try {
        if (lowerType === 'glb' || lowerType === 'gltf') {
            const loader = new THREE.GLTFLoader();
            loader.load(url, onLoad, undefined, onError);
        } else if (lowerType === 'fbx') {
            const loader = new THREE.FBXLoader();
            loader.load(url, onLoad, undefined, onError);
        } else if (lowerType === 'obj') {
            const loader = new THREE.OBJLoader();
            loader.load(url, onLoad, undefined, onError);
        } else {
            disposeModelPreview();
            const container = document.getElementById('tool3DModelPreview');
            if (container) {
                container.innerHTML = '<div class="model-preview-error">Unsupported 3D model format.</div>';
            }
        }
    } catch (error) {
        console.error('Model preview error:', error);
        onError();
    }
}

function loadModelPreviewFromFile(file) {
    if (!file) {
        disposeModelPreview();
        return;
    }
    const extension = getModelExtension(file.name);
    if (!extension) {
        disposeModelPreview();
        const container = document.getElementById('tool3DModelPreview');
        if (container) {
            container.innerHTML = '<div class="model-preview-error">Only FBX, GLB, or OBJ files are supported.</div>';
        }
        return;
    }

    if (modelPreviewState.currentUrl && modelPreviewState.currentUrl.startsWith('blob:')) {
        URL.revokeObjectURL(modelPreviewState.currentUrl);
    }
    const objectUrl = URL.createObjectURL(file);
    modelPreviewState.currentUrl = objectUrl;
    loadModelPreview(objectUrl, extension);
}

function loadModelPreviewFromStoredData(data, type) {
    if (!data || !type) {
        disposeModelPreview();
        return;
    }

    if (data.startsWith('data:')) {
        try {
            const blob = dataURIToBlob(data);
            if (modelPreviewState.currentUrl && modelPreviewState.currentUrl.startsWith('blob:')) {
                URL.revokeObjectURL(modelPreviewState.currentUrl);
            }
            const objectUrl = URL.createObjectURL(blob);
            modelPreviewState.currentUrl = objectUrl;
            loadModelPreview(objectUrl, type);
            return;
        } catch (error) {
            console.error('Failed to convert data URI to blob for model preview', error);
        }
    }

    modelPreviewState.currentUrl = data;
    loadModelPreview(data, type);
}

function dataURIToBlob(dataURI) {
    const byteString = atob(dataURI.split(',')[1]);
    const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
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
            if (toolModelFileLabel) {
                toolModelFileLabel.textContent = file.name;
                toolModelFileLabel.classList.remove('hidden');
            }
            if (toolModelUrlDisplay) {
                toolModelUrlDisplay.textContent = '';
                toolModelUrlDisplay.classList.add('hidden');
            }
            loadModelPreviewFromFile(file);
        } else {
            disposeModelPreview();
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
    disposeModelPreview();
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
    
    // Show existing image
    const imagePreview = document.getElementById('toolImagePreview');
    if (tool.imageUrl || tool.imageURL) {
        imagePreview.innerHTML = `<img src="${tool.imageUrl || tool.imageURL}" alt="${tool.name}" style="max-width: 100%; max-height: 200px; border-radius: 4px;">`;
    } else {
        imagePreview.innerHTML = '';
    }
    
    const modelInput = document.getElementById('tool3DModel');
    if (modelInput) modelInput.value = '';

    const derivedType = tool.modelType || getModelExtension(tool.modelFileName || '');
    if (tool.modelUrl && derivedType) {
        loadModelPreviewFromStoredData(tool.modelUrl, derivedType);
    } else {
        disposeModelPreview();
    }
    
    document.getElementById('toolModal').style.display = 'flex';
}

function closeToolModal() {
    document.getElementById('toolModal').style.display = 'none';
    disposeModelPreview();
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
        const modelFile = document.getElementById('tool3DModel').files[0];
        
        if (imageFile) {
            tool.imageUrl = await readFileAsDataURL(imageFile);
        } else if (currentTools[toolId]) {
            tool.imageUrl = currentTools[toolId].imageUrl || currentTools[toolId].imageURL || '';
        }
        
        if (modelFile) {
            const extension = getModelExtension(modelFile.name);
            if (!extension || !['fbx', 'glb', 'obj'].includes(extension)) {
                showAlertModal('3D model must be an FBX, GLB, or OBJ file.', 'Error');
                return;
            }
            tool.modelType = extension;
            tool.modelFileName = modelFile.name;
            tool.modelUrl = await readFileAsDataURL(modelFile);
        } else if (currentTools[toolId]) {
            if (currentTools[toolId].modelUrl) tool.modelUrl = currentTools[toolId].modelUrl;
            if (currentTools[toolId].modelType) tool.modelType = currentTools[toolId].modelType;
            if (currentTools[toolId].modelFileName) tool.modelFileName = currentTools[toolId].modelFileName;
            if (!tool.modelType && tool.modelFileName) {
                tool.modelType = getModelExtension(tool.modelFileName);
            }
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

// Shared 3D Model Preview Helper
function setupToolModelPreview(containerElement, modelUrl, modelType) {
    if (!containerElement || !modelUrl || !modelType || typeof THREE === 'undefined') {
        if (containerElement) {
            containerElement.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748B;">No 3D model attached.</div>';
        }
        return null;
    }

    const lowerType = modelType.toLowerCase();
    if (!['fbx', 'glb', 'obj'].includes(lowerType)) {
        containerElement.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748B;">Unsupported 3D model type.</div>';
        return null;
    }

    // Clear container
    containerElement.innerHTML = '<canvas style="width: 100%; height: 100%; border-radius: 8px;"></canvas>';
    const canvas = containerElement.querySelector('canvas');
    if (!canvas) return null;

    // Setup scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5f5);
    
    const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 5);
    
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);
    
    let currentModel = null;
    let animationId = null;
    
    const cleanup = () => {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        if (currentModel) {
            scene.remove(currentModel);
            currentModel.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => mat.dispose && mat.dispose());
                        } else {
                            child.material.dispose && child.material.dispose();
                        }
                    }
                }
            });
            currentModel = null;
        }
        renderer.dispose();
    };
    
    const onLoad = (object) => {
        if (currentModel) {
            scene.remove(currentModel);
            currentModel.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => mat.dispose && mat.dispose());
                        } else {
                            child.material.dispose && child.material.dispose();
                        }
                    }
                }
            });
        }
        
        let model = object;
        if (object.scene) {
            model = object.scene;
        }
        
        // Fit model to view
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 2 / maxDim;
        model.scale.setScalar(scale);
        
        const boxCenter = new THREE.Vector3();
        box.getCenter(boxCenter);
        model.position.sub(boxCenter);
        
        scene.add(model);
        currentModel = model;
        
        // Auto-rotate animation
        const animate = () => {
            if (currentModel) {
                currentModel.rotation.y += 0.01;
            }
            renderer.render(scene, camera);
            animationId = requestAnimationFrame(animate);
        };
        animate();
    };
    
    const onError = (error) => {
        console.error('3D model load error:', error);
        containerElement.innerHTML = '<div style="padding: 20px; text-align: center; color: #DC2626;">Unable to load 3D model.</div>';
        cleanup();
    };
    
    // Load model based on type
    try {
        if (lowerType === 'glb' || lowerType === 'gltf') {
            const loader = new THREE.GLTFLoader();
            loader.load(modelUrl, onLoad, undefined, onError);
        } else if (lowerType === 'fbx') {
            const loader = new THREE.FBXLoader();
            loader.load(modelUrl, onLoad, undefined, onError);
        } else if (lowerType === 'obj') {
            const loader = new THREE.OBJLoader();
            loader.load(modelUrl, onLoad, undefined, onError);
        }
    } catch (error) {
        onError(error);
    }
    
    // Return cleanup function
    return cleanup;
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
                                ${toolModelUrl && toolModelType ? `
                                    <div class="preview-tool-3d-container" data-tool-id="${toolId}" style="width: 100%; height: 200px; background: #F9FAFB; border-radius: 8px; margin-top: 12px; position: relative; overflow: hidden;">
                                        <!-- 3D preview will be rendered here -->
                                    </div>
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
    
    // Setup 3D previews for tools with models
    if (toolKeys.length > 0) {
        toolKeys.forEach(toolId => {
            const tool = tools[toolId];
            if (tool.modelUrl && tool.modelType) {
                const container = previewContent.querySelector(`.preview-tool-3d-container[data-tool-id="${toolId}"]`);
                if (container) {
                    setTimeout(() => {
                        setupToolModelPreview(container, tool.modelUrl, tool.modelType);
                    }, 100);
                }
            }
        });
    }
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
    const modals = ['toolModal', 'logoutModal', 'deleteModal', 'alertModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (event.target === modal) {
            if (modalId === 'toolModal') closeToolModal();
            else if (modalId === 'logoutModal') closeLogoutModal();
            else if (modalId === 'deleteModal') closeDeleteModal();
            else if (modalId === 'alertModal') closeAlertModal();
        }
    });
};

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initErrorMessageContainer();
    setupImageHandlers();
    setupModelInputHandler();
    initializeEditor();
});



