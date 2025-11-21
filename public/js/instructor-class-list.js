// Instructor Class List JavaScript
let allStudents = [];
let filteredStudents = [];
let currentPage = 1;
const pageSize = 10;

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
    console.log('API Response:', data);
    
    // Handle both response formats: { success: true, students: [...] } or { students: [...] }
    allStudents = data.students || data || [];
    filteredStudents = [...allStudents];
    
    console.log('Loaded students:', allStudents.length);
    console.log('Filtered students:', filteredStudents.length);
    console.log('First student sample:', allStudents[0]);
    
    if (allStudents.length === 0) {
      console.warn('No students found. Check if students are assigned to this instructor.');
    }
    
    renderPage(1);
    
    // Setup search
    const searchInput = document.getElementById('studentSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        filteredStudents = allStudents.filter(student => 
          (student.name || '').toLowerCase().includes(query) ||
          (student.email || '').toLowerCase().includes(query) ||
          (student.studentNumber || '').toLowerCase().includes(query)
        );
        renderPage(1);
      });
    }
    
    // Setup status filter
    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        const status = e.target.value;
        const searchQuery = document.getElementById('studentSearch')?.value.toLowerCase() || '';
        
        let filtered = allStudents;
        
        // Apply search filter
        if (searchQuery) {
          filtered = filtered.filter(student => 
            (student.name || '').toLowerCase().includes(searchQuery) ||
            (student.email || '').toLowerCase().includes(searchQuery) ||
            (student.studentNumber || '').toLowerCase().includes(searchQuery)
          );
        }
        
        // Apply status filter
        if (status !== 'all') {
          filtered = filtered.filter(student => {
            if (status === 'on-track') return student.status === 'On Track';
            if (status === 'at-risk') return student.status === 'At Risk';
            return true;
          });
        }
        
        filteredStudents = filtered;
        renderPage(1);
      });
    }
  } catch (error) {
    console.error('Class list load error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    const tbody = document.getElementById('classlistTableBody') || document.querySelector('.classlist-table tbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 40px; color: #dc2626;">
        <p style="margin-bottom: 8px;">Failed to load class list</p>
        <p style="font-size: 0.9rem; color: #64748B;">${error.message || 'Please check the console for details.'}</p>
      </td></tr>`;
    }
    
    const summaryEl = document.querySelector('.classlist-results-summary');
    if (summaryEl) {
      summaryEl.textContent = 'Error loading students';
      summaryEl.classList.remove('hidden');
    }
  }
});

function renderPage(page) {
  currentPage = page;
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pageStudents = filteredStudents.slice(startIndex, endIndex);
  
  renderStudents(pageStudents);
  renderPaginationControls();
}

function renderStudents(students) {
  const tbody = document.getElementById('classlistTableBody') || document.querySelector('.classlist-table tbody');
  if (!tbody) return;
  
  if (students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px;">No students found</td></tr>';
    return;
  }
  
  tbody.innerHTML = students.map(student => {
    const progressPercent = student.progress && student.progress.totalLessons > 0
      ? Math.round((student.progress.lessonsCompleted / student.progress.totalLessons) * 100)
      : 0;
    
    const statusClass = student.status === 'On Track' ? 'on-track' 
      : student.status === 'At Risk' ? 'at-risk' 
      : 'needs-attention';
    
    const simulationsCompleted = student.progress?.simulationsCompleted || 0;
    const totalSimulations = student.progress?.totalSimulations || 3;
    const avgQuizScore = student.progress?.avgQuizScore || 0;
    
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
            <span class="simulation-text">${simulationsCompleted} / ${totalSimulations} Completed</span>
            <span class="status-pill ${statusClass}">${student.status || 'Needs Attention'}</span>
          </div>
        </td>
        <td>
          <div class="quiz-avg-cell">
            <span class="quiz-avg-value">${avgQuizScore.toFixed(1)} / 10</span>
            <span class="quiz-avg-caption">Average score</span>
          </div>
        </td>
        <td>
          <button class="view-button" onclick="viewStudent('${student.uid || ''}')">View Details</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderPaginationControls() {
  const totalStudents = filteredStudents.length;
  const totalPages = Math.ceil(totalStudents / pageSize);
  const paginationContainer = document.querySelector('.classlist-pagination');
  const summaryEl = document.querySelector('.classlist-results-summary');
  
  console.log('renderPaginationControls called:', {
    totalStudents,
    totalPages,
    currentPage,
    hasContainer: !!paginationContainer,
    hasSummary: !!summaryEl
  });
  
  if (!paginationContainer) {
    console.error('Pagination container (.classlist-pagination) not found in DOM!');
    return;
  }
  
  // Always show summary
  if (summaryEl) {
    summaryEl.classList.remove('hidden');
    const start = totalStudents > 0 ? (currentPage - 1) * pageSize + 1 : 0;
    const end = Math.min(currentPage * pageSize, totalStudents);
    summaryEl.textContent = totalStudents > 0 
      ? `Showing ${start}–${end} of ${totalStudents} students`
      : 'No students found';
  }
  
  // Clear pagination container
  paginationContainer.innerHTML = '';
  
  // Only show pagination buttons if more than one page
  if (totalPages <= 1) {
    console.log('Only 1 page or less, not showing pagination buttons');
    return;
  }
  
  console.log('Rendering pagination buttons for', totalPages, 'pages');
  
  // Show all numbered page buttons (0-indexed style: 0, 1, 2, 3, 4, 5...)
  // But display as 1-indexed (1, 2, 3, 4, 5, 6...)
  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.className = 'page-btn' + (i === currentPage ? ' active' : '');
    btn.addEventListener('click', () => renderPage(i));
    paginationContainer.appendChild(btn);
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

