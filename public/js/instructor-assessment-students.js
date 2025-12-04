// Instructor Gradebook JavaScript
document.addEventListener('DOMContentLoaded', async function() {
  // Check for token
  const token = localStorage.getItem('instructorToken');
  if (!token) {
    window.location.href = '/caresim-login';
    return;
  }

  const loadingEl = document.getElementById('gradebookLoading');
  const emptyEl = document.getElementById('gradebookEmpty');
  const tableWrapper = document.getElementById('gradebookTableWrapper');
  const tbody = document.getElementById('gradebookTableBody');

  try {
    loadingEl.style.display = 'flex';
    emptyEl.style.display = 'none';
    tableWrapper.style.display = 'none';

    // Load gradebook data
    const data = await instructorAPI.get('/assessment/students');
    const students = data.students || [];

    loadingEl.style.display = 'none';

    if (students.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }

    tableWrapper.style.display = 'block';

    // Render students table
    tbody.innerHTML = students.map(student => {
      const statusClass = student.status === 'AT_RISK' ? 'status-pill--risk' : 'status-pill--ok';
      const statusText = student.status === 'AT_RISK' ? 'At Risk' : 'On Track';

      return `
        <tr style="cursor: pointer;" onclick="window.location.href='/instructor-assessment-student?studentId=${student.uid}'">
          <td>
            <div>
              <strong>${escapeHtml(student.name)}</strong>
              <div style="font-size: 12px; color: #94A3B8; margin-top: 4px;">
                ${escapeHtml(student.studentNumber || student.email || '')}
              </div>
            </div>
          </td>
          <td>
            <div>
              ${student.lms.lessonsCompleted} / ${student.lms.lessonsTotal} lessons
              <div style="font-size: 12px; color: #64748B; margin-top: 4px;">
                Avg progress ${student.lms.avgProgressPercent}%
              </div>
            </div>
          </td>
          <td>
            <div>
              ${student.lms.assessmentsCompleted} / ${student.lms.assessmentsTotal} completed
              <div style="font-size: 12px; color: #64748B; margin-top: 4px;">
                Avg score ${student.lms.avgAssessmentScorePercent}%
              </div>
            </div>
          </td>
          <td>
            <div>
              ${student.game.quizzesTaken} / ${student.game.quizzesTotal} quizzes
              <div style="font-size: 12px; color: #64748B; margin-top: 4px;">
                Avg ${student.game.avgQuizScore.toFixed(1)} / 10
              </div>
            </div>
          </td>
          <td>
            <div>
              ${student.game.simulationsPassed} / ${student.game.simulationsTotal} passed
            </div>
          </td>
          <td>
            <div>
              ${student.tasks.tasksGraded} / ${student.tasks.tasksTotal} graded
              <div style="font-size: 12px; color: #64748B; margin-top: 4px;">
                Avg ${Math.round(student.tasks.avgTaskScorePercent)}%
              </div>
            </div>
          </td>
          <td>
            <span class="status-pill ${statusClass}">${statusText}</span>
          </td>
        </tr>
      `;
    }).join('');

  } catch (error) {
    console.error('Gradebook load error:', error);
    loadingEl.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyEl.innerHTML = `
      <i class="fas fa-exclamation-circle empty-state-icon" style="font-size: 48px; color: #94A3B8; margin-bottom: 16px;"></i>
      <p class="empty-state-text" style="color: #64748B; font-size: 14px; margin: 0;">Failed to load gradebook. Please try again.</p>
    `;
  }
});

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function logout() {
  if (confirm('Are you sure you want to log out?')) {
    localStorage.removeItem('instructorToken');
    window.location.href = '/caresim-login';
  }
}

