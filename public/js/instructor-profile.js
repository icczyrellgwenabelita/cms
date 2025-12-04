// Instructor Profile Page JavaScript
document.addEventListener('DOMContentLoaded', async function() {
  const token = localStorage.getItem('instructorToken');
  if (!token) {
    window.location.href = '/caresim-login';
    return;
  }

  try {
    const response = await instructorAPI.get('/me');
    
    if (response.success) {
      document.getElementById('profileName').value = response.name || 'N/A';
      document.getElementById('profileEmail').value = response.email || 'N/A';
      document.getElementById('profileClass').value = response.class ? response.class.name : 'No class assigned';
      document.getElementById('profileDepartment').value = 'N/A'; // Can be added to API if needed
      
      document.getElementById('profileLoading').style.display = 'none';
      document.getElementById('profileContent').style.display = 'block';
    } else {
      throw new Error(response.error || 'Failed to load profile');
    }
  } catch (error) {
    console.error('Error loading profile:', error);
    document.getElementById('profileLoading').innerHTML = 
      '<p style="color: #dc2626;">Failed to load profile. Please try again.</p>';
  }
});
