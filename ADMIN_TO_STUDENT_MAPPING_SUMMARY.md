# CareSim Web LMS – Admin → Student Mapping Summary

**Generated:** 2025-01-XX  
**Purpose:** Complete analysis of ADMIN side features and configurations to guide STUDENT side rebuild  
**Status:** READ-ONLY ANALYSIS - NO CODE MODIFICATIONS

---

## 1. HIGH-LEVEL OVERVIEW

### 1.1 Technology Stack
- **Backend:** Node.js/Express with Firebase Realtime Database
- **Frontend:** Static HTML pages with vanilla JavaScript
- **Authentication:** Firebase Auth with JWT tokens
- **Storage:** Firebase Storage for videos, images, 3D models
- **Database:** Firebase Realtime Database (not Firestore)

### 1.2 Admin Portal Organization
The admin portal consists of 5 main pages:
1. **Dashboard** (`/admin-dashboard`) - Overview statistics and system status
2. **Lessons** (`/admin-lessons`) - LMS lesson management
3. **Quizzes** (`/admin-quizzes`) - Unity game quiz management (6 lessons)
4. **Users** (`/admin-users`) - User management (students, instructors, admins)
5. **Certificates** (`/admin-game-certificates`) - Certificate issuance and notifications

### 1.3 Key Architectural Principle
**CRITICAL SEPARATION:** LMS (web-based) and Game (Unity-based) progress are stored in separate Firebase paths:
- **LMS Progress:** `users/{uid}/lmsProgress/lesson{slot}` (web lessons, pages, assessments)
- **Game Progress:** `users/{uid}/progress/lesson{slot}` (Unity game quizzes, simulations)
- **Legacy Path:** `students/{uid}/lessonProgress/{i}` (old format, may contain either)

---

## 2. ADMIN FEATURES (DETAILED)

### 2.1 Admin Dashboard & Overview

#### Route(s):
- `/admin-dashboard` (HTML page)
- `/api/admin/dashboard/summary` (GET - statistics)
- `/api/admin/dashboard/activity` (GET - recent activity)
- `/api/admin/dashboard/recent-users` (GET - recent users)
- `/api/admin/health` (GET - system status)

#### Key Components:
- `public/admin-dashboard.html` - Main dashboard page
- `public/js/admin-dashboard.js` - Dashboard logic and API calls

#### Metrics Shown:

**1. Total Users**
- **Data Source:** `users/` collection (all users)
- **Calculation:** Count of all user records
- **Student Impact:** Students should see total enrolled students (if applicable) or their own progress relative to peers

**2. Total Lessons (LMS)**
- **Data Source:** `lmsLessons/` collection
- **Calculation:** Count of lesson slots (1-6)
- **Student Impact:** Students should see all 6 lessons available, filtered by `status: 'published'`

**3. Total Assessments (LMS)**
- **Data Source:** `lmsLessons/{slot}/pages/{pageId}/assessments`
- **Calculation:** Sum of all assessments across all pages in all lessons
- **Student Impact:** Students see assessments per page; must complete assessments to unlock next page

**4. Active Users**
- **Data Source:** `users/{uid}/lastActiveAt`
- **Calculation:** Users with `lastActiveAt` within last 10 minutes
- **Student Impact:** Students can see their own last activity timestamp

**5. Average Completion (LMS)**
- **Data Source:** `users/{uid}/lmsProgress/lesson{slot}/completedPages`
- **Calculation:** Average percentage of pages completed across all students
- **Student Impact:** Students should see their own completion percentage per lesson

**6. Average Quiz Score (Game)**
- **Data Source:** `users/{uid}/progress/lesson{slot}/quiz/highestScore`
- **Calculation:** Average of highest quiz scores (out of 10) across all Unity game users
- **Student Impact:** Students should see their own quiz scores per lesson (if they use Unity game)

**7. Total Quiz Attempts**
- **Data Source:** `users/{uid}/progress/lesson{slot}/quiz/attempts` (Game) + `users/{uid}/lmsProgress/lesson{slot}/quiz/attempts` (LMS)
- **Student Impact:** Students should see their own attempt counts

**8. Lessons Completed**
- **Data Source:** `users/{uid}/lmsProgress` (count lessons with all criteria met)
- **Student Impact:** Students should see count of completed lessons (1-6)

**9. Total Logins**
- **Data Source:** `users/{uid}/loginCount`
- **Student Impact:** Students can see their own login count

**10. New Users This Week**
- **Data Source:** `users/{uid}/createdAt`
- **Student Impact:** Not directly relevant to students

#### Dashboard Widgets:
- **Recent Activity:** Shows activity log entries (lesson updates, user actions, etc.)
- **Quick Actions:** Links to create lesson, manage assessments, add user, backup/restore
- **Recent Users:** Table of recently active users
- **System Status:** Database, API, Storage, Backup status
- **Performance Metrics:** Total logins, quiz attempts, lessons completed, active sessions (with time filters)

---

### 2.2 Lessons & Modules Management (Admin)

#### Route(s):
- `/admin-lessons` (HTML page - lesson list)
- `/admin-lesson-editor` (HTML page - lesson editor)
- `/api/admin/lessons` (GET - list all lessons)
- `/api/admin/lessons/:slot` (PUT - update lesson)
- `/api/admin/lessons/:slot/pages` (GET, POST - manage pages)
- `/api/admin/lessons/:slot/pages/:pageId` (GET, PUT, DELETE - page operations)
- `/api/admin/lessons/:slot/pages/:pageId/assessments` (GET, POST - assessments)
- `/api/admin/lessons/:slot/pages/:pageId/assessments/:assessmentId` (PUT, DELETE - assessment operations)
- `/api/admin/lessons/upload-intro` (POST - upload intro video)

#### Key Components:
- `public/admin-lessons.html` - Lesson list page
- `public/admin-lesson-editor.html` - Lesson editor page
- `public/js/admin-lessons.js` - Lesson list logic
- `public/js/admin-lesson-editor.js` - Lesson editor logic

#### DATA FIELDS ADMIN CONTROLS:

**Lesson Basic Information:**
- **`slot`** (number, 1-6) – Lesson slot number (immutable after creation)
- **`lessonTitle`** (string) – Display title for the lesson
- **`lessonName`** (string) – Backward compatibility alias for `lessonTitle`
- **`description`** (string) – Short summary (1-3 sentences)
- **`lessonDescription`** (string) – Backward compatibility alias for `description`
- **`body`** (HTML string) – Rich text lesson content (formatted HTML)
- **`status`** (string: 'draft' | 'published') – Visibility status
  - **Student Impact:** Only lessons with `status: 'published'` should be visible to students
- **`createdAt`** (ISO timestamp) – Creation date
- **`updatedAt`** (ISO timestamp) – Last update date

**Lesson Intro Video:**
- **`introVideoUrl`** (string) – Public URL to intro video
- **`introVideoStoragePath`** (string) – Storage bucket path
- **Student Impact:** Students should see intro video at top of lesson page

**Lesson Pages:**
- **Path:** `lmsLessons/{slot}/pages/{pageId}`
- **Fields:**
  - **`id`** (string) – Page ID (auto-generated)
  - **`title`** (string) – Page title
  - **`content`** (string) – Page content (HTML)
  - **`order`** (number) – Display order
  - **`createdAt`** (ISO timestamp)
  - **`updatedAt`** (ISO timestamp)
- **Student Impact:** 
  - Students see pages in `order` sequence
  - Must complete assessment on current page to unlock next page
  - Progress tracked in `users/{uid}/lmsProgress/lesson{slot}/completedPages/{pageId} = true`

**Page Assessments:**
- **Path:** `lmsLessons/{slot}/pages/{pageId}/assessments/{assessmentId}`
- **Fields:**
  - **`id`** (string) – Assessment ID (auto-generated)
  - **`question`** (string) – Question text
  - **`answerA`** (string) – Option A
  - **`answerB`** (string) – Option B
  - **`answerC`** (string) – Option C
  - **`answerD`** (string) – Option D
  - **`correctAnswer`** (string: 'A' | 'B' | 'C' | 'D') – Correct answer
  - **`explanation`** (string) – Explanation shown after submission
  - **`createdAt`** (ISO timestamp)
  - **`updatedAt`** (ISO timestamp)
- **Student Impact:**
  - Students must answer assessment correctly to mark page as complete
  - After submission, show explanation if provided
  - Correct answer unlocks next page

**Tools Used in Lesson:**
- **Path:** `lessons/{slot}/tools/{toolId}` (stored in lesson data)
- **Fields:**
  - **`name`** (string) – Tool name (e.g., "Stethoscope")
  - **`description`** (string) – Tool description
  - **`category`** (string: 'diagnostic' | 'monitoring' | 'treatment' | 'safety' | 'other')
  - **`imageUrl`** (string) – Thumbnail image URL
  - **`modelUrl`** (string) – 3D model URL (GLB/GLTF for web preview, FBX/OBJ for download)
  - **`storagePath`** (string) – Storage bucket path
  - **`instructions`** (string) – How to use the tool (numbered list)
- **Student Impact:** Students should see tools used in lesson, with 3D model viewer for GLB/GLTF

#### EFFECT ON STUDENT SIDE:

**Student Lesson List Page:**
- Show all lessons where `status === 'published'`
- Display: title, description, completion status, progress percentage
- Sort by slot number (1-6)
- Filter by status (not started, in progress, completed)

**Student Lesson Detail Page:**
- Show intro video (if `introVideoUrl` exists)
- Show lesson body (formatted HTML)
- Show pages in `order` sequence
- Show tools used (with 3D model viewer)
- Track page completion: `users/{uid}/lmsProgress/lesson{slot}/completedPages/{pageId} = true`
- Lock pages until previous page's assessment is passed

**Student Assessment Submission:**
- Validate answer against `correctAnswer`
- If correct: mark page complete, unlock next page
- Show `explanation` after submission
- Write to: `users/{uid}/lmsProgress/lesson{slot}/completedPages/{pageId} = true`

---

### 2.3 Activities, Quizzes, and Assessments (Admin)

#### Route(s):
- `/admin-quizzes` (HTML page - Unity game quizzes)
- `/api/admin/quizzes` (GET - get all Unity game quizzes)
- `/api/admin/game-quizzes/:slot` (PUT - update Unity game quiz question)
- `/api/admin/game-quizzes/:slot/:questionIndex` (DELETE - delete question)

**Note:** LMS assessments are managed in lesson editor (see 2.2). Unity game quizzes are separate.

#### Key Components:
- `public/admin-quizzes.html` - Quiz management page
- `public/js/admin-quizzes.js` - Quiz management logic

#### Unity Game Quizzes (Separate from LMS Assessments):

**Data Structure:**
- **Path:** `lessons/lesson{slot}/questions/{questionIndex}`
- **Fields:**
  - **`questionText`** (string, max 90 chars) – Question text
  - **`choices`** (array[4]) – Answer choices [A, B, C, D] (max 30 chars each)
  - **`correctIndex`** (number: 0-3) – Index of correct answer (0=A, 1=B, 2=C, 3=D)
  - **`explanation`** (string) – Explanation text
  - **`updatedAt`** (ISO timestamp)

**Admin Configuration:**
- Exactly 6 lessons (slots 1-6)
- Each lesson can have multiple questions (indexed 0, 1, 2, ...)
- Questions are managed per lesson slot

**Student Impact:**
- Unity game uses these quizzes (not web LMS)
- Students playing Unity game see these questions
- Progress tracked in `users/{uid}/progress/lesson{slot}/quiz` (NOT `lmsProgress`)

#### LMS Assessments (Per Page):

**Data Structure:**
- **Path:** `lmsLessons/{slot}/pages/{pageId}/assessments/{assessmentId}`
- **Fields:** (see 2.2 - Page Assessments)

**Student Impact:**
- Web LMS students see assessments on lesson pages
- Must pass assessment to unlock next page
- Progress tracked in `users/{uid}/lmsProgress/lesson{slot}/completedPages/{pageId}`

---

### 2.4 Game / Unity Integration Controls (Admin)

#### Route(s):
- `/admin-game-certificates` (HTML page - certificate management)
- `/api/admin/issue-game-certificate` (POST - issue game certificate)
- `/api/admin/certificates/notify-student` (POST - notify LMS student about certificate)

#### Key Components:
- `public/admin-game-certificates.html` - Certificate management page
- `public/js/admin-game-certificates.js` - Certificate logic

#### Game Progress Fields (Unity Writes):

**Path:** `users/{uid}/progress/lesson{slot}`

**Quiz Data:**
- **`quiz.completed`** (boolean) – Quiz completed flag
- **`quiz.highestScore`** (number, 0-10) – Best score achieved
- **`quiz.attempts`** (number) – Number of attempts
- **`quiz.lastAttempt`** (ISO timestamp) – Last attempt timestamp

**Simulation Data:**
- **`simulation.completed`** (boolean) – Simulation completed flag
- **`simulation.passed`** (boolean) – Simulation passed flag (BOTH required for eligibility)
- **`simulation.score`** (number) – Simulation score
- **`simulation.attempts`** (number) – Number of attempts
- **`simulation.lastAttempt`** (ISO timestamp) – Last attempt timestamp

**Game Completion Count:**
- **`users/{uid}/lessonsCompleted`** (number) – Direct count (format 1)
- **`users/{uid}/gameProgress/lessonsCompleted`** (number) – Nested count (format 2)
- **`users/{uid}/progress/gameLessons/{lessonKey}/completed`** (boolean) – Detailed map (format 3)

**Admin Certificate Eligibility Logic (Game):**
```javascript
// For public users (Unity game)
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

**Admin Certificate Eligibility Logic (LMS):**
```javascript
// For students (LMS)
const progress = user.lmsProgress || {};
let allMet = true;

for (let i = 1; i <= 6; i++) {
    const lessonKey = `lesson${i}`;
    const lessonData = progress[lessonKey] || {};
    const completedPages = lessonData.completedPages || {};
    const hasPages = Object.keys(completedPages).length > 0;
    const quiz = lessonData.quiz || {};
    const quizCompleted = quiz.completed === true;
    const quizScoreOk = (quiz.highestScore || 0) >= 7;  // 70% passing
    const sim = lessonData.simulation || {};
    const simOk = sim.completed === true && sim.passed === true;
    
    if (!hasPages || !quizCompleted || !quizScoreOk || !simOk) {
        allMet = false;
        break;
    }
}
// Eligible if allMet === true
```

#### EFFECT ON STUDENT SIDE:

**Student Dashboard (LMS Progress):**
- Read from: `users/{uid}/lmsProgress/lesson{slot}`
- Show per-lesson status:
  - **Completed:** `hasPages && quizCompleted && quizScoreOk && simOk`
  - **In Progress:** Some criteria met but not all
  - **Not Started:** No progress data
- Show page completion: `completedPages` count / total pages
- Show quiz score: `quiz.highestScore` (out of 10, must be >= 7)
- Show simulation status: `simulation.completed && simulation.passed`

**Student Dashboard (Game Progress):**
- Read from: `users/{uid}/progress/lesson{slot}` (if student uses Unity game)
- Show quiz scores, simulation status, attempt counts
- Show completion count: `lessonsCompleted` or `gameProgress/lessonsCompleted`

**Student Certificate Eligibility:**
- **LMS Certificate:** Check all 6 lessons meet eligibility criteria (pages + quiz >=7 + simulation passed)
- **Game Certificate:** Check `lessonsCompleted >= 6` (admin-issued, not student-generated)

---

### 2.5 User / Student / Instructor Management (Admin)

#### Route(s):
- `/admin-users` (HTML page - user management)
- `/api/admin/users` (GET - list all users)
- `/api/admin/create-user` (POST - create new user)
- `/api/admin/users/invite-student` (POST - invite student with email)
- `/api/admin/users/:uid` (PUT - update user)
- `/api/admin/users/:uid/status` (PUT - activate/deactivate)
- `/api/admin/users/:uid/assign-instructor` (PUT - assign instructor to student)
- `/api/admin/users/assign-instructor-batch` (POST - bulk assign instructor)
- `/api/admin/users/:uid/archive` (POST - archive student)
- `/api/admin/users/archive-batch` (POST - bulk archive)
- `/api/admin/instructors` (GET - list instructors)

#### Key Components:
- `public/admin-users.html` - User management page
- `public/js/admin-users.js` - User management logic

#### User Types:

**1. Students:**
- **Role:** `'student'`
- **Fields:**
  - **`uid`** (string) – Firebase Auth UID
  - **`name`** (string) – Full name
  - **`email`** (string) – Email address
  - **`role`** (string: 'student')
  - **`active`** (boolean) – Account active status
  - **`verified`** (boolean) – Email verified
  - **`studentInfo`** (object) – Student-specific info:
    - **`studentNumber`** (string, required) – Student number (numbers only)
    - **`batch`** (string, required) – Batch year (2020-2026)
  - **`assignedInstructor`** (string | null) – Instructor UID
  - **`contactNumber`** (string) – Phone number (+63 format)
  - **`address`** (string) – Address
  - **`birthday`** (ISO date) – Birthday
  - **`lmsProgress`** (object) – LMS progress (see 2.4)
  - **`progress`** (object) – Game progress (see 2.4)
  - **`archived`** (boolean) – Archived status
  - **`inviteStatus`** (string: 'pending' | 'completed') – Invitation status
  - **`inviteCreatedAt`** (ISO timestamp) – Invite creation
  - **`inviteExpiresAt`** (ISO timestamp) – Invite expiration (24 hours)
  - **`lastLogin`** (ISO timestamp) – Last login
  - **`lastActiveAt`** (ISO timestamp) – Last activity
  - **`loginCount`** (number) – Total logins
  - **`createdAt`** (ISO timestamp) – Account creation
  - **`updatedAt`** (ISO timestamp) – Last update

**2. Instructors:**
- **Role:** `'instructor'`
- **Fields:**
  - **`uid`** (string) – Firebase Auth UID
  - **`name`** (string) – Full name
  - **`email`** (string) – Email address
  - **`role`** (string: 'instructor')
  - **`active`** (boolean) – Account active status
  - **`department`** (string) – Department/position
  - **`idNumber`** (string) – ID number
  - **`assignedStudents`** (object) – Map of assigned student UIDs: `{ studentUid: true }`
  - **`lastLogin`** (ISO timestamp)
  - **`createdAt`** (ISO timestamp)

**3. Admins:**
- **Role:** `'admin'`
- **Fields:**
  - **`uid`** (string) – Firebase Auth UID
  - **`name`** (string) – Full name
  - **`email`** (string) – Email address
  - **`role`** (string: 'admin')
  - **`active`** (boolean) – Account active status
  - **`lastLogin`** (ISO timestamp)
  - **`createdAt`** (ISO timestamp)

**4. Public Users:**
- **Role:** `'public'`
- **Fields:**
  - **`uid`** (string) – Firebase Auth UID
  - **`name`** (string) – Full name
  - **`email`** (string) – Email address
  - **`role`** (string: 'public')
  - **`progress`** (object) – Game progress (Unity game only)
  - **`lessonsCompleted`** (number) – Game completion count

#### Admin Actions on Users:

**1. Create User:**
- Can create students, instructors, admins
- For students: requires `studentNumber` and `batch`
- Sets initial `lmsProgress: {}` and `progress: {}`

**2. Invite Student:**
- Sends email with password setup link (expires 24 hours)
- Sets `inviteStatus: 'pending'`
- Student must set password to activate account

**3. Update User:**
- Can update name, email, role, active status
- For students: can update `studentInfo`, `assignedInstructor`, `contactNumber`, `address`, `birthday`

**4. Assign Instructor:**
- Links student to instructor via `assignedInstructor: instructorUid`
- Updates instructor's `assignedStudents` map
- Can unassign by setting `assignedInstructor: null`

**5. Archive Student:**
- Sets `archived: true`
- Moves student to "Archived Students" tab
- Does not delete data

**6. Activate/Deactivate:**
- Sets `active: true/false`
- Deactivated users cannot log in

**7. Reset Password:**
- Generates new password reset link
- Sends email to user

#### EFFECT ON STUDENT SIDE:

**Student Profile Page:**
- Display: name, email, student number, batch, contact number, address, birthday
- Display: assigned instructor name (if `assignedInstructor` exists)
- Display: account status (active/inactive)
- Display: last login, login count

**Student Access Control:**
- Only students with `active: true` can log in
- Students with `archived: true` should be redirected or shown archived message
- Students with `inviteStatus: 'pending'` must complete password setup

**Student Progress Visibility:**
- Students see their own `lmsProgress` and `progress`
- Students do NOT see other students' data
- Students may see instructor name if assigned

---

### 2.6 Enrollment / Sections / Classes (Admin)

**Note:** There is NO explicit sections/classes/enrollments feature in the admin codebase. Students are linked to instructors via `assignedInstructor`, and grouped by `batch` (year).

#### Student Grouping:

**1. By Batch:**
- **Field:** `studentInfo.batch` (string: '2020' | '2021' | '2022' | '2023' | '2024' | '2025' | '2026')
- **Admin Usage:** Filter students by batch in user management
- **Student Impact:** Students can see their batch year in profile

**2. By Instructor:**
- **Field:** `assignedInstructor` (string | null) – Instructor UID
- **Admin Usage:** Assign students to instructors, view instructor's assigned students
- **Student Impact:** Students can see their assigned instructor name

**3. By Archive Status:**
- **Field:** `archived` (boolean)
- **Admin Usage:** Separate archived students from active students
- **Student Impact:** Archived students cannot access system

#### EFFECT ON STUDENT SIDE:

**Student Dashboard:**
- Show batch year (if applicable)
- Show assigned instructor name (if `assignedInstructor` exists)
- No "My Sections" or "My Course" features (not implemented)

**Student Lesson Visibility:**
- All students see the same lessons (filtered by `status: 'published'`)
- No lesson assignment per section/class (all students see all published lessons)

---

### 2.7 Advanced Settings Related to Students

**Note:** There is NO dedicated "Advanced Settings" page in the admin codebase. However, admin can modify student progress via dev tools (super admin only).

#### Dev Tools (Super Admin Only - admin@gmail.com):

**Route(s):**
- `/api/admin/dev/update-demo-progress` (POST - update demo user progress)

**Capabilities:**
- Can set `lmsLessonsCompleted` (1-6) for demo users
- Can set `gameLessonsCompleted` (1-6) for demo users
- Can set quiz scores (LMS and Game)
- Writes to `users/{uid}/lmsProgress/lesson{slot}` and `users/{uid}/progress/lesson{slot}`

**Student Impact:**
- Dev tools are for testing only (super admin)
- Regular students cannot access dev tools
- Students should NOT see any UI related to dev tools

#### Default Attempt Limits:

**Quiz Attempts:**
- **Default:** No explicit limit set in admin code
- **Current Behavior:** Students can retake quizzes (attempts tracked in `quiz.attempts`)
- **Student Impact:** Students should see attempt count, but no hard limit enforced

**Simulation Attempts:**
- **Default:** No explicit limit set in admin code
- **Current Behavior:** Students can retake simulations (attempts tracked in `simulation.attempts`)
- **Student Impact:** Students should see attempt count, but no hard limit enforced

**Assessment Attempts (LMS Pages):**
- **Default:** No explicit limit set in admin code
- **Current Behavior:** Students can retake assessments until they pass
- **Student Impact:** Students should be able to retake assessments until correct answer is selected

#### Override Capabilities:

**Admin CANNOT directly override:**
- Quiz scores (written by quiz system/Unity)
- Simulation results (written by simulation system/Unity)
- Assessment results (written by student submission)

**Admin CAN:**
- Archive students (sets `archived: true`)
- Deactivate students (sets `active: false`)
- Assign/unassign instructors
- Update student info (name, email, batch, etc.)

---

## 3. DATA MODEL SUMMARY

### 3.1 Firebase Collections & Paths

#### 3.1.1 Users Collection

**Path:** `users/{uid}`

**Fields:**
- **`uid`** (string) – Firebase Auth UID
- **`name`** (string) – Full name
- **`email`** (string) – Email address
- **`role`** (string: 'student' | 'instructor' | 'admin' | 'public')
- **`active`** (boolean) – Account active
- **`verified`** (boolean) – Email verified
- **`studentInfo`** (object | null) – Student info (if role='student'):
  - **`studentNumber`** (string) – Student number
  - **`batch`** (string) – Batch year
- **`assignedInstructor`** (string | null) – Instructor UID (students only)
- **`contactNumber`** (string) – Phone number
- **`address`** (string) – Address
- **`birthday`** (ISO date) – Birthday
- **`lmsProgress`** (object) – LMS progress (see 3.1.2)
- **`progress`** (object) – Game progress (see 3.1.3)
- **`certificates`** (object) – Certificates (see 3.1.4)
- **`archived`** (boolean) – Archived status
- **`inviteStatus`** (string) – Invitation status
- **`inviteCreatedAt`** (ISO timestamp)
- **`inviteExpiresAt`** (ISO timestamp)
- **`lastLogin`** (ISO timestamp)
- **`lastActiveAt`** (ISO timestamp)
- **`loginCount`** (number)
- **`createdAt`** (ISO timestamp)
- **`updatedAt`** (ISO timestamp)
- **`certificateNotificationSentAt`** (ISO timestamp) – LMS certificate notification

**Used by:**
- **Admin:** User management, certificate eligibility, dashboard metrics
- **Student:** Profile page, progress tracking, certificate generation

#### 3.1.2 LMS Progress

**Path:** `users/{uid}/lmsProgress/lesson{slot}`

**Fields:**
- **`completedPages`** (object) – Map of completed page IDs: `{ pageId: true }`
- **`quiz`** (object) – Quiz data:
  - **`completed`** (boolean) – Quiz completed
  - **`highestScore`** (number, 0-10) – Best score (must be >= 7 for eligibility)
  - **`attempts`** (number) – Attempt count
  - **`lastAttempt`** (ISO timestamp) – Last attempt
- **`simulation`** (object) – Simulation data:
  - **`completed`** (boolean) – Simulation completed
  - **`passed`** (boolean) – Simulation passed (BOTH required)
  - **`score`** (number) – Simulation score
  - **`attempts`** (number) – Attempt count
  - **`lastAttempt`** (ISO timestamp) – Last attempt
- **`lastAssessment`** (ISO timestamp) – Optional, last assessment submission

**Used by:**
- **Admin:** Certificate eligibility check, dashboard metrics
- **Student:** Dashboard progress, lesson completion status, certificate eligibility

#### 3.1.3 Game Progress

**Path:** `users/{uid}/progress/lesson{slot}`

**Fields:**
- **`quiz`** (object) – Quiz data (same structure as LMS)
- **`simulation`** (object) – Simulation data (same structure as LMS)

**Alternative Paths (for completion count):**
- **`users/{uid}/lessonsCompleted`** (number) – Direct count
- **`users/{uid}/gameProgress/lessonsCompleted`** (number) – Nested count
- **`users/{uid}/progress/gameLessons/{lessonKey}/completed`** (boolean) – Detailed map

**Used by:**
- **Admin:** Game certificate eligibility (public users)
- **Student:** Game progress display (if student uses Unity game)

#### 3.1.4 Certificates

**Path:** `users/{uid}/certificates/{certificateType}`

**LMS Certificate:**
- **Path:** `users/{uid}/certificates/caresim_lms_full`
- **Fields:**
  - **`programId`** (string: 'caresim_lms_full')
  - **`template`** (string: 'student')
  - **`certificateId`** (string: 'LMS-{timestamp}-{random}')
  - **`issuedAt`** (ISO timestamp)
  - **`issuedBy`** (string: 'system')
  - **`studentName`** (string)
  - **`email`** (string)

**Game Certificate:**
- **Path:** `users/{uid}/certificates/game_generic`
- **Fields:**
  - **`certificateId`** (string: 'PUB-{timestamp}-{random}')
  - **`issuedAt`** (number) – Timestamp

**Central Registry:**
- **Path:** `certificates/{certificateId}`
- **Fields:**
  - **`type`** (string: 'lms_full' | 'game_generic')
  - **`userId`** (string) – User UID
  - **`fullName`** (string)
  - **`email`** (string)
  - **`issuedAt`** (number) – Timestamp
  - **`status`** (string: 'valid')

**Used by:**
- **Admin:** Certificate issuance, eligibility checks
- **Student:** Certificate display, verification

#### 3.1.5 Lessons (Unity Game)

**Path:** `lessons/lesson{slot}/questions/{questionIndex}`

**Fields:**
- **`questionText`** (string, max 90 chars) – Question text
- **`choices`** (array[4]) – Answer choices
- **`correctIndex`** (number, 0-3) – Correct answer index
- **`explanation`** (string) – Explanation
- **`updatedAt`** (ISO timestamp)

**Used by:**
- **Admin:** Quiz management (Unity game quizzes)
- **Student:** Unity game (not web LMS)

#### 3.1.6 LMS Lessons

**Path:** `lmsLessons/{slot}`

**Fields:**
- **`slot`** (number, 1-6) – Lesson slot
- (Other fields stored in `lessons/{slot}` - see 2.2)

**Path:** `lmsLessons/{slot}/pages/{pageId}`

**Fields:**
- **`id`** (string) – Page ID
- **`title`** (string) – Page title
- **`content`** (string) – Page content (HTML)
- **`order`** (number) – Display order
- **`createdAt`** (ISO timestamp)
- **`updatedAt`** (ISO timestamp)
- **`assessments`** (object) – Assessments map (see below)

**Path:** `lmsLessons/{slot}/pages/{pageId}/assessments/{assessmentId}`

**Fields:**
- **`id`** (string) – Assessment ID
- **`question`** (string) – Question text
- **`answerA`** (string) – Option A
- **`answerB`** (string) – Option B
- **`answerC`** (string) – Option C
- **`answerD`** (string) – Option D
- **`correctAnswer`** (string: 'A' | 'B' | 'C' | 'D') – Correct answer
- **`explanation`** (string) – Explanation
- **`createdAt`** (ISO timestamp)
- **`updatedAt`** (ISO timestamp)

**Used by:**
- **Admin:** Lesson editor, page/assessment management
- **Student:** Lesson viewing, assessment submission

#### 3.1.7 Lesson Metadata

**Path:** `lessons/{slot}`

**Fields:**
- **`slot`** (number, 1-6) – Lesson slot
- **`lessonTitle`** (string) – Lesson title
- **`lessonName`** (string) – Backward compatibility alias
- **`description`** (string) – Lesson description
- **`lessonDescription`** (string) – Backward compatibility alias
- **`body`** (string) – Lesson body (HTML)
- **`images`** (array) – Legacy field (deprecated)
- **`tools`** (object) – Tools map: `{ toolId: { name, description, category, imageUrl, modelUrl, instructions } }`
- **`status`** (string: 'draft' | 'published')
- **`introVideoUrl`** (string) – Intro video URL
- **`introVideoStoragePath`** (string) – Storage path
- **`createdAt`** (ISO timestamp)
- **`updatedAt`** (ISO timestamp)
- **`questions`** (object) – Unity game questions (legacy, use `lessons/lesson{slot}/questions`)

**Used by:**
- **Admin:** Lesson management
- **Student:** Lesson display (title, description, body, tools, intro video)

#### 3.1.8 Instructors

**Path:** `admins/{uid}`

**Fields:**
- **`uid`** (string) – Firebase Auth UID
- **`name`** (string) – Full name
- **`email`** (string) – Email address
- **`role`** (string: 'instructor' | 'admin')
- **`department`** (string) – Department/position
- **`idNumber`** (string) – ID number
- **`passwordHash`** (string) – Bcrypt hash (for admin/instructor login)
- **`assignedStudents`** (object) – Map of assigned student UIDs: `{ studentUid: true }`
- **`createdAt`** (ISO timestamp)

**Used by:**
- **Admin:** Instructor management, student assignment
- **Student:** Display assigned instructor name

---

## 4. EXISTING STUDENT PAGES (FOR REFERENCE)

### 4.1 Current Student Pages

**Found Files:**
- `public/student-dashboard.html` – Student dashboard
- `public/student-lessons.html` – Lesson list
- `public/student-certificates.html` – Certificate page
- `public/student-profile.html` – Profile page
- `public/student-assessment.html` – Assessment page
- `public/student-quiz-take.html` – Quiz taking page
- `public/student-quiz-history.html` – Quiz history
- `public/student-simulation-history.html` – Simulation history

**Found Scripts:**
- `public/js/student-certificates.js` – Certificate logic
- `routes/student.js` – Student API routes

### 4.2 Known Mismatches

**1. Dashboard Progress Path:**
- **Current:** `routes/student.js` GET `/dashboard` reads from `users/{uid}/progress/lesson{i}`
- **Should be:** `users/{uid}/lmsProgress/lesson{i}`
- **Issue:** Mixing LMS and Game progress

**2. Lesson Status Logic:**
- **Current:** Only checks `quiz.completed` and `simulation.completed`
- **Should be:** Check `hasPages && quizCompleted && quizScoreOk && simOk`
- **Issue:** Missing page completion and quiz score threshold (>=7)

**3. Simulation Pass Check:**
- **Current:** Only checks `simulation.completed`
- **Should be:** Check `simulation.completed && simulation.passed`
- **Issue:** Missing `passed` flag check

---

## 5. CHECKLIST FOR BUILDING STUDENT SIDE

### 5.1 Student Dashboard

**Required Features:**
1. **Dual-Panel Design:**
   - **LMS Panel:** Show LMS progress (from `lmsProgress`)
   - **Game Panel:** Show Game progress (from `progress`) - optional, only if student uses Unity game

2. **LMS Progress Display:**
   - Read from: `users/{uid}/lmsProgress/lesson{slot}` (NOT `progress`)
   - For each lesson (1-6):
     - **Status:** Calculate based on:
       - **Completed:** `hasPages && quizCompleted && quizScoreOk && simOk`
       - **In Progress:** Some criteria met but not all
       - **Not Started:** No progress data
     - **Page Progress:** `completedPages` count / total pages (from `lmsLessons/{slot}/pages`)
     - **Quiz Score:** `quiz.highestScore` (out of 10, highlight if >= 7)
     - **Quiz Attempts:** `quiz.attempts`
     - **Simulation Status:** Show "Passed" if `simulation.completed && simulation.passed`, else show "Not Passed" or "Not Started"
     - **Simulation Attempts:** `simulation.attempts`

3. **Overall Statistics:**
   - **Lessons Completed:** Count lessons where status === 'completed'
   - **Average Quiz Score:** Average of `quiz.highestScore` across completed lessons
   - **Total Attempts:** Sum of quiz and simulation attempts

4. **Game Progress Display (Optional):**
   - Read from: `users/{uid}/progress/lesson{slot}`
   - Show quiz scores, simulation status, attempt counts
   - Show completion count: `lessonsCompleted` or `gameProgress/lessonsCompleted`

**Dependencies:**
- Admin field: `lmsLessons/{slot}/pages` (for total page count)
- Admin field: `users/{uid}/lmsProgress/lesson{slot}` (for progress)
- Admin field: `lessons/{slot}/status` (filter published lessons)

---

### 5.2 Student Lesson List

**Required Features:**
1. **Lesson Filtering:**
   - Only show lessons where `lessons/{slot}/status === 'published'`
   - Hide lessons where `status === 'draft'`

2. **Lesson Display:**
   - **Title:** `lessons/{slot}/lessonTitle`
   - **Description:** `lessons/{slot}/description`
   - **Status Badge:** "Not Started" | "In Progress" | "Completed"
   - **Progress Bar:** Page completion percentage
   - **Quiz Score:** `lmsProgress/lesson{slot}/quiz/highestScore` (if exists)
   - **Simulation Status:** Passed/Not Passed/Not Started

3. **Sorting:**
   - Default: By slot number (1-6)
   - Optional: By status, by completion date

**Dependencies:**
- Admin field: `lessons/{slot}/status` (filter published)
- Admin field: `lessons/{slot}/lessonTitle`, `description`
- Admin field: `users/{uid}/lmsProgress/lesson{slot}` (for status calculation)

---

### 5.3 Student Lesson Detail Page

**Required Features:**
1. **Lesson Header:**
   - **Title:** `lessons/{slot}/lessonTitle`
   - **Description:** `lessons/{slot}/description`
   - **Intro Video:** Show if `lessons/{slot}/introVideoUrl` exists

2. **Lesson Body:**
   - **Content:** `lessons/{slot}/body` (formatted HTML)

3. **Pages Section:**
   - **Page List:** Read from `lmsLessons/{slot}/pages`
   - **Order:** Sort by `order` field
   - **Page Status:** 
     - **Completed:** `lmsProgress/lesson{slot}/completedPages/{pageId} === true`
     - **Unlocked:** Previous page completed OR first page
     - **Locked:** Previous page not completed
   - **Page Content:** Show `lmsLessons/{slot}/pages/{pageId}/content` when unlocked

4. **Assessments:**
   - **Location:** On each page (`lmsLessons/{slot}/pages/{pageId}/assessments`)
   - **Display:** Show assessment question and 4 options (A, B, C, D)
   - **Submission:** POST to `/api/student/lessons/:slot/pages/:pageId/assessments/submit`
   - **Validation:** Check answer against `correctAnswer`
   - **Result:** 
     - If correct: Mark page complete (`lmsProgress/lesson{slot}/completedPages/{pageId} = true`), unlock next page
     - If incorrect: Show error, allow retry
   - **Explanation:** Show `explanation` after submission (regardless of correct/incorrect)

5. **Tools Section:**
   - **Tools List:** Read from `lessons/{slot}/tools`
   - **Display:** Tool name, description, category, thumbnail image
   - **3D Model Viewer:** 
     - If `modelUrl` exists and format is GLB/GLTF: Show web 3D viewer
     - If format is FBX/OBJ: Show download link

6. **Progress Tracking:**
   - **Current Page:** Highlight current page (first incomplete page)
   - **Completion Status:** Show "X of Y pages completed"

**Dependencies:**
- Admin field: `lessons/{slot}/lessonTitle`, `description`, `body`, `introVideoUrl`, `tools`
- Admin field: `lmsLessons/{slot}/pages/{pageId}` (title, content, order, assessments)
- Admin field: `users/{uid}/lmsProgress/lesson{slot}/completedPages` (for unlock logic)

---

### 5.4 Student Quiz Taking (LMS)

**Required Features:**
1. **Quiz Access:**
   - Quiz should be accessible from lesson detail page
   - Quiz data source: TBD (may be separate quiz system or stored in `lmsProgress/lesson{slot}/quiz`)

2. **Quiz Display:**
   - Show questions (format TBD)
   - Allow answer selection
   - Track attempts

3. **Quiz Submission:**
   - Calculate score (out of 10)
   - Write to: `users/{uid}/lmsProgress/lesson{slot}/quiz`
     - **`completed`:** true (if score >= 7)
     - **`highestScore`:** Update if new score is higher
     - **`attempts`:** Increment
     - **`lastAttempt`:** Current timestamp

4. **Quiz Results:**
   - Show score (X/10)
   - Show pass/fail (pass if score >= 7)
   - Show attempt count
   - Allow retake if not passed

**Dependencies:**
- Admin field: Quiz questions source (TBD - may be in `lmsLessons/{slot}/quiz` or separate system)
- Admin field: `users/{uid}/lmsProgress/lesson{slot}/quiz` (for tracking)

**Note:** Quiz system for LMS is not fully defined in admin code. May need to implement quiz questions similar to Unity game quizzes but stored in `lmsLessons/{slot}/quiz` or separate collection.

---

### 5.5 Student Simulation (LMS)

**Required Features:**
1. **Simulation Access:**
   - Simulation should be accessible from lesson detail page
   - Simulation may be external system or Unity game integration

2. **Simulation Results:**
   - Write to: `users/{uid}/lmsProgress/lesson{slot}/simulation`
     - **`completed`:** true
     - **`passed`:** true/false (based on simulation result)
     - **`score`:** Simulation score (0-100)
     - **`attempts`:** Increment
     - **`lastAttempt`:** Current timestamp

3. **Simulation Status Display:**
   - Show "Passed" if `completed && passed`
   - Show "Failed" if `completed && !passed`
   - Show "Not Started" if `!completed`
   - Show attempt count

**Dependencies:**
- Admin field: `users/{uid}/lmsProgress/lesson{slot}/simulation` (for tracking)

**Note:** Simulation system for LMS is not fully defined in admin code. May be external system or Unity game integration.

---

### 5.6 Student Profile Page

**Required Features:**
1. **Basic Information:**
   - **Name:** `users/{uid}/name`
   - **Email:** `users/{uid}/email`
   - **Student Number:** `users/{uid}/studentInfo/studentNumber`
   - **Batch:** `users/{uid}/studentInfo/batch`
   - **Contact Number:** `users/{uid}/contactNumber` (format: +63)
   - **Address:** `users/{uid}/address`
   - **Birthday:** `users/{uid}/birthday`

2. **Account Information:**
   - **Status:** Active/Inactive (from `users/{uid}/active`)
   - **Last Login:** `users/{uid}/lastLogin`
   - **Login Count:** `users/{uid}/loginCount`
   - **Account Created:** `users/{uid}/createdAt`

3. **Instructor Assignment:**
   - **Assigned Instructor:** Show instructor name if `users/{uid}/assignedInstructor` exists
   - Read instructor name from `admins/{instructorUid}/name`

**Dependencies:**
- Admin field: `users/{uid}` (all user fields)
- Admin field: `admins/{instructorUid}/name` (for instructor name)

---

### 5.7 Student Certificates Page

**Required Features:**
1. **LMS Certificate Eligibility Check:**
   - Check all 6 lessons meet criteria:
     - `hasPages` (at least one page completed)
     - `quizCompleted === true && quiz.highestScore >= 7`
     - `simulation.completed === true && simulation.passed === true`
   - Read from: `users/{uid}/lmsProgress/lesson{slot}`

2. **Certificate Generation:**
   - If eligible and no certificate exists:
     - Generate `certificateId`: `LMS-{timestamp-6digits}-{random-3digits}`
     - Write to: `users/{uid}/certificates/caresim_lms_full`
     - Write to: `certificates/{certificateId}` (via POST `/api/student/register-certificate`)

3. **Certificate Display:**
   - Show certificate if `users/{uid}/certificates/caresim_lms_full` exists
   - Show certificate ID, issue date, student name
   - Link to certificate verification page

4. **Notification Status:**
   - Show if admin has sent notification: `users/{uid}/certificateNotificationSentAt` exists
   - Display notification date if exists

**Dependencies:**
- Admin field: `users/{uid}/lmsProgress/lesson{slot}` (for eligibility)
- Admin field: `users/{uid}/certificates/caresim_lms_full` (for certificate display)
- Admin field: `users/{uid}/certificateNotificationSentAt` (for notification status)

---

### 5.8 Student Quiz History (LMS)

**Required Features:**
1. **Quiz History Display:**
   - Show all quiz attempts per lesson
   - Read from: `users/{uid}/lmsProgress/lesson{slot}/quiz`
   - Display: lesson number, score, attempt number, date

2. **Quiz Details:**
   - Show highest score per lesson
   - Show total attempts per lesson
   - Show last attempt date

**Dependencies:**
- Admin field: `users/{uid}/lmsProgress/lesson{slot}/quiz` (for history)

---

### 5.9 Student Simulation History (LMS)

**Required Features:**
1. **Simulation History Display:**
   - Show all simulation attempts per lesson
   - Read from: `users/{uid}/lmsProgress/lesson{slot}/simulation`
   - Display: lesson number, passed/failed, score, attempt number, date

2. **Simulation Details:**
   - Show pass/fail status per lesson
   - Show best score per lesson
   - Show total attempts per lesson
   - Show last attempt date

**Dependencies:**
- Admin field: `users/{uid}/lmsProgress/lesson{slot}/simulation` (for history)

---

## 6. CRITICAL IMPLEMENTATION NOTES

### 6.1 Path Separation (CRITICAL)

**NEVER mix LMS and Game progress:**
- **LMS Progress:** Always use `users/{uid}/lmsProgress/lesson{slot}`
- **Game Progress:** Always use `users/{uid}/progress/lesson{slot}`
- **Legacy Path:** `students/{uid}/lessonProgress/{i}` (old format, may contain either)

**Current Student Dashboard Issue:**
- `routes/student.js` GET `/dashboard` reads from `progress/lesson{i}` ❌
- **Must change to:** `lmsProgress/lesson{i}` ✅

### 6.2 Lesson Status Calculation

**Admin Eligibility Logic (Source of Truth):**
```javascript
const lessonData = progress[`lesson${i}`] || {};
const completedPages = lessonData.completedPages || {};
const hasPages = Object.keys(completedPages).length > 0;
const quiz = lessonData.quiz || {};
const quizCompleted = quiz.completed === true;
const quizScoreOk = (quiz.highestScore || 0) >= 7;
const sim = lessonData.simulation || {};
const simOk = sim.completed === true && sim.passed === true;

// Lesson is "complete" if:
const isComplete = hasPages && quizCompleted && quizScoreOk && simOk;
```

**Student Dashboard Must Use:**
- **Completed:** All criteria met (pages + quiz >=7 + simulation passed)
- **In Progress:** Some criteria met but not all
- **Not Started:** No progress data

### 6.3 Certificate Eligibility

**LMS Certificate (Student-Triggered):**
- Check all 6 lessons meet eligibility criteria
- Student generates certificate if eligible
- Certificate ID format: `LMS-{timestamp}-{random}`

**Game Certificate (Admin-Issued):**
- Admin checks `lessonsCompleted >= 6` (multiple formats supported)
- Admin issues certificate
- Certificate ID format: `PUB-{timestamp}-{random}`
- Students receive email notification

### 6.4 Page Unlock Logic

**Student Lesson Pages:**
- First page: Always unlocked
- Subsequent pages: Unlocked when previous page's assessment is passed
- Check: `lmsProgress/lesson{slot}/completedPages/{previousPageId} === true`

### 6.5 Assessment Submission

**Student Assessment Flow:**
1. Student views page content
2. Student sees assessment question
3. Student selects answer (A, B, C, or D)
4. Student submits answer
5. Backend validates against `lmsLessons/{slot}/pages/{pageId}/assessments/{assessmentId}/correctAnswer`
6. If correct:
   - Write: `lmsProgress/lesson{slot}/completedPages/{pageId} = true`
   - Unlock next page
7. Show explanation (regardless of correct/incorrect)

---

## 7. SUMMARY

This document provides a complete mapping of all admin features and configurations that impact the student experience. Key takeaways:

1. **Dual Progress Systems:** LMS (web) and Game (Unity) progress are separate - never mix paths
2. **Lesson Status:** Must check pages + quiz (>=7) + simulation (passed) for completion
3. **Certificate Eligibility:** LMS requires all 6 lessons complete; Game requires 6/6 lessons completed
4. **Page Unlock:** Sequential - must pass assessment to unlock next page
5. **Published Lessons Only:** Students only see lessons where `status === 'published'`
6. **No Sections/Classes:** Students are grouped by batch and instructor assignment only

Use this document as the source of truth when rebuilding the student side to ensure alignment with admin expectations.







