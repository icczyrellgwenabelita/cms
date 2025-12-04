// Instructor Per-Student Assessment Detail JavaScript
document.addEventListener('DOMContentLoaded', async function() {
  // Check for token
  const token = localStorage.getItem('instructorToken');
  if (!token) {
    window.location.href = '/caresim-login';
    return;
  }

  // Get studentId from URL
  const urlParams = new URLSearchParams(window.location.search);
  const studentId = urlParams.get('studentId');

  if (!studentId) {
    document.getElementById('error').style.display = 'block';
    document.getElementById('error').innerHTML = '<p>No student ID provided.</p>';
    return;
  }

  const loadingEl = document.getElementById('loading');
  const contentEl = document.getElementById('content');
  const errorEl = document.getElementById('error');

  try {
    loadingEl.style.display = 'flex';
    contentEl.style.display = 'none';
    errorEl.style.display = 'none';

    // Load student assessment detail
    const data = await instructorAPI.get(`/assessment/students/${studentId}`);

    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';

    const student = data.student;
    const summary = data.summary;

    // Update header
    document.getElementById('studentName').textContent = student.name;
    document.getElementById('studentDetails').textContent = 
      `${student.studentNumber ? `Student #: ${student.studentNumber}` : ''}${student.email ? ` | ${student.email}` : ''}`;
    document.getElementById('className').textContent = `Class: ${student.class.className}`;

    // Render summary tiles
    const summaryGrid = document.getElementById('summaryGrid');
    summaryGrid.innerHTML = `
      <div class="summary-tile">
        <h3>LMS Lessons</h3>
        <div class="value">${summary.lmsLessonsCompleted} / ${summary.lmsLessonsTotal}</div>
        <div class="subtext">${summary.lmsAvgProgressPercent}% avg progress</div>
      </div>
      <div class="summary-tile">
        <h3>LMS Assessments</h3>
        <div class="value">${summary.lmsAssessmentsCompleted} / ${summary.lmsAssessmentsTotal}</div>
        <div class="subtext">${summary.lmsAvgAssessmentScorePercent}% avg score</div>
      </div>
      <div class="summary-tile">
        <h3>Game Quizzes</h3>
        <div class="value">${summary.quizzesTaken} / ${summary.gameQuizzesTotal}</div>
        <div class="subtext">${summary.gameAvgQuizScore.toFixed(1)} / 10 avg</div>
      </div>
      <div class="summary-tile">
        <h3>Game Simulations</h3>
        <div class="value">${summary.gameSimulationsPassed} / ${summary.gameSimulationsTotal}</div>
        <div class="subtext">passed</div>
      </div>
      <div class="summary-tile">
        <h3>Tasks</h3>
        <div class="value">${summary.tasksGraded} / ${summary.tasksTotal}</div>
        <div class="subtext">${Math.round(summary.taskAvgScorePercent)}% avg</div>
      </div>
      <div class="summary-tile">
        <h3>Status</h3>
        <div class="value" style="font-size: 18px;">
          <span class="status-pill ${summary.status === 'AT_RISK' ? 'status-pill--risk' : 'status-pill--ok'}">
            ${summary.status === 'AT_RISK' ? 'At Risk' : 'On Track'}
          </span>
        </div>
      </div>
    `;

    // Render LMS Lessons
    const lmsLessons = data.lmsLessons || [];
    const lmsLessonsBody = document.getElementById('lmsLessonsBody');
    const lmsLessonsEmpty = document.getElementById('lmsLessonsEmpty');
    
    if (lmsLessons.length === 0) {
      lmsLessonsBody.parentElement.parentElement.style.display = 'none';
      lmsLessonsEmpty.style.display = 'block';
    } else {
      lmsLessonsEmpty.style.display = 'none';
      lmsLessonsBody.innerHTML = lmsLessons.map(lesson => `
        <tr>
          <td><strong>${escapeHtml(lesson.lessonTitle)}</strong></td>
          <td>${lesson.pagesCompleted} / ${lesson.totalPages}</td>
          <td>${lesson.progressPercent}%</td>
          <td>${lesson.completed ? 'Yes' : 'No'}</td>
        </tr>
      `).join('');
    }

    // Render LMS Assessments
    const lmsAssessments = data.lmsAssessments || [];
    const lmsAssessmentsBody = document.getElementById('lmsAssessmentsBody');
    const lmsAssessmentsEmpty = document.getElementById('lmsAssessmentsEmpty');
    
    if (lmsAssessments.length === 0) {
      lmsAssessmentsBody.parentElement.parentElement.style.display = 'none';
      lmsAssessmentsEmpty.style.display = 'block';
    } else {
      lmsAssessmentsEmpty.style.display = 'none';
      lmsAssessmentsBody.innerHTML = lmsAssessments.map(assessment => `
        <tr>
          <td><strong>${escapeHtml(assessment.title)}</strong></td>
          <td>${escapeHtml(assessment.lessonTitle)}</td>
          <td>${assessment.bestScorePercent}%</td>
          <td>${assessment.attempts}</td>
          <td>${assessment.passed ? 'Yes' : 'No'}</td>
        </tr>
      `).join('');
    }

    // Render Game Quizzes
    const gameQuizzes = data.gameQuizzes || [];
    const gameQuizzesBody = document.getElementById('gameQuizzesBody');
    const gameQuizzesEmpty = document.getElementById('gameQuizzesEmpty');
    
    if (gameQuizzes.length === 0) {
      gameQuizzesBody.parentElement.parentElement.style.display = 'none';
      gameQuizzesEmpty.style.display = 'block';
    } else {
      gameQuizzesEmpty.style.display = 'none';
      gameQuizzesBody.innerHTML = gameQuizzes.map(quiz => `
        <tr>
          <td><strong>${escapeHtml(quiz.lessonTitle)}</strong></td>
          <td>${quiz.bestScore.toFixed(1)} / 10</td>
          <td>${quiz.attempts}</td>
        </tr>
      `).join('');
    }

    // Render Game Simulations
    const gameSimulations = data.gameSimulations || [];
    const gameSimulationsBody = document.getElementById('gameSimulationsBody');
    const gameSimulationsEmpty = document.getElementById('gameSimulationsEmpty');
    
    if (gameSimulations.length === 0) {
      gameSimulationsBody.parentElement.parentElement.style.display = 'none';
      gameSimulationsEmpty.style.display = 'block';
    } else {
      gameSimulationsEmpty.style.display = 'none';
      gameSimulationsBody.innerHTML = gameSimulations.map(sim => `
        <tr>
          <td><strong>${escapeHtml(sim.simulationTitle)}</strong></td>
          <td>${sim.completed ? 'Yes' : 'No'}</td>
          <td>${sim.passed ? 'Yes' : 'No'}</td>
          <td>${sim.attempts}</td>
        </tr>
      `).join('');
    }

    // Render Tasks
    const tasks = data.tasks || [];
    const tasksBody = document.getElementById('tasksBody');
    const tasksEmpty = document.getElementById('tasksEmpty');
    
    if (tasks.length === 0) {
      tasksBody.parentElement.parentElement.style.display = 'none';
      tasksEmpty.style.display = 'block';
    } else {
      tasksEmpty.style.display = 'none';
      tasksBody.innerHTML = tasks.map(task => {
        const statusClass = task.status === 'graded' ? 'status-pill--ok' : 
                           task.status === 'late' ? 'status-pill--risk' : 
                           task.status === 'submitted' ? 'status-pill--warning' : '';
        const statusText = task.status === 'graded' ? 'Graded' :
                          task.status === 'late' ? 'Late' :
                          task.status === 'submitted' ? 'Submitted' : 'Missing';
        
        const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '--';
        const submittedAt = task.submittedAt ? new Date(task.submittedAt).toLocaleDateString() : '--';
        const scoreDisplay = task.score !== null ? `${task.score} / ${task.maxScore}` : '--';
        
        return `
          <tr>
            <td><strong>${escapeHtml(task.title)}</strong></td>
            <td>${dueDate}</td>
            <td>${scoreDisplay}</td>
            <td>${task.scorePercent > 0 ? Math.round(task.scorePercent) + '%' : '--'}</td>
            <td>${submittedAt}</td>
            <td><span class="status-pill ${statusClass}">${statusText}</span></td>
          </tr>
        `;
      }).join('');
    }

  } catch (error) {
    console.error('Student assessment detail load error:', error);
    loadingEl.style.display = 'none';
    errorEl.style.display = 'block';
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

