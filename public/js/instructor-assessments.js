// Instructor Assessment Overview JavaScript
document.addEventListener('DOMContentLoaded', async function() {
  // Check for token
  const token = localStorage.getItem('instructorToken');
  if (!token) {
    window.location.href = '/caresim-login';
    return;
  }

  try {
    // Load assessment data
    const data = await instructorAPI.get('/assessments');
    const assessments = data.assessments;
    const stats = data.stats || {};
    const lowScoringQuizzes = data.lowScoringQuizzes || [];
    const simulationSummary = data.simulationSummary || {};
    
    // Update summary stats from API
    const statValues = document.querySelectorAll('.instructor-stat-value');
    if (statValues.length >= 4) {
      // avgQuizScore is in raw format (0-10), display as "X.X / 10"
      statValues[0].textContent = `${(stats.avgQuizScore || 0).toFixed(1)} / 10`;
      statValues[1].textContent = stats.totalQuizAttempts || 0;
      statValues[2].textContent = `${Math.round(stats.simulationPassRate || 0)}%`;
      statValues[3].textContent = stats.atRiskStudents || 0;
    }
    
    // Render lesson assessments table
    renderLessonAssessments(assessments.lessons || []);
    
    // Render simulation assessments
    renderSimulationAssessments(assessments.simulations || []);
    
    // Render low-scoring quizzes
    renderLowScoringQuizzes(lowScoringQuizzes);
    
    // Render simulation status summary
    renderSimulationSummary(simulationSummary);
    
  } catch (error) {
    console.error('Assessment overview load error:', error);
    alert('Failed to load assessment data. Please try again.');
  }
});

function renderLessonAssessments(lessons) {
  // Find the quiz analytics table (first assessment-table in quiz panel)
  const quizPanel = document.querySelector('#quiz');
  const container = quizPanel ? quizPanel.querySelector('.assessment-table tbody') : null;
  if (!container) {
    console.error('Quiz table container not found');
    return;
  }
  
  if (lessons.length === 0) {
    container.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No lesson data</td></tr>';
    return;
  }
  
  container.innerHTML = lessons.map(lesson => {
    // avgQuizScore is in raw format (0-10)
    const scoreClass = lesson.avgQuizScore >= 8 ? 'high' : lesson.avgQuizScore >= 6 ? 'medium' : 'low';
    
    return `
      <tr>
        <td><strong>${lesson.lessonTitle}</strong></td>
        <td><span class="score-badge ${scoreClass}">${lesson.avgQuizScore.toFixed(1)} / 10</span></td>
        <td>${lesson.attempts || 0}</td>
        <td>${Math.round(lesson.completionRate)}%</td>
      </tr>
    `;
  }).join('');
}

function renderSimulationAssessments(simulations) {
  // Find the simulation analytics table (first assessment-table in simulation panel)
  const simPanel = document.querySelector('#simulation');
  const container = simPanel ? simPanel.querySelector('.assessment-table tbody') : null;
  if (!container) {
    console.error('Simulation table container not found');
    return;
  }
  
  if (simulations.length === 0) {
    container.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px;">No simulation data</td></tr>';
    return;
  }
  
  container.innerHTML = simulations.map(sim => {
    const studentsCompleted = sim.studentsCompleted || 0;
    const totalStudents = sim.totalStudents || 0;
    
    return `
      <tr>
        <td><strong>${sim.lessonTitle}</strong></td>
        <td>${Math.round(sim.simulationPassRate)}%</td>
        <td>${studentsCompleted}${totalStudents > 0 ? ` / ${totalStudents}` : ''}</td>
      </tr>
    `;
  }).join('');
}

function renderLowScoringQuizzes(lowScoringQuizzes) {
  const container = document.querySelector('.low-scoring-list');
  if (!container) {
    console.error('Low-scoring quizzes container not found');
    return;
  }
  
  if (lowScoringQuizzes.length === 0) {
    container.innerHTML = '<div class="low-score-item"><p style="text-align: center; padding: 20px; color: #666;">No low-scoring quizzes</p></div>';
    return;
  }
  
  container.innerHTML = lowScoringQuizzes.map(quiz => {
    return `
      <div class="low-score-item">
        <div class="low-score-icon">!</div>
        <div>
          <p class="low-score-title">${quiz.lessonTitle}</p>
          <span class="low-score-subtext">${quiz.studentsBelow60} student${quiz.studentsBelow60 !== 1 ? 's' : ''} below 60%</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderSimulationSummary(summary) {
  const summaryItems = document.querySelectorAll('.simulation-summary-item');
  if (summaryItems.length >= 3) {
    summaryItems[0].querySelector('.summary-value').textContent = `${summary.completedAll || 0} students`;
    summaryItems[1].querySelector('.summary-value').textContent = `${summary.inProgress || 0} students`;
    summaryItems[2].querySelector('.summary-value').textContent = `${summary.notStarted || 0} students`;
  }
}

function logout() {
  if (confirm('Are you sure you want to log out?')) {
    localStorage.removeItem('instructorToken');
    window.location.href = '/caresim-login';
  }
}

