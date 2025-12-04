# CareSim CMS - Student Integration Plan
## Aligning Student Side with Admin Data Contracts

**Generated:** 2025-11-30  
**Purpose:** Detailed plan to align Student-side code with Admin-side data contracts  
**Status:** READ-ONLY ANALYSIS - NO CODE MODIFICATIONS YET

---

## TABLE OF CONTENTS

1. [Overview](#1-overview)
2. [Admin Data Sources (LMS + Game)](#2-admin-data-sources-lms--game)
3. [Current Student-Side Behavior](#3-current-student-side-behavior)
4. [Exact Admin ↔ Student Mapping](#4-exact-admin--student-mapping)
5. [Mismatch Table](#5-mismatch-table)
6. [LMS Progress Contract](#6-lms-progress-contract)
7. [Game Progress Contract](#7-game-progress-contract)
8. [Certificates](#8-certificates)
9. [Student-Side Change Checklist](#9-student-side-change-checklist)
10. [Open Questions / Ambiguities](#10-open-questions--ambiguities)
11. [Next Steps](#11-next-steps)

---

## 1. OVERVIEW

### 1.1 Purpose
This document maps how the **Admin side** (source of truth) and **Student side** currently interact with Firebase data, identifies all mismatches, and provides a concrete plan to align Student-side code with Admin contracts.

### 1.2 Key Principles
- **Admin is source of truth:** All data structures, paths, and eligibility logic defined by Admin must be respected
- **Backward compatibility:** Existing student data must continue to work during transition
- **Dual progress tracking:** LMS progress (web-based) and Game progress (Unity-based) are separate systems
- **Certificate eligibility:** Must match exactly between Admin and Student sides

### 1.3 Scope
- **LMS Progress:** Pages, assessments, quizzes, simulations (web-based)
- **Game Progress:** Unity game lessons, quizzes, simulations (separate from LMS)
- **Certificates:** LMS full course certificates (student-triggered) and Game generic certificates (admin-issued)
- **Statistics:** Dashboard metrics, progress tracking, completion status

---

## 2. ADMIN DATA SOURCES (LMS + GAME)

### 2.1 LMS Progress - Admin Expectations

#### Firebase Path:
- `users/{uid}/lmsProgress/lesson{slot}`

#### Canonical Structure (Admin Contract):
```json
{
  "completedPages": {
    "pageId1": true,
    "pageId2": true,
    "pageId3": true
  },
  "quiz": {
    "completed": true,
    "highestScore": 8,  // Out of 10
    "attempts": 2,
    "lastAttempt": "2025-11-30T12:00:00.000Z"
  },
  "simulation": {
    "completed": true,
    "passed": true,
    "score": 100,
    "lastAttempt": "2025-11-30T12:00:00.000Z"
  },
  "lastAssessment": "2025-11-30T12:00:00.000Z"
}
```

#### Admin Eligibility Rules (LMS Certificate):
For each lesson (1-6), ALL must be true:
1. **Pages:** `Object.keys(completedPages).length > 0` (at least one page completed)
2. **Quiz:** `quiz.completed === true` AND `quiz.highestScore >= 7` (70% passing)
3. **Simulation:** `simulation.completed === true` AND `simulation.passed === true` (both required)

**Code Reference:** `public/js/admin-game-certificates.js` lines 74-88

---

### 2.2 Game Progress - Admin Expectations

#### Firebase Paths (Multiple Formats Supported):
- `users/{uid}/lessonsCompleted` (direct number)
- `users/{uid}/gameProgress/lessonsCompleted` (nested number)
- `users/{uid}/progress/gameLessons/{lessonKey}/completed` (detailed boolean map)

#### Admin Logic (Game Certificate Eligibility):
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
```

**Code Reference:** `public/js/admin-game-certificates.js` lines 50-56

#### Unity Game Progress Structure (Inferred):
Unity writes to:
- `users/{uid}/progress/lesson{slot}/quiz` (quiz data)
- `users/{uid}/progress/lesson{slot}/simulation` (simulation data)
- `users/{uid}/history/quizzes/{quizId}` (quiz history)
- `users/{uid}/history/simulations/{simId}` (simulation history)

**Note:** Unity progress is separate from LMS progress. Unity uses `progress/lesson{slot}` while LMS uses `lmsProgress/lesson{slot}`.

---

### 2.3 Certificates - Admin Expectations

#### Central Registry:
- Path: `certificates/{certificateId}`
- Fields: `type`, `userId`, `fullName`, `email`, `issuedAt`, `status`

#### User Certificate Nodes:
- LMS: `users/{uid}/certificates/caresim_lms_full`
- Game: `users/{uid}/certificates/game_generic`

#### Certificate ID Formats:
- LMS: `LMS-{6-digit-timestamp}-{random-3-digit}`
- Game: `PUB-{6-digit-timestamp}-{random-3-digit}`

---

## 3. CURRENT STUDENT-SIDE BEHAVIOR

### 3.1 Student Dashboard (`routes/student.js` - GET `/dashboard`)

#### Current Behavior:
- **Reads from:** `users/{uid}/progress/lesson{i}` (WRONG PATH - should be `lmsProgress`)
- **Checks:** `quiz.completed` and `simulation.completed` (MISSING `simulation.passed` check)
- **Status Logic:**
  - `completed`: if `quizCompleted && simCompleted` (MISSING `simPassed` check)
  - `in_progress`: if `quizCompleted || simCompleted || attempts > 0`
  - `not_started`: otherwise

**Code Reference:** `routes/student.js` lines 82-116

#### Issues:
1. Uses `progress/lesson{i}` instead of `lmsProgress/lesson{i}`
2. Does not check `simulation.passed` (only checks `simulation.completed`)
3. Status determination does not match Admin's eligibility logic

---

### 3.2 Student Lessons Page (`public/student-lessons.html`)

#### Current Behavior:
- **Reads lessons from:** `/api/user/lessons` (which reads from `lessons/{slot}`) ✅ CORRECT
- **Reads pages from:** `/api/student/lessons/:slot/pages` (which reads from `lmsLessons/{slot}/pages`) ✅ CORRECT
- **Progress tracking:** Uses dashboard API which has the path mismatch issue

**Code Reference:** `public/student-lessons.html` lines 235-280

#### Issues:
- Relies on dashboard API which uses wrong path
- "Mark as Completed" button does not write to Firebase (TODO comment)

---

### 3.3 Student Assessment Submission (`routes/student.js` - POST `/lessons/:slot/pages/:pageId/assessments/submit`)

#### Current Behavior:
- **Reads assessments from:** `lmsLessons/{slot}/pages/{pageId}/assessments` ✅ CORRECT
- **Writes page completion to:** `users/{uid}/lmsProgress/lesson{slot}/completedPages/{pageId}` ✅ CORRECT
- **Scoring:** 70% threshold ✅ CORRECT
- **Updates:** `lastAssessment` timestamp ✅ CORRECT

**Code Reference:** `routes/student.js` lines 579-666

#### Status:
✅ **ALIGNED** - This endpoint correctly uses `lmsProgress` path and writes correctly.

---

### 3.4 Student Certificate Eligibility (`public/js/student-certificates.js`)

#### Current Behavior:
- **Reads from:** `users/{uid}/lmsProgress` ✅ CORRECT PATH
- **Eligibility Check:**
  - Pages: `Object.keys(completedPages).length > 0` ✅ CORRECT
  - Quiz: `quiz.completed === true` AND `quiz.highestScore >= 7` ✅ CORRECT
  - Simulation: `sim.completed === true` AND `sim.passed === true` ✅ CORRECT

**Code Reference:** `public/js/student-certificates.js` lines 114-143

#### Status:
✅ **ALIGNED** - Certificate eligibility logic matches Admin exactly.

---

### 3.5 Student Certificate Generation (`public/js/student-certificates.js`)

#### Current Behavior:
- **Writes to user node:** `users/{uid}/certificates/caresim_lms_full` ✅ CORRECT
- **Registers in central registry:** POST `/api/student/register-certificate` ✅ CORRECT
- **Certificate ID format:** `LMS-{timestamp-6digits}-{random-3digits}` ✅ CORRECT

**Code Reference:** `public/js/student-certificates.js` lines 186-238

#### Status:
✅ **ALIGNED** - Certificate generation and registration matches Admin expectations.

---

### 3.6 Student Dashboard API (`routes/student.js` - GET `/dashboard`)

#### Current Behavior:
- **Reads progress from:** `users/{uid}/progress/lesson{i}` ❌ WRONG PATH
- **Fallback:** `students/{uid}/lessonProgress/{i}` (legacy path)
- **Status calculation:** Based on `quiz.completed` and `simulation.completed` only (missing `passed` check)

**Code Reference:** `routes/student.js` lines 82-116

#### Issues:
1. Uses `progress/lesson{i}` instead of `lmsProgress/lesson{i}`
2. Does not check `simulation.passed`
3. Does not check page completion
4. Status logic does not match Admin's eligibility requirements

---

## 4. EXACT ADMIN ↔ STUDENT MAPPING

### 4.1 Lessons and Pages

| Feature | Admin Expectation | Student Current Behavior | Status |
|---------|------------------|------------------------|--------|
| **Lesson Metadata** | `lessons/{slot}` | Reads from `lessons/{slot}` via `/api/user/lessons` | ✅ ALIGNED |
| **Pages** | `lmsLessons/{slot}/pages` | Reads from `lmsLessons/{slot}/pages` via `/api/student/lessons/:slot/pages` | ✅ ALIGNED |
| **Assessments** | `lmsLessons/{slot}/pages/{pageId}/assessments` | Reads from same path via `/api/student/lessons/:slot/pages/:pageId/assessments` | ✅ ALIGNED |

---

### 4.2 Progress Tracking

| Feature | Admin Expectation | Student Current Behavior | Status |
|---------|------------------|------------------------|--------|
| **LMS Progress Path** | `users/{uid}/lmsProgress/lesson{slot}` | Assessment submission: ✅ Uses `lmsProgress`<br>Dashboard: ❌ Uses `progress/lesson{i}` | ⚠️ PARTIAL |
| **Page Completion** | `users/{uid}/lmsProgress/lesson{slot}/completedPages/{pageId} = true` | ✅ Writes correctly on assessment pass | ✅ ALIGNED |
| **Quiz Data** | `users/{uid}/lmsProgress/lesson{slot}/quiz = { completed, highestScore, attempts, lastAttempt }` | ❌ Dashboard reads from `progress/lesson{i}/quiz` | ❌ MISMATCH |
| **Simulation Data** | `users/{uid}/lmsProgress/lesson{slot}/simulation = { completed, passed, score, lastAttempt }` | ❌ Dashboard reads from `progress/lesson{i}/simulation`<br>❌ Does not check `passed` field | ❌ MISMATCH |

---

### 4.3 Certificate Eligibility

| Feature | Admin Expectation | Student Current Behavior | Status |
|---------|------------------|------------------------|--------|
| **Eligibility Check Path** | `users/{uid}/lmsProgress` | ✅ Reads from `lmsProgress` | ✅ ALIGNED |
| **Pages Requirement** | `Object.keys(completedPages).length > 0` | ✅ Checks correctly | ✅ ALIGNED |
| **Quiz Requirement** | `quiz.completed === true` AND `quiz.highestScore >= 7` | ✅ Checks correctly | ✅ ALIGNED |
| **Simulation Requirement** | `sim.completed === true` AND `sim.passed === true` | ✅ Checks correctly | ✅ ALIGNED |
| **All 6 Lessons** | All lessons must meet all criteria | ✅ Checks all 6 lessons | ✅ ALIGNED |

---

### 4.4 Certificate Generation

| Feature | Admin Expectation | Student Current Behavior | Status |
|---------|------------------|------------------------|--------|
| **User Node** | `users/{uid}/certificates/caresim_lms_full` | ✅ Writes correctly | ✅ ALIGNED |
| **Central Registry** | `certificates/{certId}` via POST `/api/student/register-certificate` | ✅ Registers correctly | ✅ ALIGNED |
| **Certificate ID Format** | `LMS-{6-digit-timestamp}-{random-3-digit}` | ✅ Generates correctly | ✅ ALIGNED |

---

## 5. MISMATCH TABLE

| Feature | Admin Path/Fields | Student Path/Fields | Problem | Suggested Fix |
|---------|------------------|-------------------|---------|---------------|
| **Dashboard Progress Read** | `users/{uid}/lmsProgress/lesson{slot}` | `users/{uid}/progress/lesson{slot}` | Wrong path - reads from Unity game progress instead of LMS progress | Change `routes/student.js` GET `/dashboard` to read from `lmsProgress` |
| **Dashboard Status Calculation** | Pages + Quiz (>=7) + Simulation (completed + passed) | Quiz completed + Simulation completed (no pages, no passed check) | Status does not reflect actual eligibility | Update status logic to match Admin eligibility rules |
| **Dashboard Simulation Check** | `simulation.completed === true` AND `simulation.passed === true` | `simulation.completed === true` only | Missing `passed` check means incomplete simulations count as complete | Add `simulation.passed` check in dashboard status calculation |
| **Dashboard Page Completion** | Checks `completedPages` object | Does not check pages at all | Dashboard does not consider page completion in status | Add page completion check to dashboard status logic |
| **Legacy Path Support** | N/A (Admin only uses `lmsProgress`) | Falls back to `students/{uid}/lessonProgress/{i}` | Legacy path may contain old data that conflicts | Keep fallback for backward compatibility but prioritize `lmsProgress` |

---

## 6. LMS PROGRESS CONTRACT

### 6.1 Canonical Structure

#### Firebase Path:
```
users/{uid}/lmsProgress/lesson{slot}
```

#### Required Fields:
```json
{
  "completedPages": {
    "pageId1": true,
    "pageId2": true,
    ...
  },
  "quiz": {
    "completed": true,        // Required for eligibility
    "highestScore": 8,        // Out of 10, must be >= 7 for eligibility
    "attempts": 2,
    "lastAttempt": "ISO timestamp"
  },
  "simulation": {
    "completed": true,        // Required for eligibility
    "passed": true,           // Required for eligibility (BOTH completed AND passed)
    "score": 100,
    "lastAttempt": "ISO timestamp"
  },
  "lastAssessment": "ISO timestamp"  // Optional, tracks last page assessment completion
}
```

### 6.2 Page Completion Rules

- **Trigger:** Student passes page assessments (70% threshold)
- **Write Path:** `users/{uid}/lmsProgress/lesson{slot}/completedPages/{pageId} = true`
- **Read Path:** `users/{uid}/lmsProgress/lesson{slot}/completedPages`
- **Eligibility:** At least one page must be completed (`Object.keys(completedPages).length > 0`)

**Current Implementation:** ✅ Correctly implemented in `routes/student.js` POST `/lessons/:slot/pages/:pageId/assessments/submit`

### 6.3 Quiz Completion Rules

- **Path:** `users/{uid}/lmsProgress/lesson{slot}/quiz`
- **Completion:** `quiz.completed === true`
- **Passing:** `quiz.highestScore >= 7` (70% of 10 points)
- **Eligibility:** BOTH `completed === true` AND `highestScore >= 7` must be true

**Current Implementation:** 
- ✅ Certificate eligibility check correctly implements this
- ❌ Dashboard does not check `highestScore >= 7`

### 6.4 Simulation Completion Rules

- **Path:** `users/{uid}/lmsProgress/lesson{slot}/simulation`
- **Completion:** `simulation.completed === true`
- **Passing:** `simulation.passed === true`
- **Eligibility:** BOTH `completed === true` AND `passed === true` must be true

**Current Implementation:**
- ✅ Certificate eligibility check correctly implements this
- ❌ Dashboard only checks `completed`, not `passed`

### 6.5 Lesson Status Determination

#### Admin Logic (for certificate eligibility):
```javascript
const lessonData = progress[`lesson${i}`] || {};
const completedPages = lessonData.completedPages || {};
const hasPages = Object.keys(completedPages).length > 0;
const quiz = lessonData.quiz || {};
const quizCompleted = quiz.completed === true;
const quizScoreOk = (quiz.highestScore || 0) >= 7;
const sim = lessonData.simulation || {};
const simOk = sim.completed === true && sim.passed === true;

// Lesson is "complete" for eligibility if:
// hasPages && quizCompleted && quizScoreOk && simOk
```

#### Student Dashboard Should Use:
- **Completed:** All criteria met (pages + quiz >=7 + simulation passed)
- **In Progress:** Some criteria met but not all
- **Not Started:** No progress data

**Current Student Logic:** ❌ Does not match - only checks quiz and simulation completion, ignores pages and quiz score threshold.

---

## 7. GAME PROGRESS CONTRACT

### 7.1 Admin Expectations

#### Supported Formats (Admin checks all):
1. **Direct Count:** `users/{uid}/lessonsCompleted = 6`
2. **Nested Count:** `users/{uid}/gameProgress/lessonsCompleted = 6`
3. **Detailed Map:** `users/{uid}/progress/gameLessons/{lessonKey}/completed = true`

#### Unity Game Progress Structure (Inferred):
Unity writes to:
- `users/{uid}/progress/lesson{slot}/quiz` (quiz scores, attempts)
- `users/{uid}/progress/lesson{slot}/simulation` (simulation results)
- `users/{uid}/history/quizzes/{quizId}` (quiz history entries)
- `users/{uid}/history/simulations/{simId}` (simulation history entries)

**Note:** Unity uses `progress/lesson{slot}` while LMS uses `lmsProgress/lesson{slot}`. These are separate systems.

### 7.2 Student/Instructor Side Treatment

#### For LMS Statistics:
- **MUST use:** `users/{uid}/lmsProgress/lesson{slot}`
- **MUST NOT use:** `users/{uid}/progress/lesson{slot}` (this is Unity game data)

#### For Game Statistics:
- **CAN use:** `users/{uid}/progress/lesson{slot}` (Unity game data)
- **CAN use:** `users/{uid}/history/quizzes` and `users/{uid}/history/simulations` (Unity history)
- **CAN use:** `users/{uid}/lessonsCompleted` or `users/{uid}/gameProgress/lessonsCompleted` (game completion counts)

#### Separation Principle:
- **LMS Progress:** Web-based lessons, pages, assessments → `lmsProgress`
- **Game Progress:** Unity game lessons, quizzes, simulations → `progress` (or `gameProgress`)

**Current Student Behavior:** ❌ Dashboard mixes LMS and Game progress by reading from `progress/lesson{i}` instead of `lmsProgress/lesson{i}`.

---

## 8. CERTIFICATES

### 8.1 LMS Certificate Generation (Student-Triggered)

#### Current Flow (Student Side):
1. Student checks eligibility via `users/{uid}/lmsProgress` ✅
2. Student generates certId: `LMS-{timestamp-6digits}-{random-3digits}` ✅
3. Student writes to `users/{uid}/certificates/caresim_lms_full` ✅
4. Student calls POST `/api/student/register-certificate` ✅
5. Backend writes to `certificates/{certId}` (central registry) ✅

#### Status:
✅ **FULLY ALIGNED** - Student certificate generation matches Admin expectations exactly.

**Code References:**
- Eligibility: `public/js/student-certificates.js` lines 114-143
- Generation: `public/js/student-certificates.js` lines 186-238
- Registration: `routes/student.js` lines 670-708

---

### 8.2 Game Certificate Issuance (Admin-Triggered)

#### Admin Flow:
1. Admin checks eligibility (6/6 lessons completed) via multiple progress formats
2. Admin generates certId: `PUB-{timestamp-6digits}-{random-3digits}`
3. Admin writes to `certificates/{certId}` (central registry)
4. Admin writes to `users/{uid}/certificates/game_generic`
5. Admin calls POST `/api/admin/issue-game-certificate` (sends email)

#### Student Side:
- **No student-side code** for game certificate generation (admin-only)
- Students receive email link to `/generic-certificate.html?certId={certId}`

#### Status:
✅ **N/A** - Game certificates are admin-only, no student-side changes needed.

---

### 8.3 Certificate Verification

#### Public Endpoint:
- GET `/api/public/certificate/:certId`
- Reads from: `certificates/{certId}` (central registry)
- Returns: Certificate data if `status === "valid"`

#### Student Side:
- Uses same public endpoint for verification
- No changes needed

#### Status:
✅ **ALIGNED** - Verification uses central registry correctly.

---

## 9. STUDENT-SIDE CHANGE CHECKLIST

### 9.1 High Priority (Critical Mismatches)

- [ ] **Fix Dashboard Progress Path** (`routes/student.js` GET `/dashboard`)
  - **Current:** Reads from `users/{uid}/progress/lesson{i}`
  - **Change to:** Read from `users/{uid}/lmsProgress/lesson{i}`
  - **Keep fallback:** `students/{uid}/lessonProgress/{i}` for backward compatibility
  - **File:** `routes/student.js` lines 82-116
  - **Impact:** Dashboard will show correct LMS progress instead of Unity game progress

- [ ] **Fix Dashboard Status Calculation** (`routes/student.js` GET `/dashboard`)
  - **Current:** Status based on `quiz.completed && sim.completed` only
  - **Change to:** Status based on Admin eligibility rules:
    - Pages: `Object.keys(completedPages).length > 0`
    - Quiz: `quiz.completed === true` AND `quiz.highestScore >= 7`
    - Simulation: `sim.completed === true` AND `sim.passed === true`
  - **File:** `routes/student.js` lines 98-106
  - **Impact:** Dashboard status will match certificate eligibility

- [ ] **Add Simulation Passed Check** (`routes/student.js` GET `/dashboard`)
  - **Current:** Only checks `simulation.completed`
  - **Change to:** Check BOTH `simulation.completed === true` AND `simulation.passed === true`
  - **File:** `routes/student.js` line 91
  - **Impact:** Incomplete simulations won't count as complete

- [ ] **Add Page Completion Check** (`routes/student.js` GET `/dashboard`)
  - **Current:** Does not check page completion
  - **Change to:** Check `Object.keys(completedPages).length > 0`
  - **File:** `routes/student.js` lines 98-106
  - **Impact:** Lessons without completed pages won't show as complete

- [ ] **Add Quiz Score Threshold Check** (`routes/student.js` GET `/dashboard`)
  - **Current:** Only checks `quiz.completed`
  - **Change to:** Check BOTH `quiz.completed === true` AND `quiz.highestScore >= 7`
  - **File:** `routes/student.js` lines 98-106
  - **Impact:** Quizzes below 70% won't count toward completion

---

### 9.2 Medium Priority (Enhancements)

- [ ] **Update Student Lessons Page Progress** (`public/student-lessons.html`)
  - **Current:** Relies on dashboard API which has path mismatch
  - **Change to:** Use correct API endpoint or fix dashboard API first
  - **File:** `public/student-lessons.html` lines 266-280
  - **Impact:** Lessons page will show correct progress

- [ ] **Implement "Mark as Completed" Button** (`public/student-lessons.html`)
  - **Current:** TODO comment, does not write to Firebase
  - **Change to:** Remove or implement properly (should not bypass actual completion requirements)
  - **File:** `public/student-lessons.html` lines 830-857
  - **Impact:** Button will either work or be removed

- [ ] **Add Progress Migration Helper** (New utility function)
  - **Purpose:** Migrate old `progress/lesson{i}` data to `lmsProgress/lesson{i}` if needed
  - **Location:** `utils/progressMigration.js` (new file)
  - **Impact:** Existing students with old data format will be migrated

---

### 9.3 Low Priority (Documentation / Cleanup)

- [ ] **Update API Documentation** (if exists)
  - Document that LMS progress uses `lmsProgress` path
  - Document that Game progress uses `progress` path
  - Clarify separation between LMS and Game systems

- [ ] **Add Logging** (`routes/student.js`)
  - Log when reading from legacy `students/{uid}/lessonProgress` path
  - Log when progress path mismatch is detected
  - **Impact:** Better debugging and monitoring

- [ ] **Remove Legacy Path Support** (Future, after migration)
  - Once all students migrated, remove fallback to `students/{uid}/lessonProgress`
  - **Impact:** Cleaner code, but requires migration first

---

## 10. OPEN QUESTIONS / AMBIGUITIES

### 10.1 Quiz and Simulation Data Writing

**Question:** Who writes quiz and simulation data to `users/{uid}/lmsProgress/lesson{slot}/quiz` and `simulation`?

**Current State:**
- Assessment submission writes to `completedPages` ✅
- Quiz data: Not written by student routes (likely written by Unity or separate quiz system)
- Simulation data: Not written by student routes (likely written by Unity or separate simulation system)

**Ambiguity:** 
- If Unity writes quiz/simulation data, does it write to `progress/lesson{slot}` (game) or `lmsProgress/lesson{slot}` (LMS)?
- If there's a separate web-based quiz/simulation system, where does it write?

**Recommendation:** 
- Investigate where quiz and simulation data originates
- Ensure LMS quiz/simulation writes to `lmsProgress/lesson{slot}`
- Ensure Unity game quiz/simulation writes to `progress/lesson{slot}` (separate)

---

### 10.2 Legacy Data Migration

**Question:** How should we handle existing students with data in `progress/lesson{i}` or `students/{uid}/lessonProgress/{i}`?

**Current State:**
- Dashboard has fallback to `students/{uid}/lessonProgress/{i}`
- No migration logic exists

**Ambiguity:**
- Should we migrate old data to `lmsProgress`?
- Should we keep reading from old paths indefinitely?
- How do we distinguish between Unity game progress and old LMS progress in `progress/lesson{i}`?

**Recommendation:**
- Create migration utility to move old LMS data from `progress/lesson{i}` to `lmsProgress/lesson{i}`
- Keep fallback for backward compatibility during transition
- Add flag to mark migrated users

---

### 10.3 Instructor Side Alignment

**Question:** Does instructor side also need updates to match Admin contracts?

**Current State:**
- Instructor reads from `users/{uid}/progress/lesson{i}` (same mismatch as student dashboard)
- Instructor checks `quiz.completed` and `simulation.completed` (missing `passed` check)

**Ambiguity:**
- Should instructor side be updated in same pass as student side?
- Are there other instructor-side mismatches?

**Recommendation:**
- Review `routes/instructor.js` and `public/js/instructor-student-progress.js`
- Apply same fixes as student dashboard (path and status logic)
- Document in separate instructor integration plan if needed

---

### 10.4 Game Progress vs LMS Progress Separation

**Question:** How should student dashboard display both LMS and Game progress?

**Current State:**
- Dashboard only shows one type of progress (currently wrong path)
- No clear separation between LMS and Game progress

**Ambiguity:**
- Should dashboard show both LMS and Game progress separately?
- Or should it only show LMS progress (since it's the LMS dashboard)?

**Recommendation:**
- Student dashboard should focus on LMS progress (`lmsProgress`)
- Game progress should be shown separately (if at all) or in a different section
- Keep clear separation between the two systems

---

## 11. NEXT STEPS

### 11.1 Recommended Implementation Order

#### Phase 1: Fix Critical Path Mismatch (Highest Priority)
1. **Update `routes/student.js` GET `/dashboard`:**
   - Change progress read path from `progress/lesson{i}` to `lmsProgress/lesson{i}`
   - Keep fallback to `students/{uid}/lessonProgress/{i}` for backward compatibility
   - **Files:** `routes/student.js` lines 82-116
   - **Risk:** Low - only changes read path, no data writes
   - **Testing:** Verify dashboard shows correct progress after change

#### Phase 2: Fix Status Calculation Logic (High Priority)
2. **Update status determination in `routes/student.js` GET `/dashboard`:**
   - Add page completion check
   - Add quiz score threshold check (>= 7)
   - Add simulation `passed` check
   - Match Admin eligibility logic exactly
   - **Files:** `routes/student.js` lines 98-106
   - **Risk:** Low - only changes calculation, no data writes
   - **Testing:** Verify status matches certificate eligibility

#### Phase 3: Update Student Lessons Page (Medium Priority)
3. **Update `public/student-lessons.html`:**
   - Ensure it uses corrected dashboard API
   - Remove or implement "Mark as Completed" button properly
   - **Files:** `public/student-lessons.html`
   - **Risk:** Low - UI changes only
   - **Testing:** Verify lessons page shows correct progress

#### Phase 4: Migration and Cleanup (Low Priority)
4. **Create migration utility (if needed):**
   - Migrate old `progress/lesson{i}` data to `lmsProgress/lesson{i}`
   - Add logging for legacy path usage
   - **Files:** New `utils/progressMigration.js`
   - **Risk:** Medium - data migration requires careful testing
   - **Testing:** Test migration on staging data first

---

### 11.2 First Change to Implement

**Recommended First Change:** Fix Dashboard Progress Path

**Why:**
- **Highest impact:** Fixes the core mismatch between Admin and Student
- **Lowest risk:** Only changes read path, no data writes
- **Foundation for other fixes:** Other changes depend on correct path
- **Quick win:** Single file change, immediate improvement

**Implementation:**
1. Open `routes/student.js`
2. Find GET `/dashboard` endpoint (line 40)
3. Change line 83: `db.ref(`users/${req.userId}/progress/lesson${i}`)` 
   - To: `db.ref(`users/${req.userId}/lmsProgress/lesson${i}`)`
4. Update status calculation logic (lines 98-106) to match Admin eligibility rules
5. Test with existing student account
6. Verify dashboard shows correct progress

**Expected Result:**
- Dashboard reads from correct `lmsProgress` path
- Status calculation matches Admin eligibility logic
- Dashboard status aligns with certificate eligibility

---

### 11.3 Testing Checklist

After implementing changes, verify:

- [ ] Dashboard shows correct lesson progress for students with `lmsProgress` data
- [ ] Dashboard falls back correctly for students with legacy `students/{uid}/lessonProgress` data
- [ ] Dashboard status matches certificate eligibility (eligible students show "completed")
- [ ] Dashboard status correctly shows "in_progress" for partially complete lessons
- [ ] Dashboard status correctly shows "not_started" for lessons with no progress
- [ ] Student lessons page shows correct progress
- [ ] Certificate eligibility check still works (should be unchanged)
- [ ] Assessment submission still works (should be unchanged)
- [ ] Certificate generation still works (should be unchanged)

---

## END OF DOCUMENTATION

**Last Updated:** 2025-11-30  
**Next Action:** Implement Phase 1 changes (Fix Dashboard Progress Path)  
**Estimated Time:** 1-2 hours for Phase 1, 2-3 hours for all phases


