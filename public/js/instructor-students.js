// Instructor Students Page JavaScript
const instructorStudentsState = {
  students: [],
  filteredStudents: [],
  classData: null
};

// UI Helpers
function showLoadingOverlay() {
  const overlay = document.getElementById('studentsLoadingOverlay');
  const inlineLoading = document.getElementById('studentsInlineLoading');
  const tableWrapper = document.getElementById('studentsTableWrapper');
  if (overlay) overlay.style.display = 'flex';
  if (inlineLoading) inlineLoading.style.display = 'block';
  if (tableWrapper) tableWrapper.style.display = 'none';
  document.getElementById('noClassAssigned').style.display = 'none';
  document.getElementById('noStudents').style.display = 'none';
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('studentsLoadingOverlay');
  const inlineLoading = document.getElementById('studentsInlineLoading');
  if (overlay) overlay.style.display = 'none';
  if (inlineLoading) inlineLoading.style.display = 'none';
}

function showNoClassAssigned() {
  const noClass = document.getElementById('noClassAssigned');
  const tableWrapper = document.getElementById('studentsTableWrapper');
  if (noClass) noClass.style.display = 'block';
  if (tableWrapper) tableWrapper.style.display = 'none';
  document.getElementById('noStudents').style.display = 'none';
}

function showNoStudents() {
  const noStudents = document.getElementById('noStudents');
  const tableWrapper = document.getElementById('studentsTableWrapper');
  if (noStudents) noStudents.style.display = 'block';
  if (tableWrapper) tableWrapper.style.display = 'none';
  document.getElementById('noClassAssigned').style.display = 'none';
}

function showStudentsTable() {
  const tableWrapper = document.getElementById('studentsTableWrapper');
  if (tableWrapper) tableWrapper.style.display = 'block';
  document.getElementById('noClassAssigned').style.display = 'none';
  document.getElementById('noStudents').style.display = 'none';
}

function formatDate(dateValue) {
  if (!dateValue) return '--';
  
  let date;
  if (typeof dateValue === 'number') {
    date = new Date(dateValue);
  } else if (typeof dateValue === 'string') {
    date = new Date(dateValue);
  } else {
    return '--';
  }
  
  if (isNaN(date.getTime())) {
    return '--';
  }
  
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function getStatus(student) {
  const avgQuizScore = student.game?.avgQuizScore || 0;
  const lessonsCompleted = student.lms?.lessonsCompleted || 0;
  const totalLessons = student.lms?.totalLessons || 6;
  
  if (avgQuizScore < 7 || (lessonsCompleted / totalLessons) < 0.5) {
    return { text: 'At Risk', class: 'status-pill at-risk' };
  }
  return { text: 'On Track', class: 'status-pill on-track' };
}

// Renderers

function renderStudents() {
  const tbody = document.getElementById('studentsTableBody');
  const countLabelEl = document.getElementById('studentsCountLabel');
  
  if (!tbody) return;
  
  tbody.innerHTML = '';

  if (!instructorStudentsState.filteredStudents.length) {
    showNoStudents();
    if (countLabelEl) {
      countLabelEl.textContent = '0 students';
    }
    return;
  }

  showStudentsTable();

  const total = instructorStudentsState.filteredStudents.length;
  if (countLabelEl) {
    countLabelEl.textContent = `${total} student${total === 1 ? '' : 's'}`;
  }

  instructorStudentsState.filteredStudents.forEach((student) => {
    const row = document.createElement('tr');
    const status = getStatus(student);
    const lastActive = formatDate(student.lastActiveAt);
    
    row.innerHTML = `
      <td>
        <strong>${student.name || 'Student'}</strong>
        <p class="student-meta">${student.studentNumber || 'N/A'}</p>
      </td>
      <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${student.email || 'N/A'}">${student.email || 'N/A'}</td>
      <td>${student.studentNumber || 'N/A'}</td>
      <td>${lastActive}</td>
      <td>
        <span class="${status.class}">${status.text}</span>
      </td>
    `;
    
    tbody.appendChild(row);
  });
}

// Search/Filter
function filterStudents() {
  const searchTerm = document.getElementById('studentSearch').value.toLowerCase().trim();
  
  if (!searchTerm) {
    instructorStudentsState.filteredStudents = instructorStudentsState.students;
  } else {
    instructorStudentsState.filteredStudents = instructorStudentsState.students.filter(student => {
      const name = (student.name || '').toLowerCase();
      const email = (student.email || '').toLowerCase();
      const studentNumber = (student.studentNumber || '').toLowerCase();
      
      return name.includes(searchTerm) || 
             email.includes(searchTerm) || 
             studentNumber.includes(searchTerm);
    });
  }
  
  renderStudents();
}

// Main Load Function
async function loadStudentsPage() {
  showLoadingOverlay();
  try {
    // Load class meta and student progress in parallel
    const [classResponse, progressResponse] = await Promise.all([
      instructorAPI.get('/class/me').catch((err) => {
        console.warn('Unable to load class meta for students page:', err);
        return null;
      }),
      instructorAPI.get('/class/students/progress')
    ]);

    if (classResponse && classResponse.success && classResponse.class) {
      instructorStudentsState.classData = classResponse.class;
    } else {
      instructorStudentsState.classData = null;
    }

    if (progressResponse.success && progressResponse.students) {
      instructorStudentsState.students = progressResponse.students;
      instructorStudentsState.filteredStudents = progressResponse.students;
      renderStudents();
    } else {
      showNoClassAssigned();
    }
  } catch (error) {
    console.error('Error loading students page:', error);
    if (error.message.includes('No class assigned') || error.message.includes('Class not found')) {
      showNoClassAssigned();
    } else {
      const tbody = document.getElementById('studentsTableBody');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 40px; color: #DC2626;">Failed to load student data: ${error.message}</td></tr>`;
      }
      showStudentsTable();
    }
  } finally {
    hideLoadingOverlay();
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  loadStudentsPage();
  
  const searchInput = document.getElementById('studentSearch');
  if (searchInput) {
    searchInput.addEventListener('input', filterStudents);
  }
});
