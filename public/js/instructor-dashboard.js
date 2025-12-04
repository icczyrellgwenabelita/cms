// Instructor Dashboard JavaScript
document.addEventListener('DOMContentLoaded', async function() {
  // Check for token
  const token = localStorage.getItem('instructorToken');
  if (!token) {
    window.location.href = '/caresim-login';
    return;
  }

  try {
    // Load student progress data (for stat cards)
    const progressResponse = await instructorAPI.get('/class/students/progress');
    
    if (!progressResponse.success || !progressResponse.students) {
      console.error('Failed to load student progress');
      return;
    }

    const students = progressResponse.students;
    
    // Calculate aggregated stats
    const totalStudents = students.length;
    
    // Calculate average quiz score
    let totalQuizScore = 0;
    let quizCount = 0;
    let totalLessonsCompleted = 0;
    let totalSimulationsPassed = 0;
    
    students.forEach(student => {
      if (student.game && student.game.avgQuizScore > 0) {
        totalQuizScore += student.game.avgQuizScore;
        quizCount += 1;
      }
      if (student.lms) {
        totalLessonsCompleted += student.lms.lessonsCompleted || 0;
      }
      if (student.game) {
        totalSimulationsPassed += student.game.simulationsPassed || 0;
      }
    });
    
    const avgQuizScore = quizCount > 0 ? (totalQuizScore / quizCount) : 0;
    const avgLessonsCompleted = totalStudents > 0 ? (totalLessonsCompleted / totalStudents) : 0;
    
    // Update stat cards
    document.getElementById('statTotalStudents').textContent = totalStudents;
    document.getElementById('statAvgQuizScore').textContent = `${avgQuizScore.toFixed(1)} / 10`;
    document.getElementById('statLessonsCompleted').textContent = `${avgLessonsCompleted.toFixed(1)} / 6`;
    document.getElementById('statSimulationsPassed').textContent = totalSimulationsPassed;
    
    // Load lesson metadata for performance table
    const lessonsRef = await fetch('/api/public/lessons')
      .then(r => r.ok ? r.json() : { lessons: {} })
      .catch(() => ({ lessons: {} }));
    const lessons = lessonsRef.lessons || {};

    // Also load instructor dashboard summary for per-lesson performance
    // This endpoint already aggregates quiz scores and completion rates
    let dashboardData = null;
    try {
      dashboardData = await instructorAPI.get('/dashboard');
    } catch (e) {
      console.warn('Failed to load instructor dashboard lesson performance:', e);
    }

    const performanceFromApi = Array.isArray(dashboardData?.lessonPerformance)
      ? dashboardData.lessonPerformance
      : [];

    const tableBody = document.getElementById('lessonPerformanceTable');

    // Build final lesson performance rows using published lessons list
    const publishedSlots = Object.keys(lessons);

    if (publishedSlots.length === 0 || !tableBody) {
      if (tableBody) {
        tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px;">No lesson data available yet</td></tr>';
      }
      return;
    }

    const rows = [];
    publishedSlots.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    publishedSlots.forEach(slotKey => {
      const slot = parseInt(slotKey, 10);
      const lessonMeta = lessons[slotKey] || {};

      // Find matching performance entry from /api/instructor/dashboard
      const perf = performanceFromApi.find(p => Number(p.lessonId) === slot) || null;

      const title = lessonMeta.title || perf?.lessonTitle || `Lesson ${slot}`;
      const avgScore = Number.isFinite(perf?.avgQuizScore) ? perf.avgQuizScore : 0;
      const completionRate = Number.isFinite(perf?.completionRate) ? perf.completionRate : 0;

      const scoreClass =
        avgScore >= 8 ? 'high' :
        avgScore >= 6 ? 'medium' :
        'low';

      rows.push(`
        <tr>
          <td><strong>${title}</strong></td>
          <td><span class="score-badge ${scoreClass}">${avgScore.toFixed(1)} / 10</span></td>
          <td>${completionRate.toFixed(0)}%</td>
        </tr>
      `);
    });

    if (rows.length > 0) {
      tableBody.innerHTML = rows.join('');
    } else {
      tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px;">No lesson data available yet</td></tr>';
    }

  } catch (error) {
    console.error('Dashboard load error:', error);
    alert('Failed to load dashboard data. Please try again.');
  }
});
