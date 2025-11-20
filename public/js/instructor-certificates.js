// Instructor Certificates Overview JavaScript
document.addEventListener('DOMContentLoaded', async function() {
  // Check for token
  const token = localStorage.getItem('instructorToken');
  if (!token) {
    window.location.href = '/caresim-login';
    return;
  }

  try {
    // Load certificates data
    const data = await instructorAPI.get('/certificates');
    const certificates = data.certificates || [];
    
    // Calculate summary stats
    const eligible = certificates.filter(c => c.overallStatus === 'Eligible').length;
    const inProgress = certificates.filter(c => c.overallStatus === 'In Progress').length;
    const notEligible = certificates.filter(c => c.overallStatus === 'Not Eligible').length;
    
    // Update summary cards if they exist
    const statCards = document.querySelectorAll('.instructor-stat-value');
    if (statCards.length >= 3) {
      statCards[0].textContent = eligible;
      statCards[1].textContent = inProgress;
      statCards[2].textContent = notEligible;
    }
    
    // Render certificates list
    renderCertificatesList(certificates);
    
  } catch (error) {
    console.error('Certificates overview load error:', error);
    alert('Failed to load certificates data. Please try again.');
  }
});

function renderCertificatesList(certificates) {
  const container = document.querySelector('.certificates-table tbody') ||
                    document.querySelector('.certificates-list tbody');
  if (!container) return;
  
  if (certificates.length === 0) {
    container.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">No student certificates data</td></tr>';
    return;
  }
  
  container.innerHTML = certificates.map(cert => {
    const statusClass = cert.overallStatus === 'Eligible' ? 'eligible' 
      : cert.overallStatus === 'In Progress' ? 'in-progress' 
      : 'not-eligible';
    
    return `
      <tr>
        <td>${cert.name || 'Unknown'}</td>
        <td>${cert.lessonCertificates || 0}</td>
        <td>${cert.simulationCertificates || 0}</td>
        <td><span class="status-pill ${statusClass}">${cert.overallStatus}</span></td>
        <td>
          <button class="view-button" onclick="viewStudentCertificates('${cert.uid}')">View</button>
        </td>
      </tr>
    `;
  }).join('');
}

function viewStudentCertificates(uid) {
  window.location.href = `/instructor-student-progress?uid=${uid}`;
}

function logout() {
  if (confirm('Are you sure you want to log out?')) {
    localStorage.removeItem('instructorToken');
    window.location.href = '/caresim-login';
  }
}

