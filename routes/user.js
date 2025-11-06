const express = require('express');
const router = express.Router();
const { verifyStudentToken } = require('../middleware/auth');
const { db } = require('../config/firebase');

// Get user dashboard data (adapted from students logic)
router.get('/dashboard', verifyStudentToken, async (req, res) => {
  try {
    console.log('User dashboard request received for userId:', req.userId);
    const userRef = db.ref(`users/${req.userId}`);
    const snapshot = await userRef.once('value');
    let userData = snapshot.val();

    console.log('Raw userData from Firebase:', JSON.stringify(userData ? Object.keys(userData) : 'null'));

    // Don't initialize if user doesn't exist - preserve existing data structure
    // Only read what exists, don't modify unless explicitly updating
    if (!userData) {
      userData = {};
    }

    // Get lessons data
    const lessonsRef = db.ref('lessons');
    const lessonsSnapshot = await lessonsRef.once('value');
    const allLessons = lessonsSnapshot.val() || {};
    
    // Fetch quiz history once from users/{userId}/history/quizzes (optimize - fetch once, filter per lesson)
    // History is stored with timestamps as keys, each entry has: lesson, score, time
    const historyRef = db.ref(`users/${req.userId}/history/quizzes`);
    const historySnapshot = await historyRef.once('value');
    const allHistory = historySnapshot.val() || {};
    
    console.log('User Dashboard: Fetched all quiz history, entries:', Object.keys(allHistory || {}).length);
    
    // Map lessons with user progress - Always return 6 lessons
    // Adapt from students/lessonProgress structure to users/progress/lesson structure
    const lessons = [];
    for (let i = 1; i <= 6; i++) {
      const lesson = allLessons[i];
      
      // Initialize lesson data with slot number
      const lessonData = {
        slot: i
      };
      
      // Include lesson info if it exists in database
      if (lesson && lesson.lessonName) {
        lessonData.lessonName = lesson.lessonName;
        if (lesson.lessonDescription) {
          lessonData.lessonDescription = lesson.lessonDescription;
        }
      }
      
      // Filter history for this lesson and convert to array
      const lessonHistory = [];
      if (allHistory && typeof allHistory === 'object') {
        Object.entries(allHistory).forEach(([timestamp, entry]) => {
          if (entry && entry.lesson === i) {
            // Parse timestamp and format date/time
            const dateObj = new Date(timestamp);
            const dateStr = dateObj.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'short', 
              day: 'numeric' 
            });
            const timeStr = dateObj.toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit',
              hour12: true 
            });
            
            // Format duration (time in seconds to minutes/seconds)
            const durationSeconds = entry.time || 0;
            const mins = Math.floor(durationSeconds / 60);
            const secs = Math.floor(durationSeconds % 60);
            const durationStr = `${mins}m ${secs}s`;
            
            // Format score as "X out of 10"
            const score = entry.score || 0;
            const scoreStr = `${score} out of 10`;
            
            lessonHistory.push({
              timestamp: timestamp,
              date: dateStr,
              time: timeStr,
              duration: durationStr,
              durationSeconds: durationSeconds,
              score: score,
              scoreText: scoreStr
            });
          }
        });
        
        // Sort by timestamp (newest first)
        lessonHistory.sort((a, b) => {
          return new Date(b.timestamp) - new Date(a.timestamp);
        });
        
        console.log(`Lesson ${i} - Found ${lessonHistory.length} history entries`);
      }
      
      // Always get user's lesson progress - ensures progress shows even when lesson name isn't defined
      const lessonProgressRef = db.ref(`users/${req.userId}/progress/lesson${i}`);
      const progressSnapshot = await lessonProgressRef.once('value');
      const progress = progressSnapshot.val();
      
      console.log(`Lesson ${i} progress from users DB:`, JSON.stringify(progress));
      
      // Convert users progress structure to lesson status
      // BOTH quiz AND simulation must be completed for status = "completed"
      // If either is incomplete, status = "in_progress"
      if (progress && typeof progress === 'object' && progress !== null) {
        const quizCompleted = progress.quiz?.completed || false;
        const simCompleted = progress.simulation?.completed || false;
        const quizAttempts = progress.quiz?.attempts || 0;
        const simAttempts = progress.simulation?.attempts || 0;
        
        console.log(`Lesson ${i} - Quiz completed: ${quizCompleted}, Sim completed: ${simCompleted}, Quiz attempts: ${quizAttempts}, Sim attempts: ${simAttempts}`);
        
        let status = 'not_started';
        if (quizCompleted && simCompleted) {
          // Both completed = Completed
          status = 'completed';
          console.log(`Lesson ${i} - Status: completed (both quiz and sim completed)`);
        } else if (quizCompleted || simCompleted || quizAttempts > 0 || simAttempts > 0) {
          // At least one started/incomplete = In Progress
          status = 'in_progress';
          console.log(`Lesson ${i} - Status: in_progress (one or both incomplete)`);
        } else {
          console.log(`Lesson ${i} - Status: not_started (no attempts)`);
        }
        
        lessonData.status = status;
        
        // Get quiz data from users structure
        if (progress.quiz) {
          // Recent Quiz Score (latestScore)
          const latestScore = progress.quiz.latestScore;
          if (latestScore !== null && latestScore !== undefined && typeof latestScore === 'number' && !isNaN(latestScore)) {
            lessonData.recentQuizScore = latestScore;
            console.log(`Lesson ${i} - Recent Quiz Score: ${latestScore}`);
          } else {
            console.log(`Lesson ${i} - Recent Quiz Score: MISSING or invalid (value: ${latestScore}, type: ${typeof latestScore})`);
          }
          
          // Highest Quiz Score
          const highestScore = progress.quiz.highestScore;
          if (highestScore !== null && highestScore !== undefined && typeof highestScore === 'number' && !isNaN(highestScore)) {
            lessonData.highestQuizScore = highestScore;
            console.log(`Lesson ${i} - Highest Quiz Score: ${highestScore}`);
          } else {
            console.log(`Lesson ${i} - Highest Quiz Score: MISSING or invalid (value: ${highestScore}, type: ${typeof highestScore})`);
          }
          
          // Quiz Attempts
          const attempts = progress.quiz.attempts;
          if (attempts !== null && attempts !== undefined && typeof attempts === 'number' && !isNaN(attempts)) {
            lessonData.quizAttempts = attempts;
            console.log(`Lesson ${i} - Quiz Attempts: ${attempts}`);
          } else {
            console.log(`Lesson ${i} - Quiz Attempts: MISSING or invalid (value: ${attempts}, type: ${typeof attempts})`);
          }
          
          // Average Quiz Time
          const avgTime = progress.quiz.avgTime;
          if (avgTime !== null && avgTime !== undefined && typeof avgTime === 'number' && !isNaN(avgTime) && avgTime > 0) {
            lessonData.avgQuizTime = avgTime;
            console.log(`Lesson ${i} - Avg Quiz Time: ${avgTime}`);
          } else {
            console.log(`Lesson ${i} - Avg Quiz Time: MISSING or invalid (value: ${avgTime}, type: ${typeof avgTime})`);
          }
        }
        
        // Get simulation data
        if (progress.simulation) {
          // Average Simulation Time
          const simAvgTime = progress.simulation.avgTime;
          if (simAvgTime !== null && simAvgTime !== undefined && typeof simAvgTime === 'number' && !isNaN(simAvgTime) && simAvgTime > 0) {
            lessonData.avgSimTime = simAvgTime;
            console.log(`Lesson ${i} - Avg Sim Time: ${simAvgTime}`);
          } else {
            console.log(`Lesson ${i} - Avg Sim Time: MISSING or invalid (value: ${simAvgTime}, type: ${typeof simAvgTime})`);
          }
        }
        
        console.log(`Lesson ${i} - Final lessonData:`, JSON.stringify(lessonData, null, 2));
      } else {
        // Default to "not_started" if no progress data exists
        lessonData.status = 'not_started';
        console.log(`Lesson ${i} - No progress data found, defaulting to not_started`);
      }
      
      // Quiz History (for popup) - Set outside progress check so it's always included if history exists
      // Fetch from users/{userId}/history/quizzes and filter by lesson
      // Calculate average quiz score from user's quiz attempts
      if (lessonHistory.length > 0) {
        // History is already formatted with date, time, duration, and scoreText
        lessonData.quizHistory = lessonHistory;
        console.log(`Lesson ${i} - Quiz History: ${lessonHistory.length} entries from history/quizzes`);
        
        // Calculate average quiz score from user's quiz attempts
        // Sum all scores and divide by number of attempts
        const totalScore = lessonHistory.reduce((sum, entry) => {
          const score = entry.score || 0;
          return sum + score;
        }, 0);
        const avgScore = lessonHistory.length > 0 ? totalScore / lessonHistory.length : 0;
        lessonData.avgQuizScore = Math.round(avgScore * 100) / 100; // Round to 2 decimal places
        console.log(`Lesson ${i} - Average Quiz Score: ${lessonData.avgQuizScore} (calculated from ${lessonHistory.length} attempts, totalScore: ${totalScore})`);
      } else {
        // Check if there are attempts to enable button even without history
        const attempts = progress?.quiz?.attempts || 0;
        if (attempts > 0) {
          // If there are attempts but no history, include empty array so button can be enabled
          lessonData.quizHistory = [];
          console.log(`Lesson ${i} - Quiz History: No history found, but ${attempts} attempts exist`);
        }
        // Set average to null/undefined if no history (frontend will show N/A)
        lessonData.avgQuizScore = null;
        console.log(`Lesson ${i} - Average Quiz Score: null (no history available)`);
      }
      
      lessons.push(lessonData);
    }

    // Calculate profile completion from studentInfo structure
    // When verified is false, show 50% as default
    // When user fills profile details, can reach 100%
    const studentInfo = userData.studentInfo || {};
    const isVerified = userData.verified === true || userData.verified === 'true';
    let completionScore = 0;
    
    console.log('User Dashboard: Raw verified value from DB:', userData.verified, 'Type:', typeof userData.verified);
    console.log('User Dashboard: isVerified after check:', isVerified);
    
    // Calculate based on fields filled
    if (userData.email) completionScore += 15;
    if (userData.name) completionScore += 15;
    if (studentInfo.gender) completionScore += 10;
    if (studentInfo.studentNumber) completionScore += 15;
    if (studentInfo.batch) completionScore += 10;
    if (studentInfo.address) completionScore += 10;
    if (studentInfo.contactNumber) completionScore += 10;
    if (studentInfo.birthday) completionScore += 15;
    
    console.log('User Dashboard: Calculated completion score before verified check:', completionScore);
    
    // If verified is false, show 50% as minimum/default
    // If user fills all details, can reach 100%
    if (!isVerified) {
      console.log('User Dashboard: Verified is false, checking if completion < 50');
      // Set minimum to 50% when verified is false
      if (completionScore < 50) {
        console.log('User Dashboard: Setting completion to 50% (was:', completionScore + ')');
        completionScore = 50;
      } else {
        console.log('User Dashboard: Completion already >= 50%, keeping:', completionScore);
      }
    } else {
      console.log('User Dashboard: Verified is true, using calculated score:', completionScore);
    }

    // Check for profile picture in userData
    let profilePictureValue = null;
    console.log('User Dashboard: Checking for profilePicture...');
    console.log('User Dashboard: userData type:', typeof userData);
    console.log('User Dashboard: userData keys:', userData ? Object.keys(userData) : 'null');
    
    if (userData && typeof userData === 'object' && userData !== null) {
      if ('profilePicture' in userData) {
        const picValue = userData.profilePicture;
        console.log('User Dashboard: profilePicture field found, type:', typeof picValue);
        
        if (picValue && typeof picValue === 'string' && picValue.trim() !== '' && picValue !== 'null' && picValue !== 'undefined') {
          profilePictureValue = picValue;
          console.log('User Dashboard: Profile picture VALID, length:', picValue.length);
        }
      }
    }

    console.log('User Dashboard: Final profilePictureValue:', profilePictureValue ? 'Yes (' + (profilePictureValue.length || 0) + ' chars)' : 'No/null');

    // Always include profilePicture in response, even if null
    // Include both name/fullName and verified/isVerified for frontend compatibility
    const userName = userData.name || '';
    const responseData = {
      email: userData.email || req.user.email || '',
      name: userName,
      fullName: userName, // Include fullName for frontend compatibility
      status: 'active', // Users don't have status field, default to active
      certificates: [], // Users don't seem to have certificates, use empty array
      lessons: lessons,
      profileCompletion: completionScore,
      verified: isVerified,
      isVerified: isVerified, // Include isVerified for frontend compatibility
      // Map studentInfo fields to response
      gender: studentInfo.gender || '',
      studentNumber: studentInfo.studentNumber || '',
      batch: studentInfo.batch || '',
      address: studentInfo.address || '',
      contactNumber: studentInfo.contactNumber || '',
      birthday: studentInfo.birthday || '',
      school: studentInfo.school || '',
      profilePicture: profilePictureValue !== undefined ? profilePictureValue : null
    };
    
    console.log('User Dashboard: Response being sent');
    console.log('User Dashboard: Lessons count:', lessons.length);
    // Log each lesson with history
    lessons.forEach((lesson, idx) => {
      if (lesson.quizHistory && Array.isArray(lesson.quizHistory)) {
        console.log(`Lesson ${lesson.slot || idx + 1} - quizHistory array length: ${lesson.quizHistory.length}`);
        if (lesson.quizHistory.length > 0) {
          console.log(`Lesson ${lesson.slot || idx + 1} - First history entry:`, JSON.stringify(lesson.quizHistory[0]));
        }
      } else {
        console.log(`Lesson ${lesson.slot || idx + 1} - No quizHistory found`);
      }
    });
    console.log('User Dashboard: Lessons data (full):', JSON.stringify(lessons, null, 2));
    // Log first lesson in detail
    if (lessons.length > 0) {
      console.log('User Dashboard: First lesson keys:', Object.keys(lessons[0]));
      console.log('User Dashboard: First lesson data:', JSON.stringify(lessons[0], null, 2));
    }
    console.log('User Dashboard: Profile completion:', completionScore);
    console.log('User Dashboard: Is verified:', isVerified);
    console.log('User Dashboard: User name:', userName);
    console.log('User Dashboard: User email:', userData.email || req.user.email);

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Get user dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch user dashboard data' });
  }
});

// Get user profile (adapted from students logic)
router.get('/profile', verifyStudentToken, async (req, res) => {
  try {
    const userRef = db.ref(`users/${req.userId}`);
    const snapshot = await userRef.once('value');
    let userData = snapshot.val();

    // Don't initialize - preserve existing data
    if (!userData) {
      userData = {};
    }

    // Calculate profile completion from studentInfo structure
    // When verified is false, show 50% as default
    // When user fills profile details, can reach 100%
    const studentInfo = userData.studentInfo || {};
    const isVerified = userData.verified === true || userData.verified === 'true';
    let completionScore = 0;
    
    // Calculate based on fields filled
    if (userData.email) completionScore += 15;
    if (userData.name) completionScore += 15;
    if (studentInfo.gender) completionScore += 10;
    if (studentInfo.studentNumber) completionScore += 15;
    if (studentInfo.batch) completionScore += 10;
    if (studentInfo.address) completionScore += 10;
    if (studentInfo.contactNumber) completionScore += 10;
    if (studentInfo.birthday) completionScore += 15;
    
    // If verified is false, show 50% as minimum/default
    // If user fills all details, can reach 100%
    if (!isVerified) {
      // Set minimum to 50% when verified is false
      if (completionScore < 50) {
        completionScore = 50;
      }
    }
    // If verified is true, use calculated score (0-100%)

    const userName = userData.name || '';
    res.json({
      success: true,
      data: {
        email: userData.email || req.user.email || '',
        name: userName,
        fullName: userName, // Include fullName for frontend compatibility
        gender: studentInfo.gender || '',
        studentNumber: studentInfo.studentNumber || '',
        batch: studentInfo.batch || '',
        address: studentInfo.address || '',
        contactNumber: studentInfo.contactNumber || '',
        birthday: studentInfo.birthday || '',
        school: studentInfo.school || '',
        profilePicture: userData.profilePicture || null,
        profileCompletion: completionScore,
        verified: isVerified,
        isVerified: isVerified // Include isVerified for frontend compatibility
      }
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Update user profile (adapted from students logic)
router.put('/profile', verifyStudentToken, async (req, res) => {
  try {
    const { name, gender, studentNumber, batch, address, contactNumber, birthday, school, profilePicture } = req.body;
    
    console.log('User profile update request received for userId:', req.userId);
    console.log('User profile update - ProfilePicture provided:', profilePicture !== undefined, 'Value:', profilePicture ? 'base64 string (' + profilePicture.length + ' chars)' : profilePicture);
    
    const userRef = db.ref(`users/${req.userId}`);
    const snapshot = await userRef.once('value');
    const existing = snapshot.val() || {};
    
    console.log('User profile update - Existing data keys:', Object.keys(existing));

    // Preserve all existing data structure (progress, history, etc.)
    // Only update what's provided, preserve everything else
    const existingStudentInfo = existing.studentInfo || {};
    
    // Update user data - preserve existing structure
    const updatedData = {
      ...existing,
      email: req.user.email || existing.email,
      name: name !== undefined ? name : existing.name,
      updatedAt: new Date().toISOString(),
      // Update studentInfo nested object
      studentInfo: {
        ...existingStudentInfo,
        gender: gender !== undefined ? gender : existingStudentInfo.gender,
        studentNumber: studentNumber !== undefined ? studentNumber : existingStudentInfo.studentNumber,
        batch: batch !== undefined ? batch : existingStudentInfo.batch,
        address: address !== undefined ? address : existingStudentInfo.address,
        contactNumber: contactNumber !== undefined ? contactNumber : existingStudentInfo.contactNumber,
        birthday: birthday !== undefined ? birthday : existingStudentInfo.birthday,
        school: school !== undefined ? school : existingStudentInfo.school
      }
    };

    // Update profile picture if provided (can be null to remove)
    if (profilePicture !== undefined) {
      if (profilePicture === null || profilePicture === 'null') {
        // Remove profile picture
        delete updatedData.profilePicture;
        console.log('Removing profile picture from user database');
      } else if (typeof profilePicture === 'string' && profilePicture.trim() !== '') {
        // Save profile picture
        updatedData.profilePicture = profilePicture;
        console.log('Saving profile picture to user database, length:', profilePicture.length);
      }
    }

    // Calculate profile completion based on actual fields filled
    // When user updates profile, calculate properly (can reach 100%)
    let completionScore = 0;
    if (updatedData.email) completionScore += 15;
    if (updatedData.name) completionScore += 15;
    if (updatedData.studentInfo.gender) completionScore += 10;
    if (updatedData.studentInfo.studentNumber) completionScore += 15;
    if (updatedData.studentInfo.batch) completionScore += 10;
    if (updatedData.studentInfo.address) completionScore += 10;
    if (updatedData.studentInfo.contactNumber) completionScore += 10;
    if (updatedData.studentInfo.birthday) completionScore += 15;
    
    updatedData.profileCompletion = completionScore;

    // Auto-verify if completion is 80%+ (but don't force 50% if user updates)
    if (completionScore >= 80) {
      updatedData.verified = true;
    }

    await userRef.set(updatedData);
    
    // Verify what was saved
    const verifySnapshot = await userRef.once('value');
    const savedData = verifySnapshot.val() || {};
    console.log('User profile saved. ProfilePicture in saved data:', savedData.hasOwnProperty('profilePicture') ? 'Yes (length: ' + (savedData.profilePicture?.length || 0) + ')' : 'No');

    // Ensure profilePicture is included in response (can be null)
    let profilePictureValue = null;
    if (savedData.hasOwnProperty('profilePicture') && savedData.profilePicture) {
      profilePictureValue = savedData.profilePicture;
      console.log('Profile picture found in saved user data, length:', profilePictureValue.length);
    } else {
      console.log('No profile picture in saved user data');
    }
    
    const savedStudentInfo = savedData.studentInfo || {};
    const savedUserName = savedData.name || updatedData.name || '';
    const responseData = {
      email: savedData.email || updatedData.email,
      name: savedUserName,
      fullName: savedUserName, // Include fullName for frontend compatibility
      gender: savedStudentInfo.gender || updatedData.studentInfo.gender || '',
      studentNumber: savedStudentInfo.studentNumber || updatedData.studentInfo.studentNumber || '',
      batch: savedStudentInfo.batch || updatedData.studentInfo.batch || '',
      address: savedStudentInfo.address || updatedData.studentInfo.address || '',
      contactNumber: savedStudentInfo.contactNumber || updatedData.studentInfo.contactNumber || '',
      birthday: savedStudentInfo.birthday || updatedData.studentInfo.birthday || '',
      school: savedStudentInfo.school || updatedData.studentInfo.school || '',
      profilePicture: profilePictureValue,
      profileCompletion: completionScore,
      verified: savedData.verified !== undefined ? savedData.verified : (completionScore >= 80),
      isVerified: savedData.verified !== undefined ? savedData.verified : (completionScore >= 80) // Include isVerified for frontend compatibility
    };

    console.log('Sending user profile update response, profilePicture:', responseData.profilePicture ? 'Exists (' + (responseData.profilePicture.length || 0) + ' chars)' : 'null');

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

module.exports = router;

