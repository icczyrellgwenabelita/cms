const express = require('express');
const router = express.Router();
const { verifyStudentToken } = require('../middleware/auth');
const { db } = require('../config/firebase');

// Helper function to get user data from either students or users database
async function getUserData(userId) {
  // First check students database
  const studentRef = db.ref(`students/${userId}`);
  const studentSnapshot = await studentRef.once('value');
  let studentData = studentSnapshot.val();
  let isUser = false;

  // If not found in students, check users database
  if (!studentData) {
    const userRef = db.ref(`users/${userId}`);
    const userSnapshot = await userRef.once('value');
    const userData = userSnapshot.val();
    
    if (userData) {
      isUser = true;
      // Convert user data structure to student-compatible format
      const studentInfo = userData.studentInfo || {};
      studentData = {
        email: userData.email || '',
        fullName: userData.name || '',
        status: 'active',
        certificates: [],
        gender: studentInfo.gender || '',
        studentNumber: studentInfo.studentNumber || '',
        batch: studentInfo.batch || '',
        address: studentInfo.address || '',
        contactNumber: studentInfo.contactNumber || '',
        birthday: studentInfo.birthday || '',
        isVerified: userData.verified || false,
        profileCompletion: userData.profileCompletion || 0,
        profilePicture: userData.profilePicture || null,
        _isUser: true,
        _userData: userData // Keep original for progress/history access
      };
    }
  }

  return { studentData, isUser };
}

// Get student dashboard data (supports both students and users)
router.get('/dashboard', verifyStudentToken, async (req, res) => {
  try {
    console.log('Dashboard request received for userId:', req.userId);
    
    const { studentData: data, isUser } = await getUserData(req.userId);
    let studentData = data;

    console.log('Raw studentData from Firebase:', JSON.stringify(studentData ? Object.keys(studentData) : 'null'));
    console.log('Is user from users database:', isUser);

    if (!studentData) {
      // Initialize student data in students database
      studentData = {
        email: req.user.email,
        status: 'active',
        certificates: [],
        lessons: [],
        profileCompletion: 0,
        isVerified: false,
        createdAt: new Date().toISOString()
      };
      const studentRef = db.ref(`students/${req.userId}`);
      await studentRef.set(studentData);
      console.log('Created new student data entry');
    }

        // Get lessons data
        const lessonsRef = db.ref('lessons');
        const lessonsSnapshot = await lessonsRef.once('value');
        const allLessons = lessonsSnapshot.val() || {};
        
        // Map lessons with student progress - Always return 6 lessons
        // Include progress even if lesson name doesn't exist in lessons collection
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
          
          // Always get student's lesson progress - check students or users database
          // This ensures progress shows even when lesson name isn't defined
          let progress = null;
          if (isUser) {
            // For users, read from users/progress/lesson{i} structure
            const userProgressRef = db.ref(`users/${req.userId}/progress/lesson${i}`);
            const userProgressSnapshot = await userProgressRef.once('value');
            const userProgress = userProgressSnapshot.val();
            
            console.log(`Lesson ${i} progress from users DB:`, JSON.stringify(userProgress));
            
            if (userProgress) {
              // Determine status based on completion logic:
              // BOTH quiz AND simulation must be completed for status = "completed"
              // If either is incomplete, status = "in_progress"
              const quizCompleted = userProgress.quiz?.completed || false;
              const simCompleted = userProgress.simulation?.completed || false;
              const quizAttempts = userProgress.quiz?.attempts || 0;
              const simAttempts = userProgress.simulation?.attempts || 0;
              
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
              
              // Convert user progress structure to student format
              progress = {
                status: status,
                quizScore: userProgress.quiz?.highestScore || null
              };
              
              console.log(`Lesson ${i} - Final progress object:`, JSON.stringify(progress));
            } else {
              console.log(`Lesson ${i} - No progress data found in users database`);
            }
          } else {
            // For students, read from students/lessonProgress/{i} structure
            const lessonProgressRef = db.ref(`students/${req.userId}/lessonProgress/${i}`);
            const progressSnapshot = await lessonProgressRef.once('value');
            progress = progressSnapshot.val();
            console.log(`Lesson ${i} progress from students DB:`, JSON.stringify(progress));
          }
          
          // Get class averages - check if data actually exists
          const classStatsRef = db.ref(`classStats/lessons/${i}`);
          const classStatsSnapshot = await classStatsRef.once('value');
          const classStats = classStatsSnapshot.val();
          
          // Set status based on progress data
          // Status determination: Both quiz AND simulation must be completed for "completed"
          // If either is incomplete, status is "in_progress"
          if (progress && typeof progress === 'object' && progress !== null && 
              progress.status && typeof progress.status === 'string' && progress.status.trim() !== '') {
            lessonData.status = progress.status;
          } else {
            // Default to "not_started" if no progress data exists
            lessonData.status = 'not_started';
          }
          
          // Only include quizScore if it exists, is a number, and is not null/undefined
          if (progress && typeof progress === 'object' && progress !== null &&
              'quizScore' in progress && 
              progress.quizScore !== null && 
              progress.quizScore !== undefined && 
              typeof progress.quizScore === 'number' &&
              !isNaN(progress.quizScore)) {
            lessonData.quizScore = progress.quizScore;
          }
          
          // Only include class stats if they exist, are objects, and have valid numeric values
          if (classStats && typeof classStats === 'object' && classStats !== null) {
            // Average Quiz Grade
            if ('avgQuizGrade' in classStats &&
                classStats.avgQuizGrade !== null && 
                classStats.avgQuizGrade !== undefined && 
                typeof classStats.avgQuizGrade === 'number' &&
                !isNaN(classStats.avgQuizGrade)) {
              lessonData.avgClassGrade = classStats.avgQuizGrade;
            }
            
            // Highest Quiz Grade
            if ('highestQuizGrade' in classStats &&
                classStats.highestQuizGrade !== null && 
                classStats.highestQuizGrade !== undefined && 
                typeof classStats.highestQuizGrade === 'number' &&
                !isNaN(classStats.highestQuizGrade)) {
              lessonData.highestGrade = classStats.highestQuizGrade;
            }
            
            // Average Quiz Time
            if ('avgQuizTime' in classStats &&
                classStats.avgQuizTime !== null && 
                classStats.avgQuizTime !== undefined && 
                typeof classStats.avgQuizTime === 'number' &&
                !isNaN(classStats.avgQuizTime)) {
              lessonData.avgQuizTime = classStats.avgQuizTime;
            }
            
            // Average Simulation Time
            if ('avgSimTime' in classStats &&
                classStats.avgSimTime !== null && 
                classStats.avgSimTime !== undefined && 
                typeof classStats.avgSimTime === 'number' &&
                !isNaN(classStats.avgSimTime)) {
              lessonData.avgSimTime = classStats.avgSimTime;
            }
          }
          
          lessons.push(lessonData);
        }

    // Calculate profile completion
    // If verified is true in database, show 50% (minimum)
    // Otherwise calculate based on fields filled
    let completionScore = 0;
    const isVerified = studentData.isVerified || studentData.verified || false;
    
    if (isVerified) {
      // If verified in database, start with 50%
      completionScore = 50;
    } else {
      // Calculate normally if not verified
      if (studentData.email) completionScore += 15;
      if (studentData.fullName) completionScore += 15;
      if (studentData.gender) completionScore += 10;
      if (studentData.studentNumber) completionScore += 15;
      if (studentData.batch) completionScore += 10;
      if (studentData.address) completionScore += 10;
      if (studentData.contactNumber) completionScore += 10;
      if (studentData.birthday) completionScore += 15;
    }

    // Check for profile picture in studentData - be more thorough
    let profilePictureValue = null;
    console.log('Dashboard: Checking for profilePicture...');
    console.log('Dashboard: studentData type:', typeof studentData);
    console.log('Dashboard: studentData keys:', studentData ? Object.keys(studentData) : 'null');
    
    if (studentData && typeof studentData === 'object' && studentData !== null) {
      // Check if profilePicture exists using multiple methods
      if ('profilePicture' in studentData) {
        const picValue = studentData.profilePicture;
        console.log('Dashboard: profilePicture field found, type:', typeof picValue, 'value preview:', picValue ? (typeof picValue === 'string' ? picValue.substring(0, 50) + '...' : String(picValue).substring(0, 50)) : 'null/undefined');
        
        if (picValue && typeof picValue === 'string' && picValue.trim() !== '' && picValue !== 'null' && picValue !== 'undefined') {
          profilePictureValue = picValue;
          console.log('Dashboard: Profile picture VALID, length:', picValue.length);
        } else {
          console.log('Dashboard: Profile picture field exists but is INVALID:', {
            type: typeof picValue,
            isNull: picValue === null,
            isUndefined: picValue === undefined,
            isEmpty: typeof picValue === 'string' && picValue.trim() === '',
            value: picValue
          });
        }
      } else if (studentData.hasOwnProperty('profilePicture')) {
        // Fallback check
        const picValue = studentData.profilePicture;
        console.log('Dashboard: profilePicture found via hasOwnProperty');
        if (picValue && typeof picValue === 'string' && picValue.trim() !== '' && picValue !== 'null') {
          profilePictureValue = picValue;
        }
      } else {
        console.log('Dashboard: No profilePicture field in studentData object');
        console.log('Dashboard: Available fields:', Object.keys(studentData));
      }
    } else {
      console.log('Dashboard: studentData is not a valid object:', studentData);
    }

    console.log('Dashboard: Final profilePictureValue:', profilePictureValue ? 'Yes (' + (profilePictureValue.length || 0) + ' chars)' : 'No/null');

    // Always include profilePicture in response, even if null
    const responseData = {
      email: req.user.email,
      fullName: studentData.fullName || '',
      status: studentData.status || 'active',
      certificates: studentData.certificates || [],
      lessons: lessons,
      profileCompletion: completionScore,
      isVerified: isVerified,
      gender: studentData.gender || '',
      studentNumber: studentData.studentNumber || '',
      batch: studentData.batch || '',
      address: studentData.address || '',
      contactNumber: studentData.contactNumber || '',
      birthday: studentData.birthday || '',
      profilePicture: profilePictureValue !== undefined ? profilePictureValue : null
    };
    
    console.log('Dashboard: Response being sent, profilePicture included:', 'profilePicture' in responseData, 'value:', responseData.profilePicture ? 'Yes' : 'No/null');

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get student profile (supports both students and users)
router.get('/profile', verifyStudentToken, async (req, res) => {
  try {
    const { studentData: data, isUser } = await getUserData(req.userId);
    let studentData = data;

    if (!studentData) {
      studentData = {
        email: req.user.email,
        status: 'active',
        createdAt: new Date().toISOString()
      };
      const studentRef = db.ref(`students/${req.userId}`);
      await studentRef.set(studentData);
    }

    // Calculate profile completion
    // If verified is true in database, show 50% (minimum)
    // Otherwise calculate based on fields filled
    let completionScore = 0;
    const isVerified = studentData.isVerified || studentData.verified || false;
    
    if (isVerified) {
      // If verified in database, start with 50%
      completionScore = 50;
    } else {
      // Calculate normally if not verified
      if (studentData.email) completionScore += 15;
      if (studentData.fullName) completionScore += 15;
      if (studentData.gender) completionScore += 10;
      if (studentData.studentNumber) completionScore += 15;
      if (studentData.batch) completionScore += 10;
      if (studentData.address) completionScore += 10;
      if (studentData.contactNumber) completionScore += 10;
      if (studentData.birthday) completionScore += 15;
    }

    res.json({
      success: true,
      data: {
        email: req.user.email,
        fullName: studentData.fullName || '',
        gender: studentData.gender || '',
        studentNumber: studentData.studentNumber || '',
        batch: studentData.batch || '',
        address: studentData.address || '',
        contactNumber: studentData.contactNumber || '',
        birthday: studentData.birthday || '',
        profilePicture: studentData.profilePicture || null,
        profileCompletion: completionScore,
        isVerified: isVerified
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update student profile (supports both students and users)
router.put('/profile', verifyStudentToken, async (req, res) => {
  try {
    const { fullName, gender, studentNumber, batch, address, contactNumber, birthday, profilePicture } = req.body;
    
    console.log('Profile update request received for userId:', req.userId);
    console.log('Profile update - ProfilePicture provided:', profilePicture !== undefined, 'Value:', profilePicture ? 'base64 string (' + profilePicture.length + ' chars)' : profilePicture);
    
    // Check if user is from users database
    const { studentData: data, isUser } = await getUserData(req.userId);
    const existing = data || {};
    
    console.log('Profile update - Is user from users database:', isUser);
    console.log('Profile update - Existing data keys:', Object.keys(existing));

    if (isUser) {
      // Update users database
      const userRef = db.ref(`users/${req.userId}`);
      const userSnapshot = await userRef.once('value');
      const userData = userSnapshot.val() || {};
      const existingStudentInfo = userData.studentInfo || {};
      
      // Update user data structure
      const updatedUserData = {
        ...userData,
        email: req.user.email || userData.email,
        name: fullName !== undefined ? fullName : userData.name,
        updatedAt: new Date().toISOString(),
        studentInfo: {
          ...existingStudentInfo,
          gender: gender !== undefined ? gender : existingStudentInfo.gender,
          studentNumber: studentNumber !== undefined ? studentNumber : existingStudentInfo.studentNumber,
          batch: batch !== undefined ? batch : existingStudentInfo.batch,
          address: address !== undefined ? address : existingStudentInfo.address,
          contactNumber: contactNumber !== undefined ? contactNumber : existingStudentInfo.contactNumber,
          birthday: birthday !== undefined ? birthday : existingStudentInfo.birthday
        }
      };
      
      // Update profile picture
      if (profilePicture !== undefined) {
        if (profilePicture === null || profilePicture === 'null') {
          delete updatedUserData.profilePicture;
        } else if (typeof profilePicture === 'string' && profilePicture.trim() !== '') {
          updatedUserData.profilePicture = profilePicture;
        }
      }
      
      // Calculate profile completion based on actual fields filled
      // When user updates profile, calculate properly (can reach 100%)
      let completionScore = 0;
      if (updatedUserData.email) completionScore += 15;
      if (updatedUserData.name) completionScore += 15;
      if (updatedUserData.studentInfo.gender) completionScore += 10;
      if (updatedUserData.studentInfo.studentNumber) completionScore += 15;
      if (updatedUserData.studentInfo.batch) completionScore += 10;
      if (updatedUserData.studentInfo.address) completionScore += 10;
      if (updatedUserData.studentInfo.contactNumber) completionScore += 10;
      if (updatedUserData.studentInfo.birthday) completionScore += 15;
      
      updatedUserData.profileCompletion = completionScore;
      
      // Auto-verify if completion is 80%+ (but don't force 50% if user updates)
      if (completionScore >= 80) {
        updatedUserData.verified = true;
      }
      
      await userRef.set(updatedUserData);
      
      const savedUserData = (await userRef.once('value')).val() || {};
      const savedStudentInfo = savedUserData.studentInfo || {};
      
      return res.json({
        success: true,
        data: {
          email: savedUserData.email || updatedUserData.email,
          fullName: savedUserData.name || updatedUserData.name || '',
          gender: savedStudentInfo.gender || updatedUserData.studentInfo.gender || '',
          studentNumber: savedStudentInfo.studentNumber || updatedUserData.studentInfo.studentNumber || '',
          batch: savedStudentInfo.batch || updatedUserData.studentInfo.batch || '',
          address: savedStudentInfo.address || updatedUserData.studentInfo.address || '',
          contactNumber: savedStudentInfo.contactNumber || updatedUserData.studentInfo.contactNumber || '',
          birthday: savedStudentInfo.birthday || updatedUserData.studentInfo.birthday || '',
          profilePicture: savedUserData.profilePicture || null,
          profileCompletion: completionScore,
          isVerified: savedUserData.verified || (completionScore >= 80)
        }
      });
    }

    // For students, update students database
    const studentRef = db.ref(`students/${req.userId}`);
    const snapshot = await studentRef.once('value');
    const studentExisting = snapshot.val() || {};

    // Ensure email is preserved
    const updatedData = {
      ...studentExisting,
      email: req.user.email || studentExisting.email,
      fullName: fullName !== undefined ? fullName : studentExisting.fullName,
      gender: gender !== undefined ? gender : studentExisting.gender,
      studentNumber: studentNumber !== undefined ? studentNumber : studentExisting.studentNumber,
      batch: batch !== undefined ? batch : studentExisting.batch,
      address: address !== undefined ? address : studentExisting.address,
      contactNumber: contactNumber !== undefined ? contactNumber : studentExisting.contactNumber,
      birthday: birthday !== undefined ? birthday : studentExisting.birthday,
      updatedAt: new Date().toISOString()
    };

    // Update profile picture if provided (can be null to remove)
    if (profilePicture !== undefined) {
      if (profilePicture === null || profilePicture === 'null') {
        // Remove profile picture
        delete updatedData.profilePicture;
        console.log('Removing profile picture from database');
      } else if (typeof profilePicture === 'string' && profilePicture.trim() !== '') {
        // Save profile picture
        updatedData.profilePicture = profilePicture;
        console.log('Saving profile picture to database, length:', profilePicture.length);
      }
    }

    await studentRef.set(updatedData);
    
    // Verify what was saved
    const verifySnapshot = await studentRef.once('value');
    const savedData = verifySnapshot.val() || {};
    console.log('Profile saved. ProfilePicture in saved data:', savedData.hasOwnProperty('profilePicture') ? 'Yes (length: ' + (savedData.profilePicture?.length || 0) + ')' : 'No');

    // Calculate profile completion based on actual fields filled
    // When user updates profile, calculate properly (can reach 100%)
    let completionScore = 0;
    if (updatedData.email) completionScore += 15;
    if (updatedData.fullName) completionScore += 15;
    if (updatedData.gender) completionScore += 10;
    if (updatedData.studentNumber) completionScore += 15;
    if (updatedData.batch) completionScore += 10;
    if (updatedData.address) completionScore += 10;
    if (updatedData.contactNumber) completionScore += 10;
    if (updatedData.birthday) completionScore += 15;

    // Auto-verify if completion is 80%+ (but don't force 50% if user updates)
    if (completionScore >= 80) {
      updatedData.isVerified = true;
      await studentRef.set(updatedData);
    }

    // Ensure profilePicture is included in response (can be null)
    // Use savedData (what we just verified from database) instead of updatedData
    let profilePictureValue = null;
    if (savedData.hasOwnProperty('profilePicture') && savedData.profilePicture) {
      profilePictureValue = savedData.profilePicture;
      console.log('Profile picture found in saved data, length:', profilePictureValue.length);
    } else {
      console.log('No profile picture in saved data');
    }
    
    const responseData = {
      email: savedData.email || updatedData.email,
      fullName: savedData.fullName || updatedData.fullName || '',
      gender: savedData.gender || updatedData.gender || '',
      studentNumber: savedData.studentNumber || updatedData.studentNumber || '',
      batch: savedData.batch || updatedData.batch || '',
      address: savedData.address || updatedData.address || '',
      contactNumber: savedData.contactNumber || updatedData.contactNumber || '',
      birthday: savedData.birthday || updatedData.birthday || '',
      profilePicture: profilePictureValue,
      profileCompletion: completionScore,
      isVerified: savedData.isVerified || updatedData.isVerified || completionScore >= 80
    };

    console.log('Sending profile update response, profilePicture:', responseData.profilePicture ? 'Exists (' + (responseData.profilePicture.length || 0) + ' chars)' : 'null');

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;

