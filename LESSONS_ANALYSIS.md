# CareSim Web LMS – FULL "Lessons" Analysis (for Student-side Redesign)

**Generated:** 2025-01-XX  
**Purpose:** Complete analysis of LESSONS system in CareSim Web LMS codebase  
**Status:** READ-ONLY ANALYSIS - NO CODE MODIFICATIONS

---

## 1) LESSON ENTITIES OVERVIEW

### 1.1 LMS Lesson Entities (Web-based)

1. **Lesson Metadata** (`lessons/{slot}`)
   - Main lesson information (title, description, body, status, tools, intro video)
   - **File Reference:** `routes/admin.js` lines 1459-1513, `routes/user.js` lines 397-429
   - **Firebase Path:** `lessons/{slot}` where `slot` is 1-6

2. **LMS Lesson Pages** (`lmsLessons/{slot}/pages/{pageId}`)
   - Individual pages within a lesson
   - **File Reference:** `routes/student.js` lines 626-662, `routes/admin.js` (page management routes)
   - **Firebase Path:** `lmsLessons/{slot}/pages/{pageId}`

3. **Page Assessments** (`lmsLessons/{slot}/pages/{pageId}/assessments/{assessmentId}`)
   - Assessment questions attached to each page
   - **File Reference:** `routes/student.js` lines 665-828
   - **Firebase Path:** `lmsLessons/{slot}/pages/{pageId}/assessments/{assessmentId}`

4. **LMS Progress Tracking** (`users/{uid}/lmsProgress/lesson{slot}`)
   - Student progress for LMS lessons (pages completed, assessments passed)
   - **File Reference:** `routes/student.js` lines 118-376, `STUDENT_PROGRESS_AND_STATS_CONTRACT.md` lines 99-141
   - **Firebase Path:** `users/{uid}/lmsProgress/lesson{slot}` OR `students/{uid}/lmsProgress/lesson{slot}` (legacy)

### 1.2 Game Lesson Entities (Unity-based)

1. **Game Progress** (`users/{uid}/progress/lesson{slot}`)
   - Unity game quiz and simulation progress
   - **File Reference:** `routes/student.js` lines 282-311, `STUDENT_PROGRESS_AND_STATS_CONTRACT.md` lines 182-203
   - **Firebase Path:** `users/{uid}/progress/lesson{slot}` OR `students/{uid}/progress/lesson{slot}` (legacy)

2. **Game Quiz Questions** (`lessons/lesson{slot}/questions/{questionIndex}`)
   - Unity game quiz questions (separate from LMS assessments)
   - **File Reference:** `ADMIN_TO_STUDENT_MAPPING_SUMMARY.md` lines 694-707
   - **Firebase Path:** `lessons/lesson{slot}/questions/{questionIndex}`

3. **Game History** (`users/{uid}/history/quizzes/{quizId}`, `users/{uid}/history/simulations/{simId}`)
   - Historical records of quiz and simulation attempts
   - **File Reference:** `STUDENT_PROGRESS_AND_STATS_CONTRACT.md` lines 222-243
   - **Firebase Path:** `users/{uid}/history/quizzes/{quizId}`, `users/{uid}/history/simulations/{simId}`

### 1.3 Tools Gallery

- **Tools** (`lessons/{slot}/tools/{toolId}`)
  - Tools used in each lesson (stethoscope, thermometer, etc.)
  - **File Reference:** `public/student-lessons.html` lines 410-455, `ADMIN_TO_STUDENT_MAPPING_SUMMARY.md` lines 176-186
  - **Firebase Path:** Stored within `lessons/{slot}/tools` object

---

## 2) DATA MODELS

### 2.1 LMS Lessons (Web)

#### 2.1.1 Lesson Metadata Collection

**Firebase Path:** `lessons/{slot}`

**Fields:**
- `slot` (number, 1-6) – Lesson slot number (immutable)
- `lessonTitle` (string) – Display title
- `lessonName` (string) – Backward compatibility alias for `lessonTitle`
- `description` (string) – Short summary (1-3 sentences)
- `lessonDescription` (string) – Backward compatibility alias for `description`
- `body` (HTML string) – Rich text lesson content
- `status` (string: 'draft' | 'published') – **CRITICAL:** Only 'published' lessons visible to students
- `introVideoUrl` (string) – Public URL to intro video
- `introVideoStoragePath` (string) – Storage bucket path
- `tools` (object) – Tools map: `{ toolId: { name, description, category, imageUrl, modelUrl, instructions } }`
- `images` (array) – Legacy field (deprecated)
- `questions` (object) – Unity game questions (legacy, use `lessons/lesson{slot}/questions`)
- `createdAt` (ISO timestamp)
- `updatedAt` (ISO timestamp)

**Code References:**
- Admin GET: `routes/admin.js` lines 1459-1513
- Student GET: `routes/user.js` lines 397-429
- Admin PUT: `routes/admin.js` lines 1514-1596

#### 2.1.2 LMS Lesson Pages Collection

**Firebase Path:** `lmsLessons/{slot}/pages/{pageId}`

**Fields:**
- `id` (string) – Page ID (auto-generated)
- `title` (string) – Page title
- `content` (string) – Page content (HTML)
- `order` (number) – Display order (0-based, determines sequence)
- `createdAt` (ISO timestamp)
- `updatedAt` (ISO timestamp)

**Code References:**
- Student GET: `routes/student.js` lines 626-662
- Admin routes: `routes/admin.js` (page management endpoints)

#### 2.1.3 Page Assessments Collection

**Firebase Path:** `lmsLessons/{slot}/pages/{pageId}/assessments/{assessmentId}`

**Fields:**
- `id` (string) – Assessment ID (auto-generated)
- `question` (string) – Question text
- `answerA` (string) – Option A
- `answerB` (string) – Option B
- `answerC` (string) – Option C
- `answerD` (string) – Option D
- `correctAnswer` (string: 'A' | 'B' | 'C' | 'D') – Correct answer (NOT sent to students)
- `explanation` (string) – Explanation shown after submission
- `createdAt` (ISO timestamp)
- `updatedAt` (ISO timestamp)

**Code References:**
- Student GET: `routes/student.js` lines 665-695 (returns WITHOUT correctAnswer)
- Student POST: `routes/student.js` lines 698-828 (submits answers, checks correctness)

#### 2.1.4 How Pages and Assessments Are Stored

**Structure:**
```
lmsLessons/
  {slot}/
    pages/
      {pageId1}/
        title: "Page 1 Title"
        content: "<HTML>"
        order: 0
        assessments/
          {assessmentId1}/
            question: "..."
            answerA: "..."
            answerB: "..."
            answerC: "..."
            answerD: "..."
            correctAnswer: "A"
            explanation: "..."
      {pageId2}/
        title: "Page 2 Title"
        content: "<HTML>"
        order: 1
        assessments/
          {assessmentId2}/
            ...
```

**Key Rules:**
- Pages are sorted by `order` field (0, 1, 2, ...)
- Each page can have multiple assessments
- Students must complete ALL assessments on a page correctly (70% passing threshold) to unlock the next page
- Progress is tracked in `users/{uid}/lmsProgress/lesson{slot}/completedPages/{pageId} = true`

### 2.2 Game Lessons / Simulations (Unity)

#### 2.2.1 Game Progress Collection

**Firebase Path:** `users/{uid}/progress/lesson{slot}` OR `students/{uid}/progress/lesson{slot}` (legacy)

**Fields:**
- `quiz` (object):
  - `completed` (boolean) – Whether quiz is completed
  - `highestScore` (number, 0-10) – Best score achieved
  - `attempts` (number) – Number of attempts
  - `lastAttempt` (ISO timestamp)
- `simulation` (object):
  - `completed` (boolean) – Whether simulation is completed
  - `passed` (boolean) – Whether simulation was passed (BOTH required for eligibility)
  - `score` (number) – Simulation score
  - `attempts` (number) – Number of attempts
  - `lastAttempt` (ISO timestamp)

**Code References:**
- Student Dashboard: `routes/student.js` lines 282-311
- Admin Dashboard: Uses same structure for game metrics

#### 2.2.2 Game Quiz Questions Collection

**Firebase Path:** `lessons/lesson{slot}/questions/{questionIndex}`

**Fields:**
- `questionText` (string, max 90 chars) – Question text
- `choices` (array[4]) – Answer choices
- `correctIndex` (number, 0-3) – Correct answer index
- `explanation` (string) – Explanation
- `updatedAt` (ISO timestamp)

**Note:** This is separate from LMS assessments. Unity game uses these questions.

#### 2.2.3 Mapping to LMS Lessons

**Mapping Logic:**
- Game lesson slot corresponds to LMS lesson slot (1-6)
- Game progress for `lesson1` maps to LMS lesson slot `1`
- Both use the same slot numbering system
- **CRITICAL SEPARATION:** LMS progress is in `lmsProgress/`, Game progress is in `progress/`

**Code References:**
- Dashboard combines both: `routes/student.js` lines 198-311
- Game lessons array: `routes/student.js` lines 282-311

---

## 3) STUDENT PAGES FOR LESSONS

### 3.1 Lessons List Page(s)

#### 3.1.1 Route

**File:** `public/student-lessons.html`  
**Route:** `/student-lessons` (served as static HTML)  
**JavaScript:** Inline script in `public/student-lessons.html` lines 223-939

#### 3.1.2 What It Shows

**Current Implementation:**
1. **Left Panel:** Lesson list with progress indicators
   - Lesson cards showing:
     - Lesson title (`lessonName` or `lessonTitle`)
     - Description (`lessonDescription` or `description`)
     - Status badge: "Not Started", "In Progress", "Completed"
     - Progress bar (percentage)
   - Progress indicator: "X of 6 completed"

2. **Right Panel:** Lesson viewer (empty state or lesson detail)
   - Empty state when no lesson selected
   - Lesson detail when lesson is selected

**Code References:**
- `public/student-lessons.html` lines 297-344 (`renderLessonsList()`)
- `public/student-lessons.html` lines 371-498 (`loadLesson()`)

#### 3.1.3 How It Decides What Lessons to Show

**Current Logic:**
1. **Fetches from:** `/api/user/lessons` (route: `routes/user.js` lines 397-429)
2. **Filters:** 
   - Only numeric slot keys (1-6)
   - Lessons that have `lessonTitle` or `lessonName`
   - **MISSING:** Does NOT filter by `status === 'published'` ❌
3. **Sorts:** By slot number (ascending)
4. **Progress:** Fetches from `/api/user/dashboard` (legacy route, may not exist)

**Code References:**
- `public/student-lessons.html` lines 235-295 (`loadLessons()`)
- `routes/user.js` lines 397-429 (GET `/api/user/lessons`)

**Issues:**
- ❌ Does not filter by `status === 'published'` (should only show published lessons)
- ❌ Uses legacy `/api/user/dashboard` route instead of `/api/student/dashboard`
- ❌ Does not use the new dashboard API that properly filters by status

### 3.2 Lesson Detail Page(s)

#### 3.2.1 Route

**File:** `public/student-lessons.html` (same file, different view)  
**Route:** `/student-lessons?lesson={slot}` (URL parameter)  
**JavaScript:** Inline script in `public/student-lessons.html`

#### 3.2.2 Sections

**Current Implementation:**

1. **Breadcrumb Navigation**
   - Dashboard → Lessons → [Lesson Name]
   - Code: `public/student-lessons.html` lines 75-81

2. **Lesson Header**
   - Title: `lesson.lessonName` or `lesson.lessonTitle`
   - Description: `lesson.lessonDescription` or `description`
   - Code: `public/student-lessons.html` lines 84-87, 393-395

3. **Tabs:**
   - **Content Tab:** Shows lesson body (`lesson.body`), supporting images, and tools section
   - **Tools Tab:** Shows tools grid with 3D model viewers
   - Code: `public/student-lessons.html` lines 89-136, 707-736

4. **Content Tab Details:**
   - Lesson body (HTML content)
   - Supporting images (if `lesson.images` exists)
   - Tools section (embedded in content tab)
   - Code: `public/student-lessons.html` lines 398-473

5. **Tools Tab:**
   - Grid of tool cards
   - Each tool shows: name, description, image, 3D model preview (if GLB/GLTF)
   - Click to open tool modal with full details
   - Code: `public/student-lessons.html` lines 646-705, 738-811

6. **Mark as Completed Button**
   - Currently only updates local state (TODO: Update Firebase)
   - Code: `public/student-lessons.html` lines 830-857

#### 3.2.3 Navigation/Progress Behavior

**Current Implementation:**
- **NO PAGE NAVIGATION:** The current implementation does NOT show individual pages or assessments
- **NO PROGRESS TRACKING:** Does not use `/api/student/lessons/:slot/pages` route
- **NO ASSESSMENT INTEGRATION:** Does not show or submit assessments

**Missing Features:**
- ❌ Does not fetch or display pages from `lmsLessons/{slot}/pages`
- ❌ Does not show page-by-page navigation
- ❌ Does not integrate assessments
- ❌ Does not track page completion
- ❌ Does not unlock pages based on previous page completion

**What Should Be There (Based on Admin Design):**
1. **Page List/Sidebar:** Show all pages in order
2. **Current Page View:** Display current page content
3. **Assessment Section:** Show assessments for current page
4. **Next/Previous Navigation:** Navigate between pages (locked if previous not completed)
5. **Progress Bar:** Show "X of Y pages completed"
6. **Page Completion:** Mark page complete when assessment passed (70% threshold)

**Code References:**
- Available API: `routes/student.js` lines 626-828 (GET pages, GET assessments, POST submit)
- **NOT USED:** Student lessons page does not call these APIs

---

## 4) PROGRESS LOGIC

### 4.1 Exactly How LMS Tracks Progress Per Lesson

#### 4.1.1 Progress Path

**Primary Path:** `users/{uid}/lmsProgress/lesson{slot}`  
**Legacy Path:** `students/{uid}/lmsProgress/lesson{slot}` (fallback)

**Code References:**
- Dashboard: `routes/student.js` lines 173-186
- Pages API: `routes/student.js` lines 638-644
- Assessment Submit: `routes/student.js` lines 744-755

#### 4.1.2 Progress Fields

**Structure:**
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
    "attempts": 1,
    "lastAttempt": "2025-11-30T12:00:00.000Z"
  },
  "lastAssessment": "2025-11-30T12:00:00.000Z"  // Optional
}
```

**Code References:**
- Structure definition: `STUDENT_PROGRESS_AND_STATS_CONTRACT.md` lines 104-125
- Dashboard reading: `routes/student.js` lines 213-224

#### 4.1.3 Progress Rules

**Page Completion:**
- Page is marked complete when: Assessment is submitted with >= 70% score
- Path written: `users/{uid}/lmsProgress/lesson{slot}/completedPages/{pageId} = true`
- Code: `routes/student.js` lines 743-749

**Lesson Status Calculation:**
- Uses `computeLmsLessonStatus()` function: `routes/student.js` lines 61-77
- **Status Logic:**
  - `completed`: Has pages AND quiz completed AND quiz score >= 7 AND simulation completed AND simulation passed
  - `in_progress`: Has any progress (pages, quiz, simulation) but not all criteria met
  - `not_started`: No progress at all

**Code References:**
- Status computation: `routes/student.js` lines 230-235
- Helper functions: `routes/student.js` lines 26-77

### 4.2 How Student UI Uses That Data Today

#### 4.2.1 Dashboard

**Current Usage:**
- Reads from `users/{uid}/lmsProgress/lesson{slot}` ✅
- Computes lesson status using `computeLmsLessonStatus()` ✅
- Shows progress percentage: `completedPagesCount / totalPages` ✅
- Filters by `status === 'published'` ✅

**Code References:**
- `routes/student.js` lines 198-267 (builds LMS lessons array)
- `public/js/student-dashboard.js` (renders dashboard)

#### 4.2.2 Lessons List Page

**Current Usage:**
- ❌ Does NOT use `/api/student/dashboard` (uses legacy `/api/user/dashboard`)
- ❌ Does NOT filter by `status === 'published'`
- ❌ Progress data may be incomplete or incorrect

**Code References:**
- `public/student-lessons.html` lines 266-280 (fetches from wrong route)

#### 4.2.3 Lesson Detail Page

**Current Usage:**
- ❌ Does NOT fetch pages from `/api/student/lessons/:slot/pages`
- ❌ Does NOT show page-by-page progress
- ❌ Does NOT integrate assessments
- ❌ "Mark as Completed" button only updates local state (does not write to Firebase)

**Code References:**
- `public/student-lessons.html` lines 371-498 (loadLesson function)

### 4.3 Logic That Still Talks About "Quiz" When It Should Be "Assessment"

**Issues Found:**

1. **Dashboard API Response:**
   - `routes/student.js` line 221: `normalizeQuiz(lessonProgress.quiz || {})`
   - **Problem:** LMS progress should NOT have quiz data (quizzes are game-only)
   - **Should be:** Assessment completion tracking instead

2. **Status Computation:**
   - `routes/student.js` lines 61-77: `computeLmsLessonStatus()` checks for `quiz.completed` and `quiz.highestScore >= 7`
   - **Problem:** LMS lessons don't have quizzes, they have assessments
   - **Should be:** Check assessment completion per page instead

3. **Dashboard Totals:**
   - `routes/student.js` lines 193-196: Tracks `totalQuizScore`, `quizScoreCount`, `totalQuizAttempts`
   - **Problem:** These are LMS totals but use "quiz" terminology
   - **Should be:** Assessment-related metrics

**Code References:**
- `routes/student.js` lines 193-196, 221, 241-245, 269-270

---

## 5) ADMIN ↔ STUDENT MISMATCHES

### 5.1 Status Filtering

**Admin Controls:**
- `lessons/{slot}/status` field: 'draft' | 'published'
- Admin can set lesson to 'draft' to hide from students

**Student Page Behavior:**
- ✅ Dashboard API (`/api/student/dashboard`) filters by `status === 'published'` (line 203-208)
- ❌ Lessons List Page (`/student-lessons`) does NOT filter by status
- ❌ Uses `/api/user/lessons` which does not filter by status

**Code References:**
- Admin: `routes/admin.js` lines 1487-1503 (includes status in response)
- Student Dashboard: `routes/student.js` lines 203-208 (filters published)
- Student Lessons: `routes/user.js` lines 397-429 (no status filter)

### 5.2 Page and Assessment System

**Admin Controls:**
- Creates pages in `lmsLessons/{slot}/pages/{pageId}`
- Creates assessments in `lmsLessons/{slot}/pages/{pageId}/assessments/{assessmentId}`
- Sets page `order` to control sequence
- Sets assessment `correctAnswer` and `explanation`

**Student Page Behavior:**
- ❌ Does NOT display pages at all
- ❌ Does NOT show assessments
- ❌ Does NOT use page navigation
- ❌ Does NOT track page completion
- ❌ Shows only lesson body (`lesson.body`) and tools

**Code References:**
- Admin: `public/js/admin-lesson-editor.js` (page/assessment management)
- Student: `public/student-lessons.html` (no page integration)

### 5.3 Progress Tracking

**Admin Expects:**
- Students complete pages in order
- Students pass assessments (70% threshold) to unlock next page
- Progress tracked in `users/{uid}/lmsProgress/lesson{slot}/completedPages/{pageId} = true`

**Student Page Behavior:**
- ❌ Does NOT track page completion
- ❌ "Mark as Completed" button does not write to Firebase
- ❌ Does NOT use assessment submission API

**Code References:**
- Admin expectation: `ADMIN_TO_STUDENT_MAPPING_SUMMARY.md` lines 153-156
- Student implementation: `public/student-lessons.html` lines 830-857 (TODO comment)

### 5.4 Intro Video

**Admin Controls:**
- `lessons/{slot}/introVideoUrl` – Public URL to intro video
- Admin can upload and set intro video

**Student Page Behavior:**
- ❌ Does NOT display intro video
- ❌ Does NOT check for `introVideoUrl` field

**Code References:**
- Admin: `routes/admin.js` (intro video upload route)
- Student: `public/student-lessons.html` (no intro video display)

### 5.5 Lesson Status Calculation

**Admin Certificate Eligibility Rules:**
- For each lesson (1-6), ALL must be true:
  1. Pages: At least one page completed
  2. Quiz: `quiz.completed === true` AND `quiz.highestScore >= 7` (70% passing)
  3. Simulation: `simulation.completed === true` AND `simulation.passed === true`

**Student Dashboard Status Logic:**
- Uses same logic: `routes/student.js` lines 61-77 (`computeLmsLessonStatus()`)
- ✅ Matches admin expectations

**Issue:**
- **Terminology Mismatch:** Admin/Student code uses "quiz" but LMS should use "assessment"
- **Data Mismatch:** LMS progress should track assessments per page, not a single quiz

**Code References:**
- Admin: `public/js/admin-game-certificates.js` lines 74-88
- Student: `routes/student.js` lines 61-77

### 5.6 Tools Display

**Admin Controls:**
- `lessons/{slot}/tools/{toolId}` with fields: name, description, category, imageUrl, modelUrl, instructions
- Admin can add/remove tools per lesson

**Student Page Behavior:**
- ✅ Displays tools in Tools tab
- ✅ Shows tool details in modal
- ✅ Supports 3D model viewer (GLB/GLTF)
- ✅ Shows download link for FBX/OBJ

**Status:** ✅ Working correctly

**Code References:**
- Student: `public/student-lessons.html` lines 646-811

---

## 6) SUGGESTIONS FOR REBUILDING THE STUDENT LESSONS PAGE

### 6.1 High-Level Recommendations

#### 6.1.1 Data/Fields That Should Drive the New Lessons Page

**Primary Data Sources:**
1. **Lesson List:**
   - Read from `/api/student/dashboard` (NOT `/api/user/lessons`)
   - Filter by `status === 'published'` (already done in dashboard API)
   - Use `lms.lessons` array from dashboard response

2. **Lesson Detail:**
   - Read lesson metadata from `lessons/{slot}`
   - Read pages from `/api/student/lessons/:slot/pages`
   - Read assessments from `/api/student/lessons/:slot/pages/:pageId/assessments`
   - Read progress from `users/{uid}/lmsProgress/lesson{slot}`

3. **Progress Tracking:**
   - Use `completedPages` object to determine unlocked pages
   - Calculate progress: `Object.keys(completedPages).length / totalPages`
   - Use page `order` field to determine sequence

**Code References:**
- Dashboard API: `routes/student.js` lines 118-376
- Pages API: `routes/student.js` lines 626-662
- Assessments API: `routes/student.js` lines 665-828

#### 6.1.2 How to Handle LMS vs Game Info for Each Lesson

**Recommended Approach:**

1. **LMS-First Design:**
   - Primary focus on LMS lessons (pages, assessments)
   - Show LMS progress prominently
   - Game status as secondary indicator

2. **Game Status Integration:**
   - Fetch game progress from `users/{uid}/progress/lesson{slot}`
   - Show game simulation status as a badge/tag: "Game sim: Passed/Not started/In progress"
   - Do NOT mix LMS and Game progress in calculations

3. **Separate Sections:**
   - LMS Progress: Pages completed, assessments passed
   - Game Progress: Quiz score, simulation status (if available)
   - Overall Status: Combine both for "completed" determination (if needed)

**Code References:**
- Dashboard already separates: `routes/student.js` lines 188-340
- Game lessons array: `routes/student.js` lines 282-311

#### 6.1.3 Cleanup Recommendations

1. **Remove Quiz Terminology from LMS:**
   - Replace "quiz" with "assessment" in LMS context
   - Update `computeLmsLessonStatus()` to check assessments per page, not a single quiz
   - Remove `quiz` field from LMS progress structure (if it exists)

2. **Unify Lesson Models:**
   - Use consistent field names: `lessonTitle` (not `lessonName`), `description` (not `lessonDescription`)
   - Keep backward compatibility but prefer new names

3. **Fix Status Filtering:**
   - Update `/api/user/lessons` to filter by `status === 'published'`
   - OR: Remove `/api/user/lessons` and use `/api/student/dashboard` for lesson list

4. **Implement Page Navigation:**
   - Add page list/sidebar to lesson detail page
   - Show current page content
   - Integrate assessments per page
   - Implement Next/Previous navigation with unlock logic

5. **Fix Progress Tracking:**
   - Remove "Mark as Completed" button (or make it write to Firebase)
   - Use assessment submission to track page completion
   - Show progress bar: "X of Y pages completed"

6. **Add Intro Video:**
   - Check for `introVideoUrl` in lesson metadata
   - Display video at top of lesson detail page

**Code References:**
- Status filtering: `routes/student.js` lines 203-208 (correct), `routes/user.js` lines 397-429 (missing)
- Page API: `routes/student.js` lines 626-662 (available but not used)
- Assessment API: `routes/student.js` lines 665-828 (available but not used)

### 6.2 Specific Implementation Suggestions

#### 6.2.1 Lessons List Page Redesign

**Layout:**
- Keep left panel with lesson list
- Show: Title, description, status badge, progress bar, game sim status (optional)
- Filter by status (only show published)
- Sort by slot number

**Data Flow:**
1. Fetch from `/api/student/dashboard`
2. Use `lms.lessons` array
3. For each lesson, show:
   - `title` (from `lms.lessons[].title`)
   - `status` (from `lms.lessons[].status`)
   - `pageProgressPercent` (from `lms.lessons[].pageProgressPercent`)
   - Game sim status (from `game.lessons[]` if available)

#### 6.2.2 Lesson Detail Page Redesign

**Layout:**
- **Header:** Title, description, intro video (if exists)
- **Left Sidebar:** Page list with completion indicators
- **Main Content:** Current page content + assessments
- **Right Sidebar (optional):** Tools gallery
- **Bottom:** Next/Previous navigation, progress bar

**Data Flow:**
1. Fetch lesson metadata from `lessons/{slot}`
2. Fetch pages from `/api/student/lessons/:slot/pages`
3. For current page, fetch assessments from `/api/student/lessons/:slot/pages/:pageId/assessments`
4. Check progress to determine unlocked pages
5. Show page content and assessments
6. On assessment submit, call `/api/student/lessons/:slot/pages/:pageId/assessments/submit`
7. If passed (>= 70%), mark page complete and unlock next page

#### 6.2.3 Progress Calculation Fix

**Current Issue:**
- `computeLmsLessonStatus()` checks for `quiz.completed` and `quiz.highestScore >= 7`
- LMS should check: All pages completed AND all assessments passed

**Recommended Fix:**
```javascript
function computeLmsLessonStatus({ totalPages, completedPagesCount, assessmentsPassed }) {
  const allPagesCompleted = completedPagesCount === totalPages && totalPages > 0;
  const allAssessmentsPassed = assessmentsPassed === true; // Track per page
  
  if (allPagesCompleted && allAssessmentsPassed) {
    return 'completed';
  }
  
  if (completedPagesCount > 0 || assessmentsPassed) {
    return 'in_progress';
  }
  
  return 'not_started';
}
```

**Code References:**
- Current implementation: `routes/student.js` lines 61-77
- Should be updated to use page/assessment logic

---

## 7) SUMMARY OF KEY FINDINGS

### 7.1 What Works Well

1. ✅ Dashboard API properly filters by `status === 'published'`
2. ✅ Dashboard API separates LMS and Game progress correctly
3. ✅ Tools display works correctly
4. ✅ Assessment submission API exists and works
5. ✅ Page API exists and returns proper data structure

### 7.2 What Needs Fixing

1. ❌ Lessons List Page does not filter by status
2. ❌ Lessons List Page uses wrong API route
3. ❌ Lesson Detail Page does not show pages
4. ❌ Lesson Detail Page does not show assessments
5. ❌ Lesson Detail Page does not track page completion
6. ❌ Status calculation uses "quiz" terminology (should be "assessment")
7. ❌ Intro video not displayed
8. ❌ "Mark as Completed" button does not write to Firebase

### 7.3 Critical Mismatches

1. **Admin creates pages/assessments, but student page ignores them**
2. **Admin sets status to 'draft', but student lessons page shows it anyway**
3. **Admin expects page-by-page progress, but student page doesn't track it**
4. **Admin expects assessment completion, but student page doesn't integrate assessments**

---

**END OF ANALYSIS**






