// Admin Videos Management
const adminToken = localStorage.getItem('adminToken');

if (!adminToken) {
    window.location.href = '/admin-login';
}

const API_BASE = '/api/admin';

let allVideos = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadVideos();
});

// ============================================
// Load Videos
// ============================================

async function loadVideos() {
    try {
        const response = await fetch(`${API_BASE}/videos`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to fetch videos');
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error('Invalid response');
        }

        allVideos = data.videos || [];
        renderVideosTable();
    } catch (error) {
        console.error('Error loading videos:', error);
        showAlert('Failed to load videos. Please try again.', 'Error');
        document.getElementById('videosTableBody').innerHTML = 
            '<tr><td colspan="5" style="text-align:center; padding:40px; color:#EF4444;">Error loading videos</td></tr>';
    }
}

// ============================================
// Render Videos Table
// ============================================

function renderVideosTable() {
    const tbody = document.getElementById('videosTableBody');
    if (!tbody) return;

    if (allVideos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:40px; color:#64748B;">No videos found. Click "Add Video" to create one.</td></tr>';
        return;
    }

    // Sort by createdAt (newest first)
    const sortedVideos = [...allVideos].sort((a, b) => {
        const dateA = new Date(a.createdAt || 0);
        const dateB = new Date(b.createdAt || 0);
        return dateB - dateA;
    });

    tbody.innerHTML = sortedVideos.map((video) => {
        const createdDate = video.createdAt ? new Date(video.createdAt).toLocaleDateString() : 'N/A';
        const description = video.description || 'No description';
        const truncatedDesc = description.length > 50 ? description.substring(0, 50) + '...' : description;

        return `
            <tr>
                <td><strong>${video.title || 'Untitled'}</strong></td>
                <td class="mobile-hidden">${truncatedDesc}</td>
                <td class="mobile-hidden">${createdDate}</td>
                <td style="text-align: right;">
                    <button class="btn-secondary" onclick="editVideo('${video.id}')" style="margin-right: 8px;">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn-secondary" onclick="deleteVideo('${video.id}')" style="color: #EF4444; border-color: #EF4444;">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// ============================================
// Add Video Modal
// ============================================

function openAddVideoModal() {
    document.getElementById('videoModalTitle').textContent = 'Add New Video';
    document.getElementById('videoId').value = '';
    document.getElementById('videoTitle').value = '';
    document.getElementById('videoDescription').value = '';
    document.getElementById('videoFile').value = '';
    document.getElementById('existingVideoInfo').style.display = 'none';
    document.getElementById('videoFile').required = true;
    document.getElementById('videoModal').style.display = 'flex';
}

// ============================================
// Edit Video Modal
// ============================================

function editVideo(videoId) {
    const video = allVideos.find(v => v.id === videoId);
    if (!video) {
        showAlert('Video not found.', 'Error');
        return;
    }

    document.getElementById('videoModalTitle').textContent = 'Edit Video';
    document.getElementById('videoId').value = videoId;
    document.getElementById('videoTitle').value = video.title || '';
    document.getElementById('videoDescription').value = video.description || '';
    document.getElementById('videoFile').value = '';
    document.getElementById('videoFile').required = false;
    
    // Show existing video info
    if (video.downloadUrl) {
        const fileName = video.storagePath ? video.storagePath.split('/').pop() : 'Current video';
        document.getElementById('currentVideoName').textContent = fileName;
        document.getElementById('existingVideoInfo').style.display = 'block';
    } else {
        document.getElementById('existingVideoInfo').style.display = 'none';
    }

    document.getElementById('videoModal').style.display = 'flex';
}

// ============================================
// Close Video Modal
// ============================================

function closeVideoModal() {
    document.getElementById('videoModal').style.display = 'none';
    document.getElementById('videoForm').reset();
}

// ============================================
// Save Video
// ============================================

async function saveVideo(event) {
    event.preventDefault();

    const videoId = document.getElementById('videoId').value;
    const title = document.getElementById('videoTitle').value.trim();
    const description = document.getElementById('videoDescription').value.trim();
    const videoFile = document.getElementById('videoFile').files[0];

    if (!title) {
        showAlert('Title is required.', 'Error');
        return;
    }

    // For new videos, file is required
    if (!videoId && !videoFile) {
        showAlert('Please select a video file.', 'Error');
        return;
    }

    const submitBtn = document.getElementById('saveVideoBtn');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = videoFile ? 'Uploading...' : 'Saving...';

    try {
        let downloadUrl = null;
        let storagePath = null;

        // Upload video file if provided
        if (videoFile) {
            console.log('[saveVideo] Uploading video file:', videoFile.name, 'Size:', videoFile.size);
            const formData = new FormData();
            formData.append('videoFile', videoFile);
            if (videoId) {
                formData.append('videoId', videoId);
            }

            const uploadResponse = await fetch(`${API_BASE}/videos/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                },
                body: formData
            });

            if (!uploadResponse.ok) {
                const errorData = await uploadResponse.json().catch(() => ({}));
                console.error('[saveVideo] Upload failed:', errorData);
                throw new Error(errorData.error || 'Failed to upload video');
            }

            const uploadData = await uploadResponse.json();
            console.log('[saveVideo] Upload response:', uploadData);
            
            if (!uploadData.success) {
                throw new Error(uploadData.error || 'Upload failed');
            }

            if (!uploadData.downloadUrl) {
                throw new Error('Upload succeeded but no download URL returned');
            }

            downloadUrl = uploadData.downloadUrl;
            storagePath = uploadData.storagePath;
            console.log('[saveVideo] Upload successful. downloadUrl:', downloadUrl ? 'present' : 'missing', 'storagePath:', storagePath ? 'present' : 'missing');
        }

        // For new videos, downloadUrl is required
        if (!videoId && !downloadUrl) {
            throw new Error('Video file upload is required for new videos');
        }

        // Save video metadata
        const videoData = {
            title,
            description: description || ''
        };

        if (downloadUrl) {
            videoData.downloadUrl = downloadUrl;
        }
        if (storagePath) {
            videoData.storagePath = storagePath;
        }

        console.log('[saveVideo] Saving video metadata:', { ...videoData, downloadUrl: downloadUrl ? 'present' : 'missing', storagePath: storagePath ? 'present' : 'missing' });

        const url = videoId 
            ? `${API_BASE}/videos/${videoId}`
            : `${API_BASE}/videos`;
        const method = videoId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(videoData)
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            let errorMessage = 'Failed to save video';
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorData.details || errorMessage;
                console.error('[saveVideo] Server error response:', errorData);
            } catch (parseError) {
                console.error('[saveVideo] Failed to parse error response:', parseError);
                errorMessage = `Server error (${response.status}): ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log('[saveVideo] Save response:', data);
        
        if (data.success) {
            showAlert(videoId ? 'Video updated successfully.' : 'Video added successfully.', 'Success');
            closeVideoModal();
            await loadVideos();
        } else {
            throw new Error(data.error || 'Save failed');
        }
    } catch (error) {
        console.error('[saveVideo] Error:', error);
        console.error('[saveVideo] Error stack:', error.stack);
        showAlert(error.message || 'Failed to save video', 'Error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// ============================================
// Delete Video
// ============================================

async function deleteVideo(videoId) {
    const video = allVideos.find(v => v.id === videoId);
    if (!video) {
        showAlert('Video not found.', 'Error');
        return;
    }

    if (!confirm(`Are you sure you want to delete "${video.title}"? This action cannot be undone.`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/videos/${videoId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${adminToken}`
            }
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin-login';
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to delete video');
        }

        const data = await response.json();
        if (data.success) {
            showAlert('Video deleted successfully.', 'Success');
            await loadVideos();
        }
    } catch (error) {
        console.error('Delete video error:', error);
        showAlert(error.message || 'Failed to delete video', 'Error');
    }
}

// ============================================
// Utility Functions
// ============================================

function logout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('adminToken');
        window.location.href = '/admin-login';
    }
}

function showAlert(message, title = 'Notice') {
    document.getElementById('alertTitle').textContent = title;
    document.getElementById('alertMessage').textContent = message;
    document.getElementById('alertModal').style.display = 'flex';
}

function closeAlertModal() {
    document.getElementById('alertModal').style.display = 'none';
}

// Close modals on outside click
window.onclick = function(event) {
    const videoModal = document.getElementById('videoModal');
    const alertModal = document.getElementById('alertModal');
    if (event.target === videoModal) closeVideoModal();
    if (event.target === alertModal) closeAlertModal();
};

