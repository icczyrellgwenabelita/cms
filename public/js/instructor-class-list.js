// Instructor Class List JavaScript
let allStudents = [];

document.addEventListener('DOMContentLoaded', async function() {
  // Check for token
  const token = localStorage.getItem('instructorToken');
  if (!token) {
    window.location.href = '/caresim-login';
    return;
  }

  try {
    // Load class list data
    const data = await instructorAPI.get('/class-list');
    allStudents = data.students || [];
    
    renderStudents(allStudents);
    
    // Setup search
    const searchInput = document.getElementById('studentSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = allStudents.filter(student => 
          student.name.toLowerCase().includes(query) ||
          student.email.toLowerCase().includes(query) ||
          student.studentNumber.toLowerCase().includes(query)
        );
        renderStudents(filtered);
      });
    }
    
    // Setup status filter
    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        const status = e.target.value;
        let filtered = allStudents;
        if (status !== 'all') {
          filtered = allStudents.filter(student => {
            if (status === 'on-track') return student.status === 'On Track';
            if (status === 'at-risk') return student.status === 'At Risk';
            return true;
          });
        }
        renderStudents(filtered);
      });
    }
  } catch (error) {
    console.error('Class list load error:', error);
    alert('Failed to load class list. Please try again.');
  }
});

function renderStudents(students) {
  const tbody = document.querySelector('.students-table tbody');
  if (!tbody) return;
  
  if (students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px;">No students found</td></tr>';
    return;
  }
  
  tbody.innerHTML = students.map(student => {
    const progressPercent = student.progress.totalLessons > 0
      ? Math.round((student.progress.lessonsCompleted / student.progress.totalLessons) * 100)
      : 0;
    
    const statusClass = student.status === 'On Track' ? 'on-track' 
      : student.status === 'At Risk' ? 'at-risk' 
      : 'needs-attention';
    
    return `
      <tr>
        <td>
          <div class="student-name-cell">
            <span class="student-name">${student.name || 'Unknown'}</span>
            <span class="student-info">Batch ${student.batch || 'N/A'} • SN: ${student.studentNumber || 'N/A'}</span>
          </div>
        </td>
        <td>
          <div class="progress-cell">
            <span class="progress-value">${progressPercent}%</span>
            <div class="progress-bar-container">
              <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
            </div>
          </div>
        </td>
        <td>
          <div class="simulation-cell">
            <span class="simulation-text">${student.progress.simulationsCompleted} / ${student.progress.totalSimulations} Completed</span>
            <span class="status-pill ${statusClass}">${student.status}</span>
          </div>
        </td>
        <td>
          <div class="quiz-avg-cell">
            <span class="quiz-avg-value">${(student.progress.avgQuizScore || 0).toFixed(1)} / 10</span>
            <span class="quiz-avg-caption">Average score</span>
          </div>
        </td>
        <td>
          <button class="view-button" onclick="viewStudent('${student.uid}')">View Details</button>
        </td>
      </tr>
    `;
  }).join('');
  
  // Update pagination info
  const paginationInfo = document.querySelector('.pagination-info');
  if (paginationInfo) {
    paginationInfo.textContent = `Showing 1–${students.length} of ${students.length} students`;
  }
}

function viewStudent(uid) {
  window.location.href = `/instructor-student-progress?uid=${uid}`;
}

function logout() {
  if (confirm('Are you sure you want to log out?')) {
    localStorage.removeItem('instructorToken');
    window.location.href = '/caresim-login';
  }
}

