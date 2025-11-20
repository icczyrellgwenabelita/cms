// Instructor Dashboard JavaScript
document.addEventListener('DOMContentLoaded', async function() {
  // Check for token
  const token = localStorage.getItem('instructorToken');
  if (!token) {
    window.location.href = '/caresim-login';
    return;
  }

  try {
    // Load dashboard data
    const data = await instructorAPI.get('/dashboard');

    // Update statistics
    const statValues = document.querySelectorAll('.instructor-stat-value');
    if (statValues.length >= 4) {
      statValues[0].textContent = data.stats.totalStudents;
      // avgQuizScore is in raw format (0-10), display as "X.X / 10"
      statValues[1].textContent = `${data.stats.avgQuizScore.toFixed(1)} / 10`;
      statValues[2].textContent = `${Math.round(data.stats.avgSimulationCompletionRate)}%`;
      statValues[3].textContent = data.stats.atRiskStudents;
    }

    // Update recent activity
    const activityList = document.querySelector('.activity-list');
    if (activityList && data.recentActivity && data.recentActivity.length > 0) {
      activityList.innerHTML = data.recentActivity.map(activity => {
        const date = new Date(activity.date);
        const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const icon = activity.type === 'quiz' 
          ? '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 11L12 14L22 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 12L11 14L15 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        
        return `
          <div class="activity-item">
            <div class="activity-icon">${icon}</div>
            <div class="activity-content">
              <p class="activity-text">${activity.name} ${activity.type === 'quiz' ? 'completed' : activity.scoreOrResult} ${activity.type === 'quiz' ? `Quiz: ${activity.lesson}` : `Simulation ${activity.lesson}`}</p>
              <span class="activity-time">${formattedDate}</span>
            </div>
          </div>
        `;
      }).join('');
    } else if (activityList) {
      activityList.innerHTML = '<div class="activity-item"><p class="activity-text">No recent activity</p></div>';
    }

    // Update attention summary (if exists)
    const attentionItems = document.querySelectorAll('.attention-summary-item');
    if (attentionItems.length >= 3) {
      // At-Risk Students
      attentionItems[0].querySelector('.attention-value').textContent = data.stats.atRiskStudents || 0;
      // Inactive Students
      attentionItems[1].querySelector('.attention-value').textContent = data.stats.inactiveStudents || 0;
      // No Simulations Completed
      attentionItems[2].querySelector('.attention-value').textContent = data.stats.noSimulationsCompleted || 0;
    }

    // Update class performance overview table
    const performanceTable = document.querySelector('.performance-table tbody');
    if (performanceTable && data.lessonPerformance && data.lessonPerformance.length > 0) {
      performanceTable.innerHTML = data.lessonPerformance.map(lesson => {
        // avgQuizScore is in raw format (0-10)
        const scoreClass = lesson.avgQuizScore >= 8 ? 'high' : lesson.avgQuizScore >= 6 ? 'medium' : 'low';
        return `
          <tr>
            <td><strong>${lesson.lessonTitle}</strong></td>
            <td><span class="score-badge ${scoreClass}">${lesson.avgQuizScore.toFixed(1)} / 10</span></td>
            <td>${lesson.completionRate.toFixed(0)}%</td>
          </tr>
        `;
      }).join('');
    } else if (performanceTable) {
      performanceTable.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px;">No lesson data available</td></tr>';
    }

  } catch (error) {
    console.error('Dashboard load error:', error);
    alert('Failed to load dashboard data. Please try again.');
  }
});

// Logout function
function logout() {
  if (confirm('Are you sure you want to log out?')) {
    localStorage.removeItem('instructorToken');
    window.location.href = '/caresim-login';
  }
}

