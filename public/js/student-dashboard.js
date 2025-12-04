// CareSim Student Dashboard
// Rebuilt to use /api/student/dashboard with clear separation between
// LMS (lmsProgress) and Game (progress) data paths.

const studentDashboardState = {
  lms: {
    lessons: [],
    totals: {}
  },
  game: null,
  user: null,
  quickLinks: {
    lesson: null,
    quiz: null,
    tools: '/student-tools',
    certificates: '/student-certificates'
  }
};

function getStudentToken() {
  return localStorage.getItem('studentToken');
}

// ------------- Generic helpers -------------

function getNumeric(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatScore10(score) {
  if (typeof score === 'number' && !Number.isNaN(score)) {
    return `${score}/10`;
  }
  return '--';
}

function formatPercent(value) {
  const v = getNumeric(value, 0);
  return `${Math.round(v)}%`;
}

// ------------- Greeting helpers -------------

function getTimeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getFirstName(fullName) {
  if (!fullName || typeof fullName !== 'string') return 'Student';
  return fullName.split(' ')[0];
}

function updateDashboardGreeting(user = {}) {
  const titleEl = document.querySelector('.dashboard-greeting-title');
  if (!titleEl) return;

  const greeting = getTimeOfDayGreeting();
  const firstName = getFirstName(user.name || user.fullName || '');
  titleEl.textContent = `${greeting}, ${firstName} 👋`;
}

// ------------- Profile + header -------------

function updateProfileHeader(userSummary = {}) {
  const name =
    userSummary.name ||
    userSummary.fullName ||
    userSummary.email ||
    'Student';

  const greetingEl = document.getElementById('profileGreeting');
  if (greetingEl) {
    greetingEl.textContent = 'STUDENT PROFILE';
  }

  const profileName = document.getElementById('profileName');
  if (profileName) profileName.textContent = name;

  const initialEl = document.getElementById('profileInitial');
  if (initialEl) initialEl.textContent = (name.charAt(0) || '?').toUpperCase();

  const batchEl = document.getElementById('profileBatch');
  if (batchEl) batchEl.textContent = userSummary.batch || '—';

  const instructorEl = document.getElementById('profileInstructor');
  if (instructorEl) {
    instructorEl.textContent = userSummary.assignedInstructorName || 'Not assigned';
  }

  const emailEl = document.getElementById('profileEmail');
  if (emailEl) {
    emailEl.textContent = userSummary.email || '—';
  }

  const lastLoginEl = document.getElementById('profileLastLogin');
  if (lastLoginEl) {
    const raw = userSummary.lastLogin;
    if (raw) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) {
        lastLoginEl.textContent = d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
      } else {
        lastLoginEl.textContent = '—';
      }
    } else {
      lastLoginEl.textContent = '—';
    }
  }
}

function updateSummaryCards(lmsTotals = {}) {
  const lessonsCompleted = getNumeric(lmsTotals.lessonsCompleted, 0);
  const avgQuizScore = lmsTotals.avgQuizScore ?? null;
  const totalQuizAttempts = getNumeric(lmsTotals.totalQuizAttempts, 0);
  const totalSimulationAttempts = getNumeric(lmsTotals.totalSimulationAttempts, 0);

  const lessonsCountEl = document.getElementById('profileLessonsCount');
  if (lessonsCountEl) lessonsCountEl.textContent = lessonsCompleted;

  const quizzesCountEl = document.getElementById('profileQuizzesCount');
  if (quizzesCountEl) quizzesCountEl.textContent = totalQuizAttempts;

  const simsCountEl = document.getElementById('profileSimulationsCount');
  if (simsCountEl) simsCountEl.textContent = totalSimulationAttempts;

  const avgScoreEl = document.getElementById('profileAverageScore');
  if (avgScoreEl) {
    if (avgQuizScore !== null && avgQuizScore !== undefined) {
      avgScoreEl.textContent = `${Math.round(avgQuizScore * 10) / 10}`;
    } else {
      avgScoreEl.textContent = '—';
    }
  }

  // Overall progress is derived from lessonsCompleted / 6
  const totalLessons = 6;
  const overallPct =
    totalLessons > 0 ? Math.round((lessonsCompleted / totalLessons) * 100) : 0;

  const overallTextEl = document.getElementById('profileOverallProgress');
  if (overallTextEl) {
    overallTextEl.textContent = `${overallPct}%`;
  }

  setDonutProgress(overallPct);

  const lessonsStat = document.getElementById('progressLessonsStat');
  if (lessonsStat) {
    lessonsStat.textContent = `${lessonsCompleted}/${totalLessons} complete`;
  }

  const quizStat = document.getElementById('progressQuizzesStat');
  if (quizStat) {
    quizStat.textContent = `${totalQuizAttempts} taken`;
  }

  const simStat = document.getElementById('progressSimsStat');
  if (simStat) {
    simStat.textContent = `${totalSimulationAttempts} attempts`;
  }

  // Quiz performance card
  const quizAverageScore = document.getElementById('quizAverageScore');
  if (quizAverageScore) {
    if (avgQuizScore !== null && avgQuizScore !== undefined) {
      quizAverageScore.textContent = (Math.round(avgQuizScore * 10) / 10).toFixed(1);
    } else {
      quizAverageScore.textContent = '--';
    }
  }

  const quizCompletedCount = document.getElementById('quizCompletedCount');
  if (quizCompletedCount) {
    quizCompletedCount.textContent = lessonsCompleted;
  }

  const quizBestScore = document.getElementById('quizBestScore');
  if (quizBestScore) {
    // Best score across lessons
    const best = (studentDashboardState.lms.lessons || []).reduce(
      (max, lesson) => Math.max(max, getNumeric(lesson.quiz?.highestScore, 0)),
      0
    );
    quizBestScore.textContent = best > 0 ? `${best.toFixed(1)} / 10` : '--';
  }

  const quizGoalProgress = document.getElementById('quizGoalProgress');
  if (quizGoalProgress) {
    const ratio =
      avgQuizScore && avgQuizScore > 0 ? Math.min(avgQuizScore / 8, 1) : 0;
    const pct = Math.round(ratio * 100);
    quizGoalProgress.style.width = `${pct}%`;
    quizGoalProgress.setAttribute('aria-valuenow', String(pct));
  }
}

// ------------- Top stats (6 boxes) -------------

function computeDashboardStats() {
  const lessons = studentDashboardState.lms.lessons || [];
  const lmsTotals = studentDashboardState.lms.totals || {};
  const game = studentDashboardState.game || null;

  const totalLessons = 6;

  // LMS aggregates
  let lessonsCompleted = 0;
  let assessmentsCompleted = 0;
  let simulationsPassed = 0;

  lessons.forEach((lesson) => {
    const status = String(lesson.status || '').toLowerCase();
    if (status === 'completed') lessonsCompleted += 1;

    const completedPages = getNumeric(lesson.completedPages, 0);
    assessmentsCompleted += completedPages;

    const sim = lesson.simulation || {};
    if (sim.completed && sim.passed) {
      simulationsPassed += 1;
    }
  });

  // Prefer backend total if provided for lessonsCompleted
  if (typeof lmsTotals.lessonsCompleted === 'number') {
    lessonsCompleted = getNumeric(lmsTotals.lessonsCompleted, lessonsCompleted);
  }

  // Game lessons completed from backend totals if available
  let gameLessonsCompleted = 0;
  if (game && game.totals && typeof game.totals.gameLessonsCompleted === 'number') {
    gameLessonsCompleted = getNumeric(game.totals.gameLessonsCompleted, 0);
  }

  // Game quiz average (Unity) from per-lesson quiz.highestScore
  let totalGameScore = 0;
  let countedGameLessons = 0;
  if (game && Array.isArray(game.lessons)) {
    game.lessons.forEach((lesson) => {
      const quiz = lesson.quiz || {};
      const attempts = getNumeric(quiz.attempts, 0);
      const score = getNumeric(quiz.highestScore, NaN);
      if (attempts > 0 && Number.isFinite(score)) {
        totalGameScore += score;
        countedGameLessons += 1;
      }
    });
  }
  const gameQuizAverage =
    countedGameLessons > 0 ? totalGameScore / countedGameLessons : 0;

  // Overall progress: 50% from LMS + 50% from Game
  const lmsProgressPct =
    totalLessons > 0 ? (lessonsCompleted / totalLessons) * 50 : 0;
  const gameProgressPct =
    totalLessons > 0 ? (gameLessonsCompleted / totalLessons) * 50 : 0;
  const overallLmsProgress = Math.round(lmsProgressPct + gameProgressPct);

  return {
    lessonsCompleted,
    assessmentsCompleted,
    simulationsPassed,
    gameLessonsCompleted,
    gameQuizAverage,
    overallLmsProgress
  };
}

function updateDashboardStats(stats) {
  const safeStats = stats || {};

  const lessonsCompletedEl = document.getElementById('stat-lessons-completed');
  if (lessonsCompletedEl) {
    lessonsCompletedEl.textContent = getNumeric(safeStats.lessonsCompleted, 0);
  }

  const assessmentsCompletedEl = document.getElementById(
    'stat-assessments-completed'
  );
  if (assessmentsCompletedEl) {
    assessmentsCompletedEl.textContent = getNumeric(
      safeStats.assessmentsCompleted,
      0
    );
  }

  const simulationsPassedEl = document.getElementById('stat-simulations-passed');
  if (simulationsPassedEl) {
    simulationsPassedEl.textContent = getNumeric(safeStats.simulationsPassed, 0);
  }

  const gameLessonsCompletedEl = document.getElementById(
    'stat-game-lessons-completed'
  );
  if (gameLessonsCompletedEl) {
    gameLessonsCompletedEl.textContent = getNumeric(
      safeStats.gameLessonsCompleted,
      0
    );
  }

  const gameQuizAverageEl = document.getElementById('stat-game-quiz-average');
  if (gameQuizAverageEl) {
    const avg = getNumeric(safeStats.gameQuizAverage, 0);
    gameQuizAverageEl.textContent = avg.toFixed(1);
  }

  const overallLmsProgressEl = document.getElementById(
    'stat-overall-lms-progress'
  );
  if (overallLmsProgressEl) {
    const pct = getNumeric(safeStats.overallLmsProgress, 0);
    overallLmsProgressEl.textContent = `${pct}%`;
  }
}

// ------------- Donut + quick access -------------

function setDonutProgress(value = 0) {
  const donut = document.getElementById('overallProgressDonut');
  const valueEl = document.getElementById('overallProgressValue');
  if (!donut || !valueEl) return;
  const degrees = Math.min(360, Math.max(0, (value / 100) * 360));
  donut.style.background = `conic-gradient(from 0deg, #556B2F 0deg, #6B8E23 ${
    degrees * 0.3
  }deg, #9ACD32 ${degrees * 0.6}deg, #C19A6B ${degrees}deg, #E2E8F0 ${degrees}deg 360deg)`;
  valueEl.textContent = `${Math.round(value)}%`;
}

// ------------- Overall course progress card (row 2, card 1) -------------

function computeOverallProgressStats(dashboardData) {
  const lmsLessons = (dashboardData.lms && dashboardData.lms.lessons) || [];
  const gameLessons = (dashboardData.game && dashboardData.game.lessons) || [];

  // LMS lessons
  const lmsLessonsTotal = lmsLessons.length;
  const lmsLessonsCompleted = lmsLessons.filter(
    (l) => String(l.status || '').toLowerCase() === 'completed'
  ).length;

  // Assessments = pages
  let assessmentsCompleted = 0;
  let assessmentsTotal = 0;
  lmsLessons.forEach((l) => {
    const totalPages = getNumeric(l.totalPages, 0);
    const completedPages = getNumeric(l.completedPages, 0);
    assessmentsTotal += totalPages;
    assessmentsCompleted += completedPages;
  });

  // Game stats (max 6 lessons)
  const gameMaxLessons = 6;
  let gameQuizzesCompleted = 0;
  let gameSimulationsPassed = 0;

  gameLessons.forEach((g) => {
    const quiz = g.quiz || {};
    const sim = g.simulation || {};
    if (quiz.completed) gameQuizzesCompleted += 1;
    if (sim.completed && sim.passed) gameSimulationsPassed += 1;
  });

  return {
    lmsLessonsCompleted,
    lmsLessonsTotal,
    assessmentsCompleted,
    assessmentsTotal,
    gameQuizzesCompleted,
    gameSimulationsPassed,
    gameMaxLessons
  };
}

function renderOverallProgressCard(dashboardData) {
  const stats = computeOverallProgressStats(dashboardData);

  const lmsLessonsEl = document.getElementById('stat-lms-lessons');
  const lmsAssessEl = document.getElementById('stat-lms-assessments');
  const gameQuizEl = document.getElementById('stat-game-quizzes');
  const gameSimEl = document.getElementById('stat-game-simulations');

  if (lmsLessonsEl) {
    lmsLessonsEl.textContent = `${stats.lmsLessonsCompleted} / ${stats.lmsLessonsTotal}`;
  }
  if (lmsAssessEl) {
    lmsAssessEl.textContent = `${stats.assessmentsCompleted} / ${stats.assessmentsTotal}`;
  }
  if (gameQuizEl) {
    gameQuizEl.textContent = `${stats.gameQuizzesCompleted} / ${stats.gameMaxLessons}`;
  }
  if (gameSimEl) {
    gameSimEl.textContent = `${stats.gameSimulationsPassed} / ${stats.gameMaxLessons}`;
  }
}

function updateQuickAccessFromLms(lessons = []) {
  const continueCard = document.getElementById('continueLessonCard');

  if (!lessons.length) {
    studentDashboardState.quickLinks.lesson = null;
    const continueSubtitle = continueCard?.querySelector('.quick-card-subtitle');
    const continueBack = document.getElementById('continueLessonBack');
    if (continueSubtitle) continueSubtitle.textContent = 'Start your first lesson';
    if (continueBack) continueBack.style.display = 'none';
    return;
  }

  const inProgress = lessons.find(
    (l) => String(l.status || '').toLowerCase() === 'in_progress'
  );
  const nextLesson =
    inProgress ||
    lessons.find((l) => String(l.status || '').toLowerCase() !== 'completed') ||
    lessons[0];

  const lessonLink = `/student-lessons?lesson=${nextLesson.slot}`;
  studentDashboardState.quickLinks.lesson = lessonLink;

  const continueSubtitle = continueCard?.querySelector('.quick-card-subtitle');
  const continueBack = document.getElementById('continueLessonBack');
  if (continueSubtitle) {
    continueSubtitle.textContent = 'Jump back to where you left off';
  }
  if (continueBack) {
    continueBack.style.display = 'block';
    continueBack.textContent = `Resume Lesson ${nextLesson.slot}`;
  }
}

function attachQuickActions() {
  // Continue Lesson card
  const continueCard = document.getElementById('continueLessonCard');
  if (continueCard) {
    continueCard.addEventListener('click', () => handleQuickAction('lesson'));
  }

  // My Assessments card
  const assessmentsCard = document.getElementById('myAssessmentsCard');
  if (assessmentsCard) {
    assessmentsCard.addEventListener('click', () => {
      window.location.href = '/student-progress.html';
    });
  }

  // Download CareSim App card - modal
  const downloadAppCard = document.getElementById('downloadAppCard');
  const apkModal = document.getElementById('apk-download-modal');
  const apkModalCancel = document.getElementById('apk-modal-cancel');
  const apkModalCopyLink = document.getElementById('apk-modal-copy-link');

  function openApkModal() {
    if (!apkModal) return;
    // Set the Google Drive link in the input field
    const linkInput = document.getElementById('apk-modal-link-input');
    if (linkInput) {
      linkInput.value = 'https://drive.google.com/file/d/1Fyv9TuEB8jiB-bJJgTS5wnvzYW1mIhhE/view?usp=sharing';
    }
    apkModal.setAttribute('aria-hidden', 'false');
    apkModal.classList.add('is-open');
  }

  function closeApkModal() {
    if (!apkModal) return;
    apkModal.setAttribute('aria-hidden', 'true');
    apkModal.classList.remove('is-open');
  }

  async function copyDownloadLink() {
    const linkInput = document.getElementById('apk-modal-link-input');
    if (!linkInput) return;
    
    const downloadUrl = linkInput.value;
    
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(downloadUrl);
        // Show brief feedback with icon change
        const copyIcon = document.getElementById('apk-copy-icon');
        const copyCheck = document.getElementById('apk-copy-check');
        if (copyIcon && copyCheck) {
          copyIcon.style.display = 'none';
          copyCheck.style.display = 'block';
          copyCheck.style.color = '#10b981';
          setTimeout(() => {
            copyIcon.style.display = 'block';
            copyCheck.style.display = 'none';
            copyCheck.style.color = '';
          }, 2000);
        }
        return;
      }
      
      // Fallback: select and copy from input
      linkInput.select();
      linkInput.setSelectionRange(0, 99999); // For mobile devices
      try {
        const successful = document.execCommand('copy');
        if (successful) {
          const copyIcon = document.getElementById('apk-copy-icon');
          const copyCheck = document.getElementById('apk-copy-check');
          if (copyIcon && copyCheck) {
            copyIcon.style.display = 'none';
            copyCheck.style.display = 'block';
            copyCheck.style.color = '#10b981';
            setTimeout(() => {
              copyIcon.style.display = 'block';
              copyCheck.style.display = 'none';
              copyCheck.style.color = '';
            }, 2000);
          }
        } else {
          showAlertModal('Failed to copy link. Please select and copy manually.', 'Copy Failed');
        }
      } catch (err) {
        showAlertModal('Failed to copy link. Please select and copy manually.', 'Copy Failed');
      }
    } catch (err) {
      console.error('Copy failed:', err);
      showAlertModal('Failed to copy link. Please select and copy manually.', 'Copy Failed');
    }
  }

  if (downloadAppCard) {
    downloadAppCard.addEventListener('click', () => {
      openApkModal();
    });
  }

  if (apkModalCancel) {
    apkModalCancel.addEventListener('click', () => {
      closeApkModal();
    });
  }

  if (apkModalCopyLink) {
    apkModalCopyLink.addEventListener('click', () => {
      copyDownloadLink();
    });
  }

  // Close when clicking outside modal
  if (apkModal) {
    apkModal.addEventListener('click', (e) => {
      if (e.target === apkModal) {
        closeApkModal();
      }
    });
  }

  // View Certificates card
  const certificatesCard = document.getElementById('viewCertificatesCard');
  if (certificatesCard) {
    certificatesCard.addEventListener('click', () => {
      window.location.href = '/student-certificates.html';
    });
  }

}

function handleQuickAction(type) {
  const link = studentDashboardState.quickLinks[type];
  if (!link) {
    showAlertModal(
      'No available action yet. Keep progressing to unlock this shortcut.',
      'Heads up'
    );
    return;
  }
  window.location.href = link;
}

// ------------- LMS Panel rendering -------------

function renderLmsPanel(lms) {
  const container = document.getElementById('lmsPanelContent');
  if (!container) return;

  const lessons = Array.isArray(lms.lessons) ? lms.lessons : [];
  if (!lessons.length) {
    container.innerHTML =
      '<p class="empty-state">No lessons available yet. Please check back soon.</p>';
    return;
  }

  const cards = lessons
    .map((lesson) => {
      const statusRaw = String(lesson.status || '').toLowerCase();
      let statusClass = 'not-started';
      let statusLabel = 'Not Started';
      if (statusRaw === 'completed') {
        statusClass = 'completed';
        statusLabel = 'Completed';
      } else if (statusRaw === 'in_progress') {
        statusClass = 'in-progress';
        statusLabel = 'In Progress';
      }

      const progressPct = getNumeric(lesson.pageProgressPercent, 0);
      const quiz = lesson.quiz || {};
      const simulation = lesson.simulation || {};
      const quizScoreDisplay = formatScore10(quiz.highestScore);
      const quizAttemptsDisplay = getNumeric(quiz.attempts, 0);
      let simStatusLabel = 'Not Started';
      if (simulation.completed && simulation.passed) {
        simStatusLabel = 'Passed';
      } else if (simulation.completed && !simulation.passed) {
        simStatusLabel = 'Completed (Not Passed)';
      }
      const simAttemptsDisplay = getNumeric(simulation.attempts, 0);
      const lessonLink = `/student-lessons.html?lesson=${lesson.slot}`;

      return `
        <div class="lesson-card ${statusClass === 'completed' ? 'is-complete' : ''}">
          <div class="lesson-card-header">
            <div class="lesson-title-section">
              <h3 class="lesson-title">Lesson ${lesson.slot}: ${lesson.title || ''}</h3>
              <span class="lesson-subtitle">${lesson.description || ''}</span>
            </div>
            <span class="lesson-status ${statusClass}">${statusLabel}</span>
          </div>
          <div class="lesson-progress-section">
            <div class="lesson-progress-header">
              <span class="progress-label">Page Progress</span>
              <span class="progress-percentage">${formatPercent(progressPct)}</span>
            </div>
            <div class="lesson-progress-bar">
              <div class="lesson-progress-fill" style="width:${progressPct}%;"></div>
            </div>
          </div>
          <div class="lesson-stats-grid">
            <div class="lesson-stat-item">
              <span class="stat-label">Quiz Score</span>
              <span class="stat-value">${quizScoreDisplay}</span>
            </div>
            <div class="lesson-stat-item">
              <span class="stat-label">Quiz Attempts</span>
              <span class="stat-value">${quizAttemptsDisplay}</span>
            </div>
            <div class="lesson-stat-item">
              <span class="stat-label">Simulation</span>
              <span class="stat-value">${simStatusLabel}</span>
            </div>
            <div class="lesson-stat-item">
              <span class="stat-label">Simulation Attempts</span>
              <span class="stat-value">${simAttemptsDisplay}</span>
            </div>
          </div>
          <div class="lesson-card-actions">
            <button class="btn-view-lesson" data-lesson-slot="${
              lesson.slot
            }" data-lesson-link="${lessonLink}">
              <span>Go to lesson</span>
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = cards;

  container.querySelectorAll('.btn-view-lesson').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const link = btn.getAttribute('data-lesson-link');
      if (link) {
        window.location.href = link;
      }
    });
  });
}

// ------------- Game Panel rendering -------------

function renderGamePanel(game) {
  const tabButton = document.getElementById('gameTabButton');
  const panel = document.getElementById('game-panel');
  const content = document.getElementById('gamePanelContent');

  if (!tabButton || !panel || !content) return;

  if (!game || (!Array.isArray(game.lessons) || game.lessons.length === 0) &&
      !getNumeric(game.totals?.gameLessonsCompleted, 0)) {
    // Hide entire tab if no game data
    tabButton.style.display = 'none';
    panel.style.display = 'none';
    return;
  }

  tabButton.style.display = 'inline-flex';

  const completed = getNumeric(game.totals?.gameLessonsCompleted, 0);
  const lessons = Array.isArray(game.lessons) ? game.lessons : [];

  const headerHtml = `
    <div class="game-summary-row">
      <div class="progress-stat-card">
        <div class="stat-content">
          <span class="stat-label">Game Lessons Completed</span>
          <span class="stat-value">${completed} / 6</span>
        </div>
      </div>
      <p class="game-summary-note">Unity Game Progress (optional) — this reflects your activity in the game build, not the LMS.</p>
    </div>
  `;

  if (!lessons.length) {
    content.innerHTML =
      headerHtml +
      '<p class="empty-state">No Unity game data yet. You can complete lessons entirely within the LMS.</p>';
    return;
  }

  const rows = lessons
    .map((lesson) => {
      const quiz = lesson.quiz || {};
      const sim = lesson.simulation || {};
      const quizScore = formatScore10(quiz.highestScore);
      const quizAttempts = getNumeric(quiz.attempts, 0);
      let simStatus = 'Not Started';
      if (sim.completed && sim.passed) simStatus = 'Passed';
      else if (sim.completed) simStatus = 'Completed';
      const simAttempts = getNumeric(sim.attempts, 0);

      return `
        <tr>
          <td>Lesson ${lesson.slot}</td>
          <td>${quizScore}</td>
          <td>${quizAttempts}</td>
          <td>${simStatus}</td>
          <td>${simAttempts}</td>
        </tr>
      `;
    })
    .join('');

  content.innerHTML = `
    ${headerHtml}
    <div class="game-lessons-table-wrapper">
      <table class="game-lessons-table">
        <thead>
          <tr>
            <th>Lesson</th>
            <th>Quiz Best Score</th>
            <th>Quiz Attempts</th>
            <th>Simulation Status</th>
            <th>Simulation Attempts</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

// ------------- Tabs / panel switching -------------

function initDashboardTabs() {
  const lmsTab = document.getElementById('lmsTabButton');
  const gameTab = document.getElementById('gameTabButton');
  const lmsPanel = document.getElementById('lms-panel');
  const gamePanel = document.getElementById('game-panel');

  if (!lmsTab || !gameTab || !lmsPanel || !gamePanel) return;

  const setActive = (panel) => {
    if (panel === 'lms') {
      lmsTab.classList.add('active');
      lmsPanel.classList.add('active');
      lmsPanel.style.display = 'block';
      gameTab.classList.remove('active');
      gamePanel.classList.remove('active');
      gamePanel.style.display = 'none';
    } else {
      gameTab.classList.add('active');
      gamePanel.classList.add('active');
      gamePanel.style.display = 'block';
      lmsTab.classList.remove('active');
      lmsPanel.classList.remove('active');
      lmsPanel.style.display = 'block';
    }
  };

  lmsTab.addEventListener('click', () => setActive('lms'));
  gameTab.addEventListener('click', () => setActive('game'));
}

// ------------- Certificates + announcements (basic placeholders) -------------

// ------------- Your Lessons Panel -------------

function renderYourLessons() {
  const container = document.getElementById('yourLessonsContent');
  if (!container) return;

  const lmsLessons = studentDashboardState.lms.lessons || [];
  const gameLessons = (studentDashboardState.game && studentDashboardState.game.lessons) || [];

  if (!lmsLessons.length) {
    container.innerHTML = '<p class="empty-state-text">No lessons available yet.</p>';
    return;
  }

  // Create a map of game lessons by slot for quick lookup
  const gameLessonsMap = {};
  gameLessons.forEach((gLesson) => {
    gameLessonsMap[gLesson.slot] = gLesson;
  });

  const lessonsHtml = lmsLessons
    .map((lesson) => {
      const slot = lesson.slot || '';
      const title = lesson.title || `Lesson ${slot}`;
      const totalPages = getNumeric(lesson.totalPages, 0);
      const completedPages = getNumeric(lesson.completedPages, 0);
      const status = String(lesson.status || '').toLowerCase();

      // Calculate progress percentage
      const progressPct =
        totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0;

      // Determine status label
      let statusLabel = 'Not started';
      let statusClass = 'not-started';
      if (status === 'completed') {
        statusLabel = 'Completed';
        statusClass = 'completed';
      } else if (status === 'in_progress' || completedPages > 0) {
        statusLabel = 'In progress';
        statusClass = 'in-progress';
      }

      // Get game simulation status
      const gameLesson = gameLessonsMap[slot];
      const gameSim = gameLesson?.simulation || {};
      let gameSimLabel = '';
      if (gameSim.completed && gameSim.passed) {
        gameSimLabel = '<span class="game-sim-tag passed">Game sim: Passed</span>';
      } else if (gameSim.completed) {
        gameSimLabel = '<span class="game-sim-tag in-progress">Game sim: In progress</span>';
      } else if (gameSim.attempts > 0) {
        gameSimLabel = '<span class="game-sim-tag in-progress">Game sim: In progress</span>';
      } else {
        gameSimLabel = '<span class="game-sim-tag not-started">Game sim: Not started</span>';
      }

      const lessonLink = `/student-lessons?lesson=${slot}`;
      const buttonText = completedPages > 0 ? 'Continue' : 'Start lesson';

      return `
        <div class="lesson-row-card">
          <div class="lesson-row-header">
            <h3 class="lesson-row-title">Lesson ${slot}: ${title}</h3>
            <span class="lesson-status-badge ${statusClass}">${statusLabel}</span>
          </div>
          <div class="lesson-row-progress">
            <div class="lesson-progress-info">
              <span class="progress-label">LMS Progress</span>
              <span class="progress-percentage">${progressPct}%</span>
            </div>
            <div class="lesson-progress-bar">
              <div class="lesson-progress-fill" style="width: ${progressPct}%"></div>
            </div>
            <div class="lesson-progress-details">
              <span>Pages: ${completedPages} / ${totalPages}</span>
            </div>
          </div>
          <div class="lesson-row-footer">
            <div class="lesson-row-meta">
              ${gameSimLabel}
            </div>
            <div class="lesson-row-actions">
              <a href="${lessonLink}" class="lesson-action-btn primary">${buttonText}</a>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = lessonsHtml;
}

// ------------- Upcoming Tasks Panel -------------

function renderUpcomingTasks() {
  const container = document.getElementById('upcomingTasksContent');
  if (!container) return;

  const lmsLessons = studentDashboardState.lms.lessons || [];
  const gameLessons = (studentDashboardState.game && studentDashboardState.game.lessons) || [];

  const tasks = [];

  // Create a map of game lessons by slot
  const gameLessonsMap = {};
  gameLessons.forEach((gLesson) => {
    gameLessonsMap[gLesson.slot] = gLesson;
  });

  // Find LMS tasks (incomplete lessons)
  lmsLessons.forEach((lesson) => {
    const slot = lesson.slot || '';
    const title = lesson.title || `Lesson ${slot}`;
    const totalPages = getNumeric(lesson.totalPages, 0);
    const completedPages = getNumeric(lesson.completedPages, 0);
    const status = String(lesson.status || '').toLowerCase();

    if (status !== 'completed') {
      const remainingPages = totalPages - completedPages;
      if (remainingPages > 0) {
        tasks.push({
          type: 'lms',
          priority: completedPages > 0 ? 1 : 2, // In-progress lessons first
          label: `Continue Lesson ${slot} — ${remainingPages} page${remainingPages > 1 ? 's' : ''} left`,
          action: `/student-lessons?lesson=${slot}`,
          actionText: 'Open lesson'
        });
      } else if (completedPages === 0) {
        tasks.push({
          type: 'lms',
          priority: 3,
          label: `Start Lesson ${slot}: ${title}`,
          action: `/student-lessons?lesson=${slot}`,
          actionText: 'Start lesson'
        });
      }
    }

    // Check if LMS is completed but game simulation is not passed
    if (status === 'completed') {
      const gameLesson = gameLessonsMap[slot];
      const gameSim = gameLesson?.simulation || {};
      if (!gameSim.passed) {
        if (gameSim.completed) {
          tasks.push({
            type: 'game',
            priority: 2,
            label: `Retry game simulation for Lesson ${slot}`,
            action: '#',
            actionText: 'View game stats'
          });
        } else {
          tasks.push({
            type: 'game',
            priority: 2,
            label: `Finish game simulation for Lesson ${slot}`,
            action: '#',
            actionText: 'View game stats'
          });
        }
      }
    }
  });

  // Sort by priority
  tasks.sort((a, b) => a.priority - b.priority);

  // Limit to 6 items
  const displayTasks = tasks.slice(0, 6);

  if (!displayTasks.length) {
    container.innerHTML = `
      <div class="tasks-empty-state">
        <p class="empty-state-text">Great job! You're all caught up.</p>
      </div>
    `;
    return;
  }

  const tasksHtml = displayTasks
    .map((task) => {
      const badgeClass = task.type === 'lms' ? 'task-badge-lms' : 'task-badge-game';
      const badgeText = task.type === 'lms' ? 'LMS' : 'Game';

      return `
        <div class="task-item">
          <div class="task-content">
            <span class="task-badge ${badgeClass}">${badgeText}</span>
            <span class="task-label">${task.label}</span>
          </div>
          ${task.action !== '#' ? `<a href="${task.action}" class="task-action-link">${task.actionText}</a>` : ''}
        </div>
      `;
    })
    .join('');

  container.innerHTML = tasksHtml;
}

function updateAnnouncements() {
  const listEl = document.getElementById('announcementsList');
  if (!listEl) return;
  listEl.innerHTML = `
    <div class="announcement-empty-state">
      <div class="empty-state-icon">📢</div>
      <h4 class="empty-state-title">Announcements coming soon</h4>
      <p class="empty-state-text">Your instructor can post important updates here.</p>
    </div>
  `;
}

function viewAllAnnouncements() {
  showAlertModal('View all announcements feature coming soon!', 'Notice');
}

// ------------- Session / auth helpers -------------

function goToProfile() {
  window.location.href = '/student-profile';
}

function logout() {
  const modal = document.getElementById('logoutModal');
  if (modal) modal.style.display = 'flex';
}

function closeLogoutModal() {
  const modal = document.getElementById('logoutModal');
  if (modal) modal.style.display = 'none';
}

function confirmLogout() {
  localStorage.removeItem('studentToken');
  localStorage.removeItem('studentData');
  window.location.href = '/caresim-login';
}

function handleSessionExpiration() {
  closeLogoutModal();
  localStorage.removeItem('studentToken');
  localStorage.removeItem('studentData');
  showAlertModal('Your session has expired. Please sign in again.', 'Session expired');
  setTimeout(() => {
    window.location.href = '/caresim-login';
  }, 1500);
}

// ------------- History modal (quiz/sim) -------------

function formatSimulationDuration(seconds) {
  if (
    seconds === null ||
    seconds === undefined ||
    typeof seconds !== 'number' ||
    Number.isNaN(seconds) ||
    seconds <= 0
  ) {
    return 'No attempts yet';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

function showHistory(lessonSlot, historyData, historyType = 'quiz', summaryInfo = null) {
  const historyModal = document.getElementById('historyModal');
  const historyTitle = document.getElementById('historyTitle');
  const historyList = document.getElementById('historyList');

  if (!historyModal || !historyTitle || !historyList) return;

  const typeLabel = historyType === 'simulation' ? 'Simulation' : 'Quiz';
  historyTitle.textContent = `${typeLabel} History - Lesson ${lessonSlot}`;

  const history = Array.isArray(historyData) ? historyData : [];

  if (!history.length) {
    if (historyType === 'simulation' && summaryInfo && Number(summaryInfo.attempts) > 0) {
      historyList.innerHTML = `
        <div class="history-item-new">
          <div class="history-header">
            <span class="history-date">Attempts: ${summaryInfo.attempts}</span>
            <span class="history-time-label">Average Duration</span>
          </div>
          <div class="history-body">
            <span class="history-duration">${formatSimulationDuration(
              summaryInfo.avgTime
            )}</span>
          </div>
        </div>
      `;
    } else {
      historyList.innerHTML = `<p class="empty-history">No ${historyType} history available</p>`;
    }
  } else {
    historyList.innerHTML = history
      .map((entry) => {
        const date = entry.date || 'N/A';
        const time = entry.time || 'N/A';
        const duration = entry.duration || 'N/A';
        if (historyType === 'quiz') {
          const scoreText =
            entry.scoreText ||
            (entry.score !== undefined ? `${entry.score}/10` : 'N/A');
          return `
            <div class="history-item-new">
              <div class="history-header">
                <span class="history-date">${date}</span>
                <span class="history-time-label">${time}</span>
              </div>
              <div class="history-body">
                <span class="history-duration">${duration}</span>
                <span class="history-score-text">${scoreText}</span>
              </div>
            </div>
          `;
        }
        const resultText = entry.result
          ? `<span class="history-score-text">Result: ${entry.result}</span>`
          : '';
        return `
          <div class="history-item-new">
            <div class="history-header">
              <span class="history-date">${date}</span>
              <span class="history-time-label">${time}</span>
            </div>
            <div class="history-body">
              <span class="history-duration">Duration: ${duration}</span>
              ${resultText}
            </div>
          </div>
        `;
      })
      .join('');
  }

  historyModal.style.display = 'flex';
}

function closeHistoryModal() {
  const historyModal = document.getElementById('historyModal');
  if (historyModal) historyModal.style.display = 'none';
}

// ------------- Alert modal -------------

function showAlertModal(message, title = 'Notice') {
  const modal = document.getElementById('alertModal');
  if (!modal) {
    // Fallback
    alert(message);
    return;
  }
  const titleEl = document.getElementById('alertTitle');
  const msgEl = document.getElementById('alertMessage');
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  modal.style.display = 'flex';
}

function closeAlertModal() {
  const modal = document.getElementById('alertModal');
  if (modal) modal.style.display = 'none';
}

// ------------- Dashboard data fetch -------------

async function fetchDashboardData() {
  const token = getStudentToken();
  if (!token) {
    window.location.href = '/caresim-login';
    return null;
  }

  const response = await fetch('/api/student/dashboard?t=' + Date.now(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Cache-Control': 'no-cache'
    }
  });

  if (response.status === 401 || response.status === 403) {
    handleSessionExpiration();
    return null;
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.error('Error parsing dashboard JSON:', err);
    showAlertModal(
      'Failed to load dashboard: Invalid response from server. Please try again.',
      'Error'
    );
    return null;
  }

  if (!response.ok || !data || data.success === false) {
    console.error('Dashboard API error:', data);
    const msg = data?.error || data?.message || 'Unknown error';
    showAlertModal('Failed to load dashboard: ' + msg, 'Error');
    return null;
  }

  return data;
}

async function loadStudentDashboard() {
  try {
    document.body.classList.add('dashboard-loading');

    const token = getStudentToken();
    if (!token) {
      window.location.href = '/caresim-login';
      return;
    }

    const payload = await fetchDashboardData();
    if (!payload) return;

    studentDashboardState.user = payload.user || null;
    studentDashboardState.lms = payload.lms || { lessons: [], totals: {} };
    studentDashboardState.game = payload.game || null;

    // Update greeting and profile header
    updateDashboardGreeting(studentDashboardState.user || {});
    updateProfileHeader(studentDashboardState.user || {});
    updateSummaryCards(studentDashboardState.lms.totals || {});

    // Compute and render top-row stats
    const stats = computeDashboardStats();
    updateDashboardStats(stats);

  // Update overall course progress card (LMS + Game breakdown)
  renderOverallProgressCard({
    lms: studentDashboardState.lms,
    game: studentDashboardState.game
  });

    updateQuickAccessFromLms(studentDashboardState.lms.lessons || []);
    renderYourLessons();
    renderUpcomingTasks();
    updateAnnouncements();
  } catch (error) {
    console.error('Error loading student dashboard:', error);
    let msg = 'Network error. Please check your connection and try again.';
    if (error.message) {
      msg = 'Error loading dashboard: ' + error.message;
    }
    showAlertModal(msg, 'Error');
  } finally {
    document.body.classList.remove('dashboard-loading');
  }
}

// ------------- Global wiring -------------

window.loadDashboard = loadStudentDashboard;
window.goToProfile = goToProfile;
window.logout = logout;
window.closeLogoutModal = closeLogoutModal;
window.confirmLogout = confirmLogout;
window.closeHistoryModal = closeHistoryModal;
window.showHistory = showHistory;
window.showAlertModal = showAlertModal;
window.closeAlertModal = closeAlertModal;
window.viewAllAnnouncements = viewAllAnnouncements;

window.addEventListener('click', (event) => {
  const historyModal = document.getElementById('historyModal');
  const logoutModal = document.getElementById('logoutModal');
  if (event.target === historyModal) {
    closeHistoryModal();
  }
  if (event.target === logoutModal) {
    closeLogoutModal();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const token = getStudentToken();
  if (!token) {
    window.location.href = '/caresim-login';
    return;
  }

  const logoutModal = document.getElementById('logoutModal');
  if (logoutModal) logoutModal.style.display = 'none';

  attachQuickActions();
  initDashboardTabs();
  loadStudentDashboard();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('refresh')) {
    setTimeout(() => {
      loadStudentDashboard();
    }, 100);
  }
});


