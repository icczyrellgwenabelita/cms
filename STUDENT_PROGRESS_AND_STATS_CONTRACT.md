# CareSim CMS - Student Progress & Statistics Contract
## Complete Data Model for LMS and Game Progress Tracking

**Generated:** 2025-11-30  
**Purpose:** Detailed contract for Student progress and statistics, separating LMS (web) and Game (Unity) systems  
**Status:** READ-ONLY ANALYSIS - NO CODE MODIFICATIONS YET

---

## TABLE OF CONTENTS

1. [Overview](#1-overview)
2. [Firebase Paths Used for Student Progress](#2-firebase-paths-used-for-student-progress)
3. [Admin vs Student Usage (Per Feature)](#3-admin-vs-student-usage-per-feature)
4. [Statistics Design – LMS](#4-statistics-design--lms)
5. [Statistics Design – Game](#5-statistics-design--game)
6. [Dual-Panel Student Dashboard Design](#6-dual-panel-student-dashboard-design)
7. [Migration & Backward Compatibility Plan](#7-migration--backward-compatibility-plan)
8. [Concrete To-Do List for Student Side (Stats-focused)](#8-concrete-to-do-list-for-student-side-stats-focused)

---

## 1. OVERVIEW

### 1.1 Goals

This document defines the **canonical data model** for Student progress and statistics, ensuring:

- **Clear separation** between LMS (web-based) and Game (Unity-based) progress
- **Alignment** with Admin-side expectations (Admin is source of truth)
- **Accurate statistics** for both LMS and Game systems
- **Certificate eligibility** matches Admin logic exactly
- **Backward compatibility** during migration from legacy paths

### 1.2 Two Separate Systems

#### LMS Progress (Web-Based)
- **Purpose:** Web LMS lessons, pages, assessments, quizzes, simulations
- **Firebase Path:** `users/{uid}/lmsProgress/lesson{slot}`
- **Content Source:** `lmsLessons/{slot}/pages` and `lmsLessons/{slot}/pages/{pageId}/assessments`
- **Certificate:** LMS Full Course Certificate (`LMS-...`)

#### Game Progress (Unity-Based)
- **Purpose:** Unity game lessons, quizzes, simulations
- **Firebase Paths:** Multiple formats (see section 2.2)
- **Content Source:** Unity game (separate repo, not visible)
- **Certificate:** Game Generic Certificate (`PUB-...`)

### 1.3 Key Principle: Path Separation

**CRITICAL:** LMS and Game progress must NEVER be mixed:
- **LMS uses:** `users/{uid}/lmsProgress/lesson{slot}`
- **Game uses:** `users/{uid}/progress/lesson{slot}` (Unity writes here)
- **Legacy:** `students/{uid}/lessonProgress/{i}` (old format, may contain either)

---

## 2. FIREBASE PATHS USED FOR STUDENT PROGRESS

### 2.1 LMS Progress Paths

#### 2.1.1 Lesson Content (Read-Only for Students)

**Path:** `lmsLessons/{slot}/pages/{pageId}`
```json
{
  "id": "pageId1",
  "title": "Page Title",
  "content": "<HTML content>",
  "order": 0,
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "assessments": {
    "assessmentId1": {
      "id": "assessmentId1",
      "question": "What is...?",
      "answerA": "Option A",
      "answerB": "Option B",
      "answerC": "Option C",
      "answerD": "Option D",
      "correctAnswer": "A",
      "explanation": "Explanation text"
    }
  }
}
```

**Admin Usage:**
- Routes: `routes/admin.js` - GET `/api/admin/lessons/:slot/pages`
- JS: `public/js/admin-lesson-editor.js` - Creates/updates pages

**Student Usage:**
- Routes: `routes/student.js` - GET `/api/student/lessons/:slot/pages`
- Routes: `routes/student.js` - GET `/api/student/lessons/:slot/pages/:pageId/assessments`
- Routes: `routes/student.js` - POST `/api/student/lessons/:slot/pages/:pageId/assessments/submit`

---

#### 2.1.2 LMS Progress Tracking (Student Writes, Admin/Student Read)

**Path:** `users/{uid}/lmsProgress/lesson{slot}`

**Canonical Structure:**
```json
{
  "completedPages": {
    "pageId1": true,
    "pageId2": true,
    "pageId3": true
  },
  "quiz": {
    "completed": true,
    "highestScore": 8,        // Out of 10, must be >= 7 for eligibility
    "attempts": 2,
    "lastAttempt": "2025-11-30T12:00:00.000Z"
  },
  "simulation": {
    "completed": true,
    "passed": true,           // BOTH completed AND passed required
    "score": 100,
    "lastAttempt": "2025-11-30T12:00:00.000Z"
  },
  "lastAssessment": "2025-11-30T12:00:00.000Z"  // Optional
}
```

**Admin Usage:**
- Routes: `routes/admin.js` - Dashboard metrics, certificate eligibility
- JS: `public/js/admin-game-certificates.js` - Lines 71-88 (LMS student eligibility check)

**Student Usage:**
- Routes: `routes/student.js` - POST `/lessons/:slot/pages/:pageId/assessments/submit` (writes `completedPages`)
- JS: `public/js/student-certificates.js` - Lines 106-143 (eligibility check)
- **MISMATCH:** `routes/student.js` GET `/dashboard` reads from `progress/lesson{i}` instead ❌

**Who Writes Quiz/Simulation Data:**
- **Quiz:** Not written by student routes (likely written by separate quiz system or Unity)
- **Simulation:** Not written by student routes (likely written by separate simulation system or Unity)
- **Question:** Need to determine if LMS quiz/sim writes to `lmsProgress` or `progress`

---

#### 2.1.3 LMS Certificates

**User Node:** `users/{uid}/certificates/caresim_lms_full`
```json
{
  "programId": "caresim_lms_full",
  "template": "student",
  "certificateId": "LMS-123456-789",
  "issuedAt": "2025-11-30T12:00:00.000Z",
  "issuedBy": "system",
  "studentName": "John Doe",
  "email": "john@example.com"
}
```

**Central Registry:** `certificates/{certificateId}`
```json
{
  "type": "lms_full",
  "userId": "student-uid",
  "fullName": "John Doe",
  "email": "john@example.com",
  "issuedAt": 1701234567890,
  "status": "valid"
}
```

**Admin Usage:**
- Routes: `routes/admin.js` - POST `/api/admin/certificates/notify-student` (sends email, stores `certificateNotificationSentAt`)
- JS: `public/js/admin-game-certificates.js` - Checks for `certificates.caresim_lms_full`

**Student Usage:**
- JS: `public/js/student-certificates.js` - Generates certificate, writes to both paths
- Routes: `routes/student.js` - POST `/api/student/register-certificate` (writes to central registry)

---

### 2.2 Game Progress Paths

#### 2.2.1 Unity Game Progress (Unity Writes, Admin/Student Read)

**Path:** `users/{uid}/progress/lesson{slot}`

**Inferred Structure (from Admin/Instructor reads):**
```json
{
  "quiz": {
    "completed": true,
    "highestScore": 8,        // Out of 10
    "attempts": 2,
    "lastAttempt": "ISO timestamp"
  },
  "simulation": {
    "completed": true,
    "passed": true,
    "score": 100,
    "attempts": 1,
    "lastAttempt": "ISO timestamp"
  }
}
```

**Note:** This is the **same path structure** as LMS, but under `progress/` instead of `lmsProgress/`. Unity writes here, so this is **Game progress**, not LMS progress.

**Admin Usage:**
- Routes: `routes/admin.js` - Dashboard metrics (reads from `progress` for game users)
- JS: `public/js/admin-game-certificates.js` - Does NOT read from `progress/lesson{slot}` for game completion count

**Instructor Usage:**
- Routes: `routes/instructor.js` - GET `/api/instructor/dashboard` (reads from `progress/lesson{i}` for quiz/sim stats)
- Routes: `routes/instructor.js` - GET `/api/instructor/class-list` (reads from `progress/lesson{i}`)
- **Note:** Instructor reads from `progress` which may be mixing LMS and Game data

**Student Usage:**
- Routes: `routes/student.js` - GET `/dashboard` (reads from `progress/lesson{i}` - WRONG, should be `lmsProgress`)
- Routes: `routes/user.js` - GET `/dashboard` (reads from `progress` - WRONG, should be `lmsProgress`)

---

#### 2.2.2 Game History (Unity Writes, Admin/Instructor Read)

**Path:** `users/{uid}/history/quizzes/{quizId}`
```json
{
  "lesson": 1,
  "score": 8,                  // Out of 10
  "timestamp": "ISO timestamp",
  "date": "ISO timestamp"
}
```

**Path:** `users/{uid}/history/simulations/{simId}`
```json
{
  "lesson": 1,
  "completed": true,
  "passed": true,
  "timestamp": "ISO timestamp",
  "date": "ISO timestamp"
}
```

**Admin Usage:**
- Routes: `routes/admin.js` - `computeQuizMetrics()` reads from `history/quizzes`
- **Note:** Admin dashboard uses `history/quizzes` for quiz statistics

**Instructor Usage:**
- Routes: `routes/instructor.js` - GET `/api/instructor/dashboard` (primary source for quiz scores)
- Routes: `routes/instructor.js` - GET `/api/instructor/assessments` (reads from `history/quizzes` and `history/simulations`)
- **Logic:** Instructor uses `history/quizzes` as PRIMARY source, falls back to `progress/lesson{i}/quiz` if no history

**Student Usage:**
- **Currently:** No student routes read from history
- **Question:** Should student dashboard show game history? (Likely yes, for Game stats panel)

---

#### 2.2.3 Game Completion Counts (Multiple Formats)

**Format 1: Direct Count**
**Path:** `users/{uid}/lessonsCompleted`
```json
6
```

**Format 2: Nested Count**
**Path:** `users/{uid}/gameProgress/lessonsCompleted`
```json
6
```

**Format 3: Detailed Map**
**Path:** `users/{uid}/progress/gameLessons/{lessonKey}/completed`
```json
{
  "lesson1": { "completed": true },
  "lesson2": { "completed": true },
  "lesson3": { "completed": true },
  "lesson4": { "completed": true },
  "lesson5": { "completed": true },
  "lesson6": { "completed": true }
}
```

**Admin Usage:**
- JS: `public/js/admin-game-certificates.js` - Lines 50-56 (checks all three formats)
- **Logic:** Admin checks all three formats, eligible if `completedCount >= 6`

**Student Usage:**
- **Currently:** No student routes read game completion counts
- **Should:** Student Game stats panel should use same logic as Admin

---

#### 2.2.4 Game Certificates

**User Node:** `users/{uid}/certificates/game_generic`
```json
{
  "certificateId": "PUB-123456-789",
  "issuedAt": 1701234567890
}
```

**Central Registry:** `certificates/{certificateId}`
```json
{
  "type": "game_generic",
  "userId": "public-user-uid",
  "fullName": "Jane Public",
  "email": "jane@example.com",
  "issuedAt": 1701234567890,
  "status": "valid"
}
```

**Admin Usage:**
- Routes: `routes/admin.js` - POST `/api/admin/issue-game-certificate` (admin issues, sends email)
- JS: `public/js/admin-game-certificates.js` - Checks for `certificates.game_generic`

**Student Usage:**
- **No student-side code** (admin-only issuance)

---

### 2.3 Legacy / Weird Paths

#### 2.3.1 Legacy Student Progress

**Path:** `students/{uid}/lessonProgress/{i}`

**Structure (Inferred):**
```json
{
  "status": "completed" | "in_progress" | "not_started",
  "quizScore": 8,
  "progress": 100
}
```

**Current Usage:**
- Routes: `routes/student.js` - GET `/dashboard` (fallback if not in `users` collection)
- **Status:** Legacy path, kept for backward compatibility

**Migration Plan:**
- Should migrate old LMS data from this path to `users/{uid}/lmsProgress/lesson{slot}`
- Keep as fallback during transition
- Remove after migration complete

---

#### 2.3.2 Class Statistics (Optional)

**Path:** `classStats/lessons/{i}`

**Structure (Inferred):**
```json
{
  "avgQuizGrade": 7.5,
  "highestQuizGrade": 10,
  "avgQuizTime": 300,
  "avgSimTime": 600
}
```

**Current Usage:**
- Routes: `routes/student.js` - GET `/dashboard` (reads for display)
- **Status:** Optional, used for class averages display

**Note:** This is aggregate data, not student-specific progress.

---

## 3. ADMIN VS STUDENT USAGE (PER FEATURE)

### 3.1 LMS Lesson List & Page Navigation

| Feature | Admin Reads/Writes | Student Reads/Writes | Comment |
|---------|-------------------|---------------------|---------|
| **Lesson Metadata** | `lessons/{slot}` via GET `/api/admin/lessons` | `lessons/{slot}` via GET `/api/user/lessons` | ✅ Aligned |
| **Pages List** | `lmsLessons/{slot}/pages` via GET `/api/admin/lessons/:slot/pages` | `lmsLessons/{slot}/pages` via GET `/api/student/lessons/:slot/pages` | ✅ Aligned |
| **Page Content** | Reads from `lmsLessons/{slot}/pages/{pageId}` | Reads from same path | ✅ Aligned |
| **Assessments** | `lmsLessons/{slot}/pages/{pageId}/assessments` via GET/POST/PUT/DELETE | `lmsLessons/{slot}/pages/{pageId}/assessments` via GET/POST (submit only) | ✅ Aligned |

---

### 3.2 LMS Per-Lesson Progress

| Feature | Admin Reads/Writes | Student Reads/Writes | Comment |
|---------|-------------------|---------------------|---------|
| **Progress Path** | `users/{uid}/lmsProgress/lesson{slot}` | Assessment submit: ✅ `lmsProgress`<br>Dashboard: ❌ `progress/lesson{i}` | ⚠️ Partial mismatch |
| **Page Completion** | Reads `completedPages` object | Writes `completedPages/{pageId} = true` on assessment pass | ✅ Aligned (write correct) |
| **Quiz Data** | Reads `quiz.completed`, `quiz.highestScore` | Dashboard reads from wrong path | ❌ Mismatch |
| **Simulation Data** | Reads `simulation.completed`, `simulation.passed` | Dashboard reads from wrong path, missing `passed` check | ❌ Mismatch |

---

### 3.3 LMS Quiz Results

| Feature | Admin Reads/Writes | Student Reads/Writes | Comment |
|---------|-------------------|---------------------|---------|
| **Quiz Score Storage** | Reads from `lmsProgress/lesson{slot}/quiz/highestScore` | **Question:** Who writes this? | ⚠️ Unknown writer |
| **Quiz Completion** | Checks `quiz.completed === true` | Certificate check: ✅ Correct<br>Dashboard: ❌ Wrong path | ⚠️ Partial |
| **Quiz Passing** | Checks `quiz.highestScore >= 7` | Certificate check: ✅ Correct<br>Dashboard: ❌ Not checked | ⚠️ Partial |

---

### 3.4 LMS Simulation Results

| Feature | Admin Reads/Writes | Student Reads/Writes | Comment |
|---------|-------------------|---------------------|---------|
| **Simulation Storage** | Reads from `lmsProgress/lesson{slot}/simulation` | **Question:** Who writes this? | ⚠️ Unknown writer |
| **Simulation Completion** | Checks `simulation.completed === true` | Certificate check: ✅ Correct<br>Dashboard: ❌ Wrong path | ⚠️ Partial |
| **Simulation Passing** | Checks `simulation.passed === true` (BOTH required) | Certificate check: ✅ Correct<br>Dashboard: ❌ Not checked | ⚠️ Partial |

---

### 3.5 Game Lesson Completion

| Feature | Admin Reads/Writes | Student Reads/Writes | Comment |
|---------|-------------------|---------------------|---------|
| **Completion Count** | Reads from `lessonsCompleted`, `gameProgress/lessonsCompleted`, or `progress/gameLessons` | **Currently:** No student reads | ❌ Missing |
| **Game Progress** | Reads from `progress/lesson{slot}` (for game users) | Dashboard reads from `progress/lesson{i}` (but thinks it's LMS) | ❌ Confusion |
| **Game History** | Reads from `history/quizzes` and `history/simulations` | **Currently:** No student reads | ❌ Missing |

---

### 3.6 Game Quiz & Simulation Stats

| Feature | Admin Reads/Writes | Student Reads/Writes | Comment |
|---------|-------------------|---------------------|---------|
| **Game Quiz Scores** | Reads from `history/quizzes` (primary) or `progress/lesson{slot}/quiz` | **Currently:** No student reads | ❌ Missing |
| **Game Simulation** | Reads from `history/simulations` or `progress/lesson{slot}/simulation` | **Currently:** No student reads | ❌ Missing |
| **Game Completion** | Checks all three completion count formats | **Currently:** No student checks | ❌ Missing |

---

## 4. STATISTICS DESIGN – LMS

### 4.1 Per-Lesson LMS Stats

#### 4.1.1 Data Source

**Firebase Path:** `users/{uid}/lmsProgress/lesson{slot}`

**Fields to Read:**
```javascript
const lessonData = lmsProgress[`lesson${slot}`] || {};
const completedPages = lessonData.completedPages || {};
const quiz = lessonData.quiz || {};
const simulation = lessonData.simulation || {};
```

#### 4.1.2 Computed Fields

**lessonStatus:**
```javascript
// Determine status based on Admin eligibility rules
const hasPages = Object.keys(completedPages).length > 0;
const quizCompleted = quiz.completed === true;
const quizScoreOk = (quiz.highestScore || 0) >= 7;
const simCompleted = simulation.completed === true;
const simPassed = simulation.passed === true;
const simOk = simCompleted && simPassed;

let lessonStatus;
if (hasPages && quizCompleted && quizScoreOk && simOk) {
    lessonStatus = 'completed';
} else if (hasPages || quizCompleted || simCompleted) {
    lessonStatus = 'in_progress';
} else {
    lessonStatus = 'not_started';
}
```

**pageCount / completedPageCount:**
```javascript
// Get total pages from lmsLessons/{slot}/pages
const pagesRef = db.ref(`lmsLessons/${slot}/pages`);
const pagesSnapshot = await pagesRef.once('value');
const pages = pagesSnapshot.val() || {};
const totalPageCount = Object.keys(pages).length;

// Get completed pages from lmsProgress
const completedPageCount = Object.keys(completedPages).filter(
    pageId => completedPages[pageId] === true
).length;
```

**bestQuizScore / attempts:**
```javascript
const bestQuizScore = quiz.highestScore || null;  // Out of 10
const quizAttempts = quiz.attempts || 0;
const lastQuizAttempt = quiz.lastAttempt || null;
```

**simulationStatus:**
```javascript
let simulationStatus;
if (simulation.completed === true && simulation.passed === true) {
    simulationStatus = 'passed';
} else if (simulation.completed === true && simulation.passed !== true) {
    simulationStatus = 'failed';
} else if (simulation.completed === true) {
    simulationStatus = 'completed';  // Fallback if passed field missing
} else {
    simulationStatus = 'not_started';
}
```

#### 4.1.3 Example Per-Lesson Stats Object

```json
{
  "slot": 1,
  "lessonTitle": "Lesson 1: Monitoring Vital Signs",
  "lessonStatus": "completed",
  "pageCount": 5,
  "completedPageCount": 5,
  "pageProgressPercent": 100,
  "quiz": {
    "completed": true,
    "bestScore": 8,
    "attempts": 2,
    "passed": true,
    "lastAttempt": "2025-11-30T12:00:00.000Z"
  },
  "simulation": {
    "status": "passed",
    "completed": true,
    "passed": true,
    "score": 100,
    "lastAttempt": "2025-11-30T12:00:00.000Z"
  }
}
```

---

### 4.2 Overall LMS Summary Stats for Dashboard

#### 4.2.1 Computation Logic

**totalLessons:**
```javascript
// Always 6 for LMS (lessons 1-6)
const totalLessons = 6;
```

**lessonsCompleted (LMS only):**
```javascript
let lessonsCompleted = 0;
for (let i = 1; i <= 6; i++) {
    const lessonData = lmsProgress[`lesson${i}`] || {};
    const completedPages = lessonData.completedPages || {};
    const hasPages = Object.keys(completedPages).length > 0;
    const quiz = lessonData.quiz || {};
    const quizCompleted = quiz.completed === true;
    const quizScoreOk = (quiz.highestScore || 0) >= 7;
    const sim = lessonData.simulation || {};
    const simOk = sim.completed === true && sim.passed === true;
    
    if (hasPages && quizCompleted && quizScoreOk && simOk) {
        lessonsCompleted += 1;
    }
}
```

**averageQuizScore (LMS only):**
```javascript
let totalQuizScore = 0;
let quizCount = 0;

for (let i = 1; i <= 6; i++) {
    const lessonData = lmsProgress[`lesson${i}`] || {};
    const quiz = lessonData.quiz || {};
    
    // Only count if quiz was taken (has highestScore)
    if (quiz.highestScore !== undefined && typeof quiz.highestScore === 'number') {
        totalQuizScore += quiz.highestScore;  // Out of 10
        quizCount += 1;
    }
}

const averageQuizScore = quizCount > 0 ? totalQuizScore / quizCount : 0;
// Result: 0-10 scale (e.g., 7.5 means 7.5/10)
```

**simulationsPassedCount:**
```javascript
let simulationsPassed = 0;

for (let i = 1; i <= 6; i++) {
    const lessonData = lmsProgress[`lesson${i}`] || {};
    const sim = lessonData.simulation || {};
    
    // BOTH completed AND passed must be true
    if (sim.completed === true && sim.passed === true) {
        simulationsPassed += 1;
    }
}
```

**overallCompletionPercent:**
```javascript
const overallCompletionPercent = Math.round((lessonsCompleted / totalLessons) * 100);
// Result: 0-100 (e.g., 83 means 5/6 lessons completed)
```

#### 4.2.2 Example Overall LMS Summary Stats

```json
{
  "totalLessons": 6,
  "lessonsCompleted": 5,
  "averageQuizScore": 7.5,
  "simulationsPassed": 6,
  "totalSimulations": 6,
  "overallCompletionPercent": 83,
  "totalPages": 30,
  "completedPages": 28,
  "pageCompletionPercent": 93
}
```

---

### 4.3 Alignment with Admin Game Certificates Logic

#### 4.3.1 Certificate Eligibility Rules (Must Match Exactly)

**Admin Logic (from `admin-game-certificates.js` lines 74-88):**
```javascript
const progress = user.lmsProgress || {};
let allMet = true;

for (let i = 1; i <= 6; i++) {
    const lessonKey = `lesson${i}`;
    const lessonData = progress[lessonKey] || {};
    const completedPages = lessonData.completedPages || {};
    const hasPages = Object.keys(completedPages).length > 0;
    const quiz = lessonData.quiz || {};
    const quizCompleted = quiz.completed === true;
    const quizScoreOk = (quiz.highestScore || 0) >= 7;
    const sim = lessonData.simulation || {};
    const simOk = sim.completed === true && sim.passed === true;
    
    if (!hasPages || !quizCompleted || !quizScoreOk || !simOk) {
        allMet = false;
        break;
    }
}
```

**Student Stats Must Use Same Logic:**
- ✅ Pages: `Object.keys(completedPages).length > 0`
- ✅ Quiz: `quiz.completed === true` AND `quiz.highestScore >= 7`
- ✅ Simulation: `sim.completed === true` AND `sim.passed === true`
- ✅ All 6 lessons must meet all criteria

**Current Student Implementation:**
- ✅ Certificate eligibility check (`student-certificates.js`) uses correct logic
- ❌ Dashboard status calculation does NOT use this logic

---

## 5. STATISTICS DESIGN – GAME

### 5.1 Per-Game-Lesson Stats

#### 5.1.1 Data Sources (Multiple Paths)

**Primary Source:** `users/{uid}/progress/lesson{slot}` (Unity writes here)
```json
{
  "quiz": {
    "completed": true,
    "highestScore": 8,
    "attempts": 2,
    "lastAttempt": "ISO timestamp"
  },
  "simulation": {
    "completed": true,
    "passed": true,
    "score": 100,
    "attempts": 1,
    "lastAttempt": "ISO timestamp"
  }
}
```

**History Source:** `users/{uid}/history/quizzes/{quizId}` and `users/{uid}/history/simulations/{simId}`
- **Note:** History may have multiple entries per lesson (multiple attempts)
- **Instructor uses history as PRIMARY source** (more accurate)

#### 5.1.2 Computed Fields

**gameLessonStatus:**
```javascript
// Check completion count formats (same as Admin)
let completedCount = 0;
if (typeof user.lessonsCompleted === 'number') {
    completedCount = user.lessonsCompleted;
} else if (user.gameProgress && user.gameProgress.lessonsCompleted) {
    completedCount = user.gameProgress.lessonsCompleted;
} else if (user.progress && user.progress.gameLessons) {
    completedCount = Object.values(user.progress.gameLessons).filter(l => l.completed).length;
}

// For individual lesson status, check progress/lesson{slot}
const lessonProgress = progress[`lesson${slot}`] || {};
const quiz = lessonProgress.quiz || {};
const simulation = lessonProgress.simulation || {};

let gameLessonStatus;
if (quiz.completed && simulation.completed && simulation.passed) {
    gameLessonStatus = 'completed';
} else if (quiz.completed || simulation.completed) {
    gameLessonStatus = 'in_progress';
} else {
    gameLessonStatus = 'not_started';
}
```

**bestGameQuizScore / attempts:**
```javascript
// Use history as primary source (like instructor)
const historyQuizzes = history.quizzes || {};
let bestScore = 0;
let totalAttempts = 0;

// Find best score for this lesson from history
Object.values(historyQuizzes).forEach(quizData => {
    if (quizData.lesson === slot && typeof quizData.score === 'number') {
        totalAttempts += 1;
        if (quizData.score > bestScore) {
            bestScore = quizData.score;
        }
    }
});

// Fallback to progress if no history
if (totalAttempts === 0 && quiz.highestScore !== undefined) {
    bestScore = quiz.highestScore;
    totalAttempts = quiz.attempts || 0;
}
```

**gameSimulationStatus:**
```javascript
// Check history first (like instructor)
const historySims = history.simulations || {};
let simStatus = 'not_started';
let hasPassed = false;

Object.values(historySims).forEach(simData => {
    if (simData.lesson === slot) {
        if (simData.completed && simData.passed) {
            hasPassed = true;
            simStatus = 'passed';
        } else if (simData.completed && !simData.passed) {
            simStatus = 'failed';
        }
    }
});

// Fallback to progress
if (simStatus === 'not_started') {
    if (simulation.completed && simulation.passed) {
        simStatus = 'passed';
    } else if (simulation.completed) {
        simStatus = 'failed';
    }
}
```

#### 5.1.3 Example Per-Game-Lesson Stats Object

```json
{
  "slot": 1,
  "gameLessonStatus": "completed",
  "quiz": {
    "bestScore": 9,
    "attempts": 3,
    "completed": true,
    "lastAttempt": "2025-11-30T12:00:00.000Z"
  },
  "simulation": {
    "status": "passed",
    "completed": true,
    "passed": true,
    "score": 100,
    "attempts": 1,
    "lastAttempt": "2025-11-30T12:00:00.000Z"
  }
}
```

---

### 5.2 Overall Game Summary Stats

#### 5.2.1 Computation Logic

**gameLessonsCompleted:**
```javascript
// Use SAME logic as Admin (for certificate eligibility)
let completedCount = 0;
if (typeof user.lessonsCompleted === 'number') {
    completedCount = user.lessonsCompleted;
} else if (user.gameProgress && user.gameProgress.lessonsCompleted) {
    completedCount = user.gameProgress.lessonsCompleted;
} else if (user.progress && user.progress.gameLessons) {
    completedCount = Object.values(user.progress.gameLessons).filter(l => l.completed).length;
}

const gameLessonsCompleted = completedCount;
```

**totalGameLessons:**
```javascript
// Always 6 (confirmed from Admin docs)
const totalGameLessons = 6;
```

**averageGameQuizScore:**
```javascript
// Aggregate from history/quizzes (all game quizzes)
let totalScore = 0;
let quizCount = 0;

Object.values(history.quizzes || {}).forEach(quizData => {
    if (quizData && typeof quizData.score === 'number') {
        totalScore += quizData.score;  // Out of 10
        quizCount += 1;
    }
});

// Fallback to progress if no history
if (quizCount === 0) {
    for (let i = 1; i <= 6; i++) {
        const lessonProgress = progress[`lesson${i}`] || {};
        const quiz = lessonProgress.quiz || {};
        if (quiz.highestScore !== undefined && typeof quiz.highestScore === 'number') {
            totalScore += quiz.highestScore;
            quizCount += 1;
        }
    }
}

const averageGameQuizScore = quizCount > 0 ? totalScore / quizCount : 0;
// Result: 0-10 scale
```

**gameSimulationsPassed:**
```javascript
let gameSimulationsPassed = 0;

Object.values(history.simulations || {}).forEach(simData => {
    if (simData && simData.completed && simData.passed) {
        gameSimulationsPassed += 1;
    }
});

// Fallback to progress
if (gameSimulationsPassed === 0) {
    for (let i = 1; i <= 6; i++) {
        const lessonProgress = progress[`lesson${i}`] || {};
        const simulation = lessonProgress.simulation || {};
        if (simulation.completed === true && simulation.passed === true) {
            gameSimulationsPassed += 1;
        }
    }
}
```

#### 5.2.2 Example Overall Game Summary Stats

```json
{
  "totalGameLessons": 6,
  "gameLessonsCompleted": 6,
  "averageGameQuizScore": 8.2,
  "gameSimulationsPassed": 6,
  "totalGameSimulations": 6,
  "gameCompletionPercent": 100
}
```

---

### 5.3 Consistency with Admin's "game_generic" Certificate

#### 5.3.1 Admin Certificate Eligibility Logic

**Admin checks (from `admin-game-certificates.js` lines 50-56):**
```javascript
let completedCount = 0;
if (typeof user.lessonsCompleted === 'number') {
    completedCount = user.lessonsCompleted;
} else if (user.gameProgress && user.gameProgress.lessonsCompleted) {
    completedCount = user.gameProgress.lessonsCompleted;
} else if (user.progress && user.progress.gameLessons) {
    completedCount = Object.values(user.progress.gameLessons).filter(l => l.completed).length;
}

// Eligible if completedCount >= 6
if (completedCount >= 6) {
    // User is eligible for game_generic certificate
}
```

#### 5.3.2 Student Game Stats Must Match

**Student Game Stats Should:**
1. Use **exact same logic** to compute `gameLessonsCompleted`
2. Check all three formats in same order
3. Display "6/6" when `completedCount >= 6`
4. Show certificate eligibility status if `completedCount >= 6` and no certificate exists

**Connection:**
- Admin uses `completedCount >= 6` to determine eligibility
- Student Game stats should show `gameLessonsCompleted: 6` when eligible
- Both should read from same paths in same order

---

## 6. DUAL-PANEL STUDENT DASHBOARD DESIGN

### 6.1 API Endpoint Design

#### 6.1.1 Option A: Separate Endpoints (Recommended)

**LMS Dashboard Endpoint:**
- **Path:** GET `/api/student/dashboard-lms`
- **Purpose:** Returns LMS-specific progress and statistics
- **Auth:** Requires `verifyStudentToken`

**Game Dashboard Endpoint:**
- **Path:** GET `/api/student/dashboard-game`
- **Purpose:** Returns Game-specific progress and statistics
- **Auth:** Requires `verifyStudentToken`

**Benefits:**
- Clear separation of concerns
- Can cache/optimize each independently
- Frontend can load panels independently
- Easier to debug

#### 6.1.2 Option B: Combined Endpoint

**Combined Dashboard Endpoint:**
- **Path:** GET `/api/student/dashboard`
- **Purpose:** Returns both LMS and Game stats in one response
- **Auth:** Requires `verifyStudentToken`

**Benefits:**
- Single request for all data
- Atomic data snapshot
- Simpler frontend code

**Recommendation:** Use **Option A (Separate Endpoints)** for better separation and flexibility.

---

### 6.2 LMS Progress Panel API Contract

#### 6.2.1 Endpoint: GET `/api/student/dashboard-lms`

**Request:**
```
GET /api/student/dashboard-lms
Headers: Authorization: Bearer {studentToken}
```

**Response Shape:**
```json
{
  "success": true,
  "lmsStats": {
    "overall": {
      "totalLessons": 6,
      "lessonsCompleted": 5,
      "averageQuizScore": 7.5,
      "simulationsPassed": 6,
      "totalSimulations": 6,
      "overallCompletionPercent": 83,
      "totalPages": 30,
      "completedPages": 28,
      "pageCompletionPercent": 93
    },
    "lessons": [
      {
        "slot": 1,
        "lessonTitle": "Lesson 1: Monitoring Vital Signs",
        "lessonStatus": "completed",
        "pageCount": 5,
        "completedPageCount": 5,
        "pageProgressPercent": 100,
        "quiz": {
          "completed": true,
          "bestScore": 8,
          "attempts": 2,
          "passed": true,
          "lastAttempt": "2025-11-30T12:00:00.000Z"
        },
        "simulation": {
          "status": "passed",
          "completed": true,
          "passed": true,
          "score": 100,
          "lastAttempt": "2025-11-30T12:00:00.000Z"
        }
      },
      {
        "slot": 2,
        "lessonTitle": "Lesson 2: Medication Assistance",
        "lessonStatus": "in_progress",
        "pageCount": 4,
        "completedPageCount": 2,
        "pageProgressPercent": 50,
        "quiz": {
          "completed": false,
          "bestScore": null,
          "attempts": 0,
          "passed": false,
          "lastAttempt": null
        },
        "simulation": {
          "status": "not_started",
          "completed": false,
          "passed": false,
          "score": null,
          "lastAttempt": null
        }
      }
      // ... lessons 3-6
    ],
    "certificateEligibility": {
      "eligible": false,
      "missingRequirements": [
        "Lesson 2: Pages, Quiz, Simulation"
      ]
    }
  }
}
```

**Firebase Paths Used:**
- `users/{uid}/lmsProgress/lesson{slot}` (primary)
- `lmsLessons/{slot}/pages` (for page counts)
- `users/{uid}/certificates/caresim_lms_full` (for certificate status)

**Fields Used by Certificates:**
- `lessons[].lessonStatus === "completed"` (indicates eligibility)
- `certificateEligibility.eligible` (direct eligibility flag)

**Fields Purely for Display:**
- `overall.averageQuizScore`
- `overall.pageCompletionPercent`
- `lessons[].pageProgressPercent`
- `lessons[].quiz.attempts`
- `lessons[].simulation.score`

**Caching/Aggregation Hints:**
- Page counts can be cached (rarely change)
- Progress data should be read fresh (changes frequently)
- Certificate eligibility can be computed client-side from lesson statuses

---

### 6.3 Game Progress Panel API Contract

#### 6.3.1 Endpoint: GET `/api/student/dashboard-game`

**Request:**
```
GET /api/student/dashboard-game
Headers: Authorization: Bearer {studentToken}
```

**Response Shape:**
```json
{
  "success": true,
  "gameStats": {
    "overall": {
      "totalGameLessons": 6,
      "gameLessonsCompleted": 6,
      "averageGameQuizScore": 8.2,
      "gameSimulationsPassed": 6,
      "totalGameSimulations": 6,
      "gameCompletionPercent": 100
    },
    "lessons": [
      {
        "slot": 1,
        "gameLessonStatus": "completed",
        "quiz": {
          "bestScore": 9,
          "attempts": 3,
          "completed": true,
          "lastAttempt": "2025-11-30T12:00:00.000Z"
        },
        "simulation": {
          "status": "passed",
          "completed": true,
          "passed": true,
          "score": 100,
          "attempts": 1,
          "lastAttempt": "2025-11-30T12:00:00.000Z"
        }
      },
      {
        "slot": 2,
        "gameLessonStatus": "in_progress",
        "quiz": {
          "bestScore": 6,
          "attempts": 1,
          "completed": true,
          "lastAttempt": "2025-11-30T12:00:00.000Z"
        },
        "simulation": {
          "status": "not_started",
          "completed": false,
          "passed": false,
          "score": null,
          "attempts": 0,
          "lastAttempt": null
        }
      }
      // ... lessons 3-6
    ],
    "certificateEligibility": {
      "eligible": true,
      "hasCertificate": false,
      "certificateId": null
    }
  }
}
```

**Firebase Paths Used:**
- `users/{uid}/lessonsCompleted` (format 1)
- `users/{uid}/gameProgress/lessonsCompleted` (format 2)
- `users/{uid}/progress/gameLessons/{lessonKey}/completed` (format 3)
- `users/{uid}/progress/lesson{slot}` (per-lesson progress)
- `users/{uid}/history/quizzes/{quizId}` (quiz history - primary source)
- `users/{uid}/history/simulations/{simId}` (simulation history - primary source)
- `users/{uid}/certificates/game_generic` (certificate status)

**Fields Used by Certificates:**
- `overall.gameLessonsCompleted >= 6` (indicates eligibility)
- `certificateEligibility.eligible` (direct eligibility flag)
- `certificateEligibility.hasCertificate` (whether certificate already issued)

**Fields Purely for Display:**
- `overall.averageGameQuizScore`
- `lessons[].quiz.attempts`
- `lessons[].simulation.score`
- `lessons[].quiz.bestScore`

**Caching/Aggregation Hints:**
- History data can be expensive to scan (many entries)
- Consider caching history aggregates (refresh every 5 minutes)
- Progress data should be read fresh
- Completion counts rarely change (only when lesson completed)

---

### 6.4 Combined Dashboard Endpoint (Alternative)

#### 6.4.1 Endpoint: GET `/api/student/dashboard`

**Request:**
```
GET /api/student/dashboard
Headers: Authorization: Bearer {studentToken}
```

**Response Shape:**
```json
{
  "success": true,
  "profile": {
    "uid": "student-uid",
    "name": "John Doe",
    "email": "john@example.com",
    "studentNumber": "2025-001",
    "batch": "2025",
    "assignedInstructor": "Instructor Name"
  },
  "lmsStats": {
    // Same as GET /api/student/dashboard-lms
  },
  "gameStats": {
    // Same as GET /api/student/dashboard-game
  }
}
```

**Note:** This combines profile + LMS stats + Game stats in one response.

---

## 7. MIGRATION & BACKWARD COMPATIBILITY PLAN

### 7.1 Legacy Data Locations

#### 7.1.1 Old LMS Progress in `progress/lesson{i}`

**Problem:**
- Some students may have LMS progress in `users/{uid}/progress/lesson{i}` (Unity path)
- This conflicts with Unity game progress (same path)
- Cannot distinguish LMS vs Game data in this path

**Detection:**
```javascript
// Check if progress/lesson{i} contains LMS-like data
// Indicators:
// - Has completedPages field (LMS-specific)
// - Has lmsProgress also exists (newer format)
// - No history/quizzes entries (LMS quizzes not in history)
```

**Migration Strategy:**
1. **Identify LMS data in `progress/lesson{i}`:**
   - If `completedPages` exists → Likely LMS data
   - If `lmsProgress/lesson{i}` also exists → `progress` is old/duplicate
   - If only `progress/lesson{i}` exists and has `completedPages` → Migrate to `lmsProgress`

2. **Migration Steps:**
   ```
   For each lesson (1-6):
     If progress/lesson{i}/completedPages exists:
       Copy to lmsProgress/lesson{i}/completedPages
     If progress/lesson{i}/quiz exists AND lmsProgress/lesson{i}/quiz does NOT exist:
       Copy to lmsProgress/lesson{i}/quiz
     If progress/lesson{i}/simulation exists AND lmsProgress/lesson{i}/simulation does NOT exist:
       Copy to lmsProgress/lesson{i}/simulation
   ```

3. **Flag Migration:**
   - Add `users/{uid}/_migratedToLmsProgress = true` after migration
   - Skip migration if flag exists

---

#### 7.1.2 Legacy Student Collection

**Path:** `students/{uid}/lessonProgress/{i}`

**Problem:**
- Old format from before users collection existed
- May contain LMS or Game data (unclear)

**Migration Strategy:**
1. **Check if user exists in `users` collection:**
   - If yes → User is migrated, ignore `students/{uid}`
   - If no → User needs full migration (not just progress)

2. **For Progress-Only Migration:**
   ```
   If students/{uid}/lessonProgress/{i} exists:
     If users/{uid}/lmsProgress/lesson{i} does NOT exist:
       Copy to lmsProgress/lesson{i}
     Mark as migrated
   ```

3. **Keep as Fallback:**
   - During transition, keep reading from `students/{uid}/lessonProgress/{i}` as fallback
   - Log when fallback is used (for monitoring)
   - Remove fallback after 6 months or when all users migrated

---

### 7.2 Avoiding Game/LMS Confusion

#### 7.2.1 Path Separation Rules

**LMS Progress:**
- **MUST use:** `users/{uid}/lmsProgress/lesson{slot}`
- **MUST NOT use:** `users/{uid}/progress/lesson{slot}` (this is Game)
- **Exception:** Migration from old `progress` path (one-time)

**Game Progress:**
- **MUST use:** `users/{uid}/progress/lesson{slot}` (Unity writes here)
- **CAN use:** `users/{uid}/history/quizzes` and `users/{uid}/history/simulations`
- **MUST NOT use:** `users/{uid}/lmsProgress/lesson{slot}` (this is LMS)

**Completion Counts:**
- **Game only:** `lessonsCompleted`, `gameProgress/lessonsCompleted`, `progress/gameLessons`
- **LMS:** No completion count field (use per-lesson status aggregation)

---

#### 7.2.2 Data Validation

**Before Writing LMS Progress:**
```javascript
// Ensure we're writing to correct path
const path = `users/${uid}/lmsProgress/lesson${slot}`;
// NOT: users/${uid}/progress/lesson${slot}
```

**Before Reading Progress:**
```javascript
// Determine if reading LMS or Game
const isLms = context === 'lms' || endpoint.includes('lms');
const path = isLms 
    ? `users/${uid}/lmsProgress/lesson${slot}`
    : `users/${uid}/progress/lesson${slot}`;
```

---

### 7.3 Step-by-Step Migration Plan

#### Phase 1: Detection (Week 1)
1. **Scan all users:**
   - Identify users with data in `progress/lesson{i}` that looks like LMS (has `completedPages`)
   - Identify users with data in `students/{uid}/lessonProgress/{i}`
   - Count affected users

2. **Create migration script:**
   - Script: `scripts/migrate-progress-to-lms.js`
   - Dry-run mode (no writes)
   - Log all planned migrations

#### Phase 2: Migration (Week 2)
1. **Run migration script:**
   - Migrate `progress/lesson{i}` → `lmsProgress/lesson{i}` (if LMS data detected)
   - Migrate `students/{uid}/lessonProgress/{i}` → `lmsProgress/lesson{i}` (if user in `users` collection)
   - Set `_migratedToLmsProgress = true` flag

2. **Verify migrations:**
   - Spot-check migrated users
   - Verify data integrity
   - Check for duplicates

#### Phase 3: Code Updates (Week 3)
1. **Update student routes:**
   - Change dashboard to read from `lmsProgress`
   - Keep fallback to `students/{uid}/lessonProgress/{i}` for unmigrated users
   - Add logging for fallback usage

2. **Update frontend:**
   - Update dashboard JS to use new endpoints
   - Add LMS/Game panel separation

#### Phase 4: Monitoring (Week 4+)
1. **Monitor fallback usage:**
   - Log when `students/{uid}/lessonProgress` is used
   - Track migration completion rate
   - Identify unmigrated users

2. **Remove fallback (Future):**
   - After 6 months or 100% migration
   - Remove `students/{uid}/lessonProgress` fallback
   - Remove migration script

---

## 8. CONCRETE TO-DO LIST FOR STUDENT SIDE (STATS-FOCUSED)

### 8.1 High Priority (Critical for Correctness)

1. **Create GET `/api/student/dashboard-lms` endpoint**
   - **File:** `routes/student.js` (new endpoint)
   - **Logic:**
     - Read from `users/{uid}/lmsProgress/lesson{slot}` (NOT `progress`)
     - Compute per-lesson stats using Admin eligibility rules
     - Compute overall LMS summary stats
     - Return JSON shape as defined in section 6.2.1
   - **Dependencies:** None
   - **Estimated Time:** 2-3 hours

2. **Create GET `/api/student/dashboard-game` endpoint**
   - **File:** `routes/student.js` (new endpoint)
   - **Logic:**
     - Read from `users/{uid}/progress/lesson{slot}` (Game path)
     - Read from `users/{uid}/history/quizzes` and `history/simulations` (primary source)
     - Check all three completion count formats (same as Admin)
     - Compute per-game-lesson stats
     - Compute overall Game summary stats
     - Return JSON shape as defined in section 6.3.1
   - **Dependencies:** None
   - **Estimated Time:** 2-3 hours

3. **Fix existing GET `/api/student/dashboard` endpoint**
   - **File:** `routes/student.js` (modify existing)
   - **Changes:**
     - Change line 83: `progress/lesson{i}` → `lmsProgress/lesson{i}`
     - Update status calculation (lines 98-106) to match Admin eligibility rules
     - Add page completion check
     - Add quiz score threshold check (>= 7)
     - Add simulation `passed` check
   - **Dependencies:** None (can be done independently)
   - **Estimated Time:** 1-2 hours

4. **Fix existing GET `/api/user/dashboard` endpoint**
   - **File:** `routes/user.js` (modify existing)
   - **Changes:**
     - Change line 82: `progress` → `lmsProgress`
     - Update completion logic (lines 114-116) to match Admin rules
     - Add page, quiz score, and simulation `passed` checks
   - **Dependencies:** None
   - **Estimated Time:** 1 hour

---

### 8.2 Medium Priority (Enhancements)

5. **Update student dashboard frontend to use new endpoints**
   - **File:** `public/student-dashboard.html` (modify JS)
   - **Changes:**
     - Call GET `/api/student/dashboard-lms` for LMS panel
     - Call GET `/api/student/dashboard-game` for Game panel
     - Render two separate panels with correct data
     - Update progress indicators to use correct stats
   - **Dependencies:** Tasks 1 and 2 (new endpoints)
   - **Estimated Time:** 3-4 hours

6. **Add LMS progress migration utility**
   - **File:** `utils/progressMigration.js` (new file)
   - **Logic:**
     - Detect LMS data in `progress/lesson{i}` (has `completedPages`)
     - Migrate to `lmsProgress/lesson{i}`
     - Set migration flag
     - Log migrations
   - **Dependencies:** None (can run independently)
   - **Estimated Time:** 2-3 hours

7. **Add migration script for legacy `students/{uid}/lessonProgress`**
   - **File:** `scripts/migrate-legacy-progress.js` (new file)
   - **Logic:**
     - Scan `students/{uid}/lessonProgress/{i}`
     - Migrate to `users/{uid}/lmsProgress/lesson{i}` (if user exists in `users`)
     - Set migration flag
     - Dry-run mode for testing
   - **Dependencies:** None
   - **Estimated Time:** 2-3 hours

---

### 8.3 Low Priority (Polish & Monitoring)

8. **Add logging for path usage**
   - **File:** `routes/student.js`, `routes/user.js`
   - **Changes:**
     - Log when reading from `lmsProgress` vs `progress`
     - Log when using legacy `students/{uid}/lessonProgress` fallback
     - Log migration flag checks
   - **Dependencies:** None
   - **Estimated Time:** 1 hour

9. **Add data validation helpers**
   - **File:** `utils/progressValidation.js` (new file)
   - **Functions:**
     - `isLmsProgressPath(path)` - validates path is LMS
     - `isGameProgressPath(path)` - validates path is Game
     - `detectProgressType(data)` - detects if data is LMS or Game
   - **Dependencies:** None
   - **Estimated Time:** 1-2 hours

10. **Update API documentation**
    - **File:** `docs/API.md` or similar (create if doesn't exist)
    - **Content:**
      - Document LMS vs Game path separation
      - Document new dashboard endpoints
      - Document migration process
    - **Dependencies:** Tasks 1, 2, 5
    - **Estimated Time:** 1-2 hours

---

### 8.4 Testing Checklist

After implementing changes, verify:

**LMS Stats:**
- [ ] Dashboard reads from `lmsProgress` path (not `progress`)
- [ ] Per-lesson status matches certificate eligibility
- [ ] Page completion counts are accurate
- [ ] Quiz scores are displayed correctly (out of 10)
- [ ] Simulation status shows "passed" only when both `completed` and `passed` are true
- [ ] Overall completion percent matches Admin calculation

**Game Stats:**
- [ ] Dashboard reads from `progress` path (Game data)
- [ ] Game completion count uses same logic as Admin (checks all 3 formats)
- [ ] Quiz scores read from `history/quizzes` (primary) with fallback to `progress`
- [ ] Simulation status reads from `history/simulations` (primary) with fallback to `progress`
- [ ] Game certificate eligibility matches Admin logic

**Separation:**
- [ ] LMS panel shows only LMS data (from `lmsProgress`)
- [ ] Game panel shows only Game data (from `progress` and `history`)
- [ ] No mixing of LMS and Game data in either panel

**Backward Compatibility:**
- [ ] Legacy `students/{uid}/lessonProgress` still works as fallback
- [ ] Migration script successfully migrates old data
- [ ] No data loss during migration

---

## END OF DOCUMENTATION

**Last Updated:** 2025-11-30  
**Next Action:** Implement Task 1 (Create GET `/api/student/dashboard-lms` endpoint)  
**Estimated Total Time:** 15-20 hours for all tasks

**Key Takeaways:**
1. **LMS uses `lmsProgress`, Game uses `progress`** - Never mix them
2. **Admin eligibility rules must match exactly** - Pages + Quiz (>=7) + Simulation (completed + passed)
3. **History is primary source for Game stats** - Like instructor does
4. **Migration is needed** - Old data in `progress/lesson{i}` and `students/{uid}/lessonProgress/{i}`
5. **Dual panels** - Separate LMS and Game stats for clarity


