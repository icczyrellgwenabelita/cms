// Instructor Profile JavaScript
document.addEventListener('DOMContentLoaded', async function() {
  // Check for token
  const token = localStorage.getItem('instructorToken');
  if (!token) {
    window.location.href = '/caresim-login';
    return;
  }

  try {
    // Load profile data
    const data = await instructorAPI.get('/profile');
    const profile = data.profile;
    
    // Populate form fields
    const nameField = document.getElementById('instructorName');
    const emailField = document.getElementById('instructorEmail');
    const contactField = document.getElementById('instructorContact');
    const departmentField = document.getElementById('instructorDepartment');
    const idField = document.getElementById('instructorId');
    
    if (nameField) nameField.value = profile.name || '';
    if (emailField) emailField.value = profile.email || '';
    if (contactField) contactField.value = profile.contact || '';
    if (departmentField) departmentField.value = profile.department || '';
    if (idField) idField.value = profile.idNumber || '';
    
    // Update header info
    const headerName = document.querySelector('.profile-info h1');
    if (headerName) headerName.textContent = profile.name || 'Instructor';
    
    const headerEmail = document.querySelector('.profile-email');
    if (headerEmail) headerEmail.textContent = profile.email || '';
    
    // Setup save handler
    const saveButton = document.querySelector('.btn-save-profile') ||
                       document.querySelector('button[type="submit"]');
    if (saveButton) {
      saveButton.addEventListener('click', async (e) => {
        e.preventDefault();
        await saveProfile();
      });
    }
    
    // Setup form submit
    const form = document.querySelector('.instructor-form-grid')?.closest('form') ||
                 document.querySelector('form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveProfile();
      });
    }
    
  } catch (error) {
    console.error('Profile load error:', error);
    alert('Failed to load profile. Please try again.');
  }
});

async function saveProfile() {
  const name = document.getElementById('instructorName')?.value;
  const email = document.getElementById('instructorEmail')?.value;
  const contact = document.getElementById('instructorContact')?.value;
  const department = document.getElementById('instructorDepartment')?.value;
  const idNumber = document.getElementById('instructorId')?.value;
  
  try {
    await instructorAPI.put('/profile', {
      name,
      email,
      contact,
      department,
      idNumber
    });
    
    alert('Profile updated successfully!');
    // Reload page to show updated data
    window.location.reload();
  } catch (error) {
    console.error('Save profile error:', error);
    alert('Failed to update profile. Please try again.');
  }
}

function logout() {
  if (confirm('Are you sure you want to log out?')) {
    localStorage.removeItem('instructorToken');
    window.location.href = '/caresim-login';
  }
}



