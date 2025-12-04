// Instructor Assessment Overview JavaScript
// This page displays:
// - Game Quiz Analytics (Unity game quizzes from users/{uid}/progress/lessonX/quiz)
// - Game Simulation Analytics (Unity game simulations from users/{uid}/progress/lessonX/simulation)
// - Instructor Task Analytics (Tasks from classPosts and classTaskSubmissions)
// NOTE: LMS (web) lesson/page analytics are NOT included on this page
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
    const taskSummary = data.taskSummary || {};
    const lmsSummary = data.lmsSummary || {};
    const lowScoringQuizzes = data.lowScoringQuizzes || [];
    const simulationSummary = data.simulationSummary || {};
    
    // Update summary stats from API
    // NOTE: These are GAME metrics (Unity game quizzes and simulations), not LMS
    const statValues = document.querySelectorAll('.instructor-stat-value');
    if (statValues.length >= 4) {
      // avgQuizScore is GAME quiz average in raw format (0-10), display as "X.X / 10"
      statValues[0].textContent = `${(stats.avgQuizScore || 0).toFixed(1)} / 10`;
      statValues[1].textContent = stats.totalQuizAttempts || 0; // GAME quiz attempts
      statValues[2].textContent = `${Math.round(stats.simulationPassRate || 0)}%`; // GAME simulation pass rate
      statValues[3].textContent = stats.atRiskStudents || 0; // Based on game + tasks
    }
    
    // Render GAME lesson assessments table (6 fixed Unity game lessons)
    renderLessonAssessments(assessments.lessons || []);
    
    // Render GAME simulation assessments (6 fixed Unity game lessons)
    renderSimulationAssessments(assessments.simulations || []);
    
    // Render task assessments
    renderTaskAssessments(taskSummary.tasksByPost || []);
    renderTaskSummary(taskSummary);
    
    // Render LMS analytics
    renderLmsLessonProgress(lmsSummary.lessons || []);
    renderLmsAssessmentPerformance(lmsSummary.assessments || []);
    
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
  // Render GAME quiz analytics table (6 fixed Unity game lessons)
  // Data source: users/{uid}/progress/lessonX/quiz
  const quizPanel = document.querySelector('#quiz');
  const container = quizPanel ? quizPanel.querySelector('.assessment-table tbody') : null;
  if (!container) {
    console.error('Game quiz table container not found');
    return;
  }
  
  if (lessons.length === 0) {
    container.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No game lesson data</td></tr>';
    return;
  }
  
  container.innerHTML = lessons.map(lesson => {
    // avgQuizScore is GAME quiz average in raw format (0-10)
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
  // Render GAME simulation analytics table (6 fixed Unity game lessons)
  // Data source: users/{uid}/progress/lessonX/simulation
  const simPanel = document.querySelector('#simulation');
  const container = simPanel ? simPanel.querySelector('.assessment-table tbody') : null;
  if (!container) {
    console.error('Game simulation table container not found');
    return;
  }
  
  if (simulations.length === 0) {
    container.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px;">No game simulation data</td></tr>';
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
  // Render GAME simulation status summary (6 fixed Unity game lessons)
  const summaryItems = document.querySelectorAll('#simulation .simulation-summary-item');
  if (summaryItems.length >= 3) {
    summaryItems[0].querySelector('.summary-value').textContent = `${summary.completedAll || 0} students`;
    summaryItems[1].querySelector('.summary-value').textContent = `${summary.inProgress || 0} students`;
    summaryItems[2].querySelector('.summary-value').textContent = `${summary.notStarted || 0} students`;
  }
}

function renderTaskAssessments(tasks) {
  // Render INSTRUCTOR TASK analytics (separate from game quizzes/simulations)
  // Data source: classPosts (type: 'task') and classTaskSubmissions
  const tasksPanel = document.querySelector('#tasks');
  const container = tasksPanel ? tasksPanel.querySelector('.assessment-table tbody') : null;
  if (!container) {
    console.error('Tasks table container not found');
    return;
  }
  
  if (tasks.length === 0) {
    container.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No instructor tasks created yet</td></tr>';
    return;
  }
  
  container.innerHTML = tasks.map(task => {
    const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }) : '--';
    
    const scoreClass = task.avgScorePercent >= 80 ? 'high' : task.avgScorePercent >= 60 ? 'medium' : 'low';
    
    return `
      <tr>
        <td><strong>${task.title}</strong></td>
        <td><span class="score-badge ${scoreClass}">${task.avgScorePercent.toFixed(1)}%</span></td>
        <td>${Math.round(task.completionRate)}%</td>
        <td>${dueDate}</td>
      </tr>
    `;
  }).join('');
}

function renderTaskSummary(summary) {
  const totalTasksEl = document.getElementById('taskTotalTasks');
  const totalGradedEl = document.getElementById('taskTotalGraded');
  const avgScoreEl = document.getElementById('taskAvgScore');
  
  if (totalTasksEl) {
    totalTasksEl.textContent = summary.totalTasks || 0;
  }
  if (totalGradedEl) {
    totalGradedEl.textContent = summary.totalGraded || 0;
  }
  if (avgScoreEl) {
    avgScoreEl.textContent = summary.avgTaskScorePercent > 0
      ? `${summary.avgTaskScorePercent.toFixed(1)}%`
      : '--';
  }
}

function renderLmsLessonProgress(lessons) {
  // Render LMS lesson progress table
  // Data source: users/{uid}/lmsProgress/lesson{slot}/completedPages
  const lmsPanel = document.querySelector('#lms');
  const container = lmsPanel ? lmsPanel.querySelector('#lmsLessonsTableBody') : null;
  if (!container) {
    console.error('LMS lessons table container not found');
    return;
  }
  
  if (lessons.length === 0) {
    container.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">No LMS lesson analytics available yet.</td></tr>';
    return;
  }
  
  container.innerHTML = lessons.map(lesson => {
    const progressClass = lesson.avgProgressPercent >= 80 ? 'high' : lesson.avgProgressPercent >= 50 ? 'medium' : 'low';
    
    return `
      <tr>
        <td><strong>${lesson.title}</strong></td>
        <td><span class="score-badge ${progressClass}">${lesson.avgProgressPercent}%</span></td>
        <td>${lesson.completionRate}%</td>
        <td>${lesson.studentsCompleted}</td>
      </tr>
    `;
  }).join('');
}

function renderLmsAssessmentPerformance(assessments) {
  // Render LMS assessment performance table
  // Data source: users/{uid}/lmsAssessmentHistory/lesson{slot}/page_{pageId}/attempt_*
  const lmsPanel = document.querySelector('#lms');
  const container = lmsPanel ? lmsPanel.querySelector('#lmsAssessmentsTableBody') : null;
  if (!container) {
    console.error('LMS assessments table container not found');
    return;
  }
  
  if (assessments.length === 0) {
    container.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">No LMS assessments found for this class.</td></tr>';
    return;
  }
  
  container.innerHTML = assessments.map(assessment => {
    const scoreClass = assessment.avgScorePercent >= 80 ? 'high' : assessment.avgScorePercent >= 70 ? 'medium' : 'low';
    
    return `
      <tr>
        <td><strong>${assessment.title}</strong></td>
        <td>${assessment.lessonTitle}</td>
        <td><span class="score-badge ${scoreClass}">${assessment.avgScorePercent}%</span></td>
        <td>${assessment.avgAttempts.toFixed(1)}</td>
        <td>${assessment.passRatePercent}%</td>
      </tr>
    `;
  }).join('');
}

function logout() {
  if (confirm('Are you sure you want to log out?')) {
    localStorage.removeItem('instructorToken');
    window.location.href = '/caresim-login';
  }
}

