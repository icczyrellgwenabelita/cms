// Instructor Student Progress JavaScript
let quizPerformanceChart = null;

document.addEventListener('DOMContentLoaded', async function() {
  // Check for token
  const token = localStorage.getItem('instructorToken');
  if (!token) {
    window.location.href = '/caresim-login';
    return;
  }

  // Get student UID from query string
  const urlParams = new URLSearchParams(window.location.search);
  const uid = urlParams.get('uid');
  
  if (!uid) {
    alert('Student ID not found');
    window.location.href = '/instructor-class-list';
    return;
  }

  try {
    // Load student data
    const data = await instructorAPI.get(`/students/${uid}`);
    const student = data.student;
    
    // Update student info card
    const nameElement = document.querySelector('.student-info-details h2');
    if (nameElement) {
      nameElement.innerHTML = (student.name || 'Unknown') + 
        (student.certificates && student.certificates.caresim_lms_full 
          ? ' <span class="status-pill completed" style="font-size: 12px; vertical-align: middle; margin-left: 8px;">Certificate Issued</span>' 
          : '');
    }
    
    const studentInfo = student.studentInfo || {};
    const metaItems = document.querySelectorAll('.meta-item');
    if (metaItems.length >= 2) {
      metaItems[0].textContent = `Batch: ${studentInfo.batch || 'N/A'}`;
      metaItems[1].textContent = `Student Number: ${studentInfo.studentNumber || 'N/A'}`;
    }
    
    // Calculate overall progress
    const progress = student.progress || {};
    const lessons = progress.lessons || {};
    let completedLessons = 0;
    
    for (let i = 1; i <= 6; i++) {
      const lesson = lessons[`lesson${i}`] || {};
      const quiz = lesson.quiz || {};
      const simulation = lesson.simulation || {};
      
      if (quiz.completed && simulation.completed) {
        completedLessons += 1;
      }
    }
    
    const overallProgress = Math.round((completedLessons / 6) * 100);
    const progressBar = document.querySelector('.overall-progress-section .progress-bar-fill');
    const progressPercent = document.querySelector('.overall-progress-section .progress-percentage');
    if (progressBar) progressBar.style.width = `${overallProgress}%`;
    if (progressPercent) progressPercent.textContent = `${overallProgress}%`;
    
    // Update mini stats
    const miniStats = document.querySelectorAll('.mini-stat-value');
    if (miniStats.length >= 4) {
      const quizAttempts = student.quizHistory?.length || 0;
      const simulationHistory = student.simulationHistory || [];
      const simulationsPassed = simulationHistory.filter(sim => sim.completed && sim.passed).length;
      const certificatesCount = Object.keys(student.certificates || {}).length;

      miniStats[0].textContent = completedLessons;
      miniStats[1].textContent = quizAttempts;
      miniStats[2].textContent = simulationsPassed;
      miniStats[3].textContent = certificatesCount;
    }
    
    // Update breadcrumb
    const breadcrumbCurrent = document.querySelector('.breadcrumb-current');
    if (breadcrumbCurrent) breadcrumbCurrent.textContent = student.name || 'Student';
    
    // Render lesson progress
    renderLessonProgress(lessons);
    
    const quizHistory = student.quizHistory || [];
    // Render quiz history
    renderQuizHistory(quizHistory);
    // Render quiz chart
    renderQuizChart(quizHistory);
    
    // Render simulation history / results
    renderSimulationHistory(student.simulationHistory || []);

    // Hook up instructor notes submit
    setupInstructorNotes(uid);
    
  } catch (error) {
    console.error('Student progress load error:', error);
    alert('Failed to load student progress. Please try again.');
    window.location.href = '/instructor-class-list';
  }
});

function renderLessonProgress(lessons) {
  const container = document.querySelector('.lesson-progress-list');
  if (!container) return;

  const lessonTitles = {
    1: 'Lesson 1 – Monitoring Vital Signs',
    2: 'Lesson 2 – Medication Assistance',
    3: 'Lesson 3 – Meal Preparation and Feeding',
    4: 'Lesson 4 – Personal Care',
    5: 'Lesson 5 – Safety & Emergencies',
    6: 'Lesson 6 – Final Assessment',
  };

  const items = [];

  for (let i = 1; i <= 6; i++) {
    const lessonKey = `lesson${i}`;
    const lesson = lessons[lessonKey] || {};
    const quiz = lesson.quiz || {};
    const simulation = lesson.simulation || {};

    let statusClass = 'not-started';
    let statusLabel = 'Not Started';
    let progressPercent = 0;

    const quizDone = !!quiz.completed || (typeof quiz.highestScore === 'number' && quiz.highestScore > 0);
    const simDone = !!simulation.completed;

    if (quizDone && simDone) {
      statusClass = 'completed';
      statusLabel = 'Completed';
      progressPercent = 100;
    } else if (quizDone || simDone) {
      statusClass = 'in-progress';
      statusLabel = 'In Progress';
      progressPercent = 50;
    }

    items.push(`
      <div class="lesson-progress-item">
        <div class="lesson-progress-header">
          <span class="lesson-name">${lessonTitles[i] || `Lesson ${i}`}</span>
          <span class="lesson-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="lesson-progress-bar-container">
          <div class="lesson-progress-bar-fill" style="width: ${progressPercent}%;"></div>
        </div>
      </div>
    `);
  }

  container.innerHTML = items.join('');
}

function renderQuizHistory(quizHistory) {
  const container = document.querySelector('.quiz-history-table tbody') || 
                    document.querySelector('.quiz-history tbody');
  if (!container) return;
  
  if (!quizHistory || quizHistory.length === 0) {
    container.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px;">No quiz history yet for this student.</td></tr>';
    return;
  }
  
  container.innerHTML = quizHistory.map(quiz => {
    let rawScore = typeof quiz.score === 'number' ? quiz.score : 0;
    // Some entries may store a 0-1 value. Convert those to 0-10.
    if (rawScore <= 1 && rawScore > 0) {
      rawScore = rawScore * 10;
    }
    rawScore = Math.min(Math.max(rawScore, 0), 10);
    const percentage = Math.round((rawScore / 10) * 100);
    const passed = percentage >= 60;

    let quizDate = null;
    if (quiz.timestamp && !Number.isNaN(Date.parse(quiz.timestamp))) {
      quizDate = new Date(quiz.timestamp);
    } else if (quiz.id && !Number.isNaN(Date.parse(quiz.id))) {
      quizDate = new Date(quiz.id);
    }
    const formattedDate = quizDate
      ? quizDate.toLocaleString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        })
      : '—';
    
    return `
      <tr>
        <td>${quiz.lesson || 'Lesson'}</td>
        <td>
          <div class="quiz-score-cell">
            <span class="quiz-score">${rawScore.toFixed(1)} / 10 (${percentage}%)</span>
            <span class="quiz-result ${passed ? 'passed' : 'failed'}">${passed ? 'Passed' : 'Failed'}</span>
          </div>
        </td>
        <td>${formattedDate}</td>
      </tr>
    `;
  }).join('');
}

function renderQuizChart(quizHistory) {
  const canvas = document.getElementById('quizProgressChart');
  if (!canvas) return;

  const wrapper = canvas.parentElement;
  if (!quizHistory || quizHistory.length === 0) {
    wrapper.innerHTML =
      '<p style="padding: 16px; color: #64748B;">No quiz data available to display.</p>';
    return;
  }

  const entries = quizHistory.map((quiz, index) => {
    let timestamp = null;
    if (quiz.timestamp && !Number.isNaN(Date.parse(quiz.timestamp))) {
      timestamp = new Date(quiz.timestamp).getTime();
    } else if (quiz.id && !Number.isNaN(Date.parse(quiz.id))) {
      timestamp = new Date(quiz.id).getTime();
    }

    let rawScore = typeof quiz.score === 'number' ? quiz.score : 0;
    if (rawScore <= 1 && rawScore > 0) {
      rawScore = rawScore * 10;
    }
    rawScore = Math.min(Math.max(rawScore, 0), 10);
    const percentage = Math.round((rawScore / 10) * 100);

    return {
      label: timestamp
        ? new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : `Attempt ${index + 1}`,
      orderKey: timestamp ?? index,
      value: percentage,
    };
  });

  const sorted = entries.sort((a, b) => a.orderKey - b.orderKey);

  if (sorted.length === 0) {
    wrapper.innerHTML =
      '<p style="padding: 16px; color: #64748B;">No quiz data available to display.</p>';
    return;
  }

  if (quizPerformanceChart) {
    quizPerformanceChart.destroy();
  }

  quizPerformanceChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: sorted.map((entry) => entry.label),
      datasets: [
        {
          label: 'Quiz Score (%)',
          data: sorted.map((entry) => entry.value),
          borderColor: '#556B2F',
          backgroundColor: 'rgba(85, 107, 47, 0.15)',
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: '#C19A6B',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: (value) => `${value}%`,
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => `${context.parsed.y}%`,
          },
        },
      },
    },
  });
}

function renderSimulationHistory(simulationHistory) {
  const container = document.querySelector('.simulation-results-list');
  if (!container) return;

  if (!simulationHistory || simulationHistory.length === 0) {
    container.innerHTML =
      '<p style="padding: 16px; color: #64748B;">No simulation history yet for this student.</p>';
    return;
  }

  // Group simulations by lesson
  const byLesson = {};
  simulationHistory.forEach((sim) => {
    const lessonLabel = sim.lesson || 'Unknown Lesson';
    if (!byLesson[lessonLabel]) {
      byLesson[lessonLabel] = {
        lesson: lessonLabel,
        attempts: 0,
        lastTimestamp: null,
        anyCompleted: false,
        anyPassed: false,
      };
    }

    const entry = byLesson[lessonLabel];
    entry.attempts += 1;
    if (sim.completed) {
      entry.anyCompleted = true;
    }
    if (sim.passed) {
      entry.anyPassed = true;
    }

    if (sim.timestamp) {
      const ts = new Date(sim.timestamp).getTime();
      if (!entry.lastTimestamp || ts > entry.lastTimestamp) {
        entry.lastTimestamp = ts;
      }
    }
  });

  const items = Object.values(byLesson)
    // Sort by lesson name
    .sort((a, b) => (a.lesson || '').localeCompare(b.lesson || ''))
    .map((entry) => {
      let statusClass = 'not-started';
      let statusLabel = 'Not Started';

      if (entry.anyPassed) {
        statusClass = 'passed';
        statusLabel = 'Passed';
      } else if (entry.anyCompleted) {
        statusClass = 'pending';
        statusLabel = 'Completed (Not Passed)';
      }

      const lastAttempt =
        entry.lastTimestamp !== null
          ? new Date(entry.lastTimestamp).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
          : '—';

      return `
        <div class="simulation-result-item">
          <div class="simulation-result-header">
            <span class="simulation-title">${entry.lesson}</span>
            <span class="simulation-status ${statusClass}">${statusLabel}</span>
          </div>
          <div class="simulation-result-details">
            <span class="simulation-detail">Attempts: ${entry.attempts}</span>
            <span class="simulation-detail">Last attempt: ${lastAttempt}</span>
          </div>
        </div>
      `;
    });

  container.innerHTML = items.join('');
}

function setupInstructorNotes(uid) {
  const textarea = document.querySelector('.instructor-notes-textarea');
  const button = document.querySelector('.instructor-notes-submit');
  if (!textarea || !button) return;

  button.addEventListener('click', async () => {
    const message = textarea.value.trim();
    if (!message) {
      alert('Please write a note before sending.');
      return;
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Sending...';

    try {
      await instructorAPI.post(`/students/${uid}/notes`, { message });
      textarea.value = '';
      alert('Note sent to student.');
    } catch (error) {
      console.error('Send instructor note error:', error);
      alert('Failed to send note. Please try again.');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });
}

function logout() {
  if (confirm('Are you sure you want to log out?')) {
    localStorage.removeItem('instructorToken');
    window.location.href = '/caresim-login';
  }
}

