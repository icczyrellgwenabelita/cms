const express = require('express');
const router = express.Router();
const { verifyStudentToken } = require('../middleware/auth');
const { db } = require('../config/firebase');

// Get student dashboard data
router.get('/dashboard', verifyStudentToken, async (req, res) => {
  try {
    console.log('Dashboard request received for userId:', req.userId);
    const studentRef = db.ref(`students/${req.userId}`);
    const snapshot = await studentRef.once('value');
    let studentData = snapshot.val();

    console.log('Raw studentData from Firebase:', JSON.stringify(studentData ? Object.keys(studentData) : 'null'));

    if (!studentData) {
      // Initialize student data
      studentData = {
        email: req.user.email,
        status: 'active',
        certificates: [],
        lessons: [],
        profileCompletion: 0,
        isVerified: false,
        createdAt: new Date().toISOString()
      };
      await studentRef.set(studentData);
      console.log('Created new student data entry');
    }

        // Get lessons data
        const lessonsRef = db.ref('lessons');
        const lessonsSnapshot = await lessonsRef.once('value');
        const allLessons = lessonsSnapshot.val() || {};
        
        // Map lessons with student progress - Always return 6 lessons
        // Only include data that exists in database
        const lessons = [];
        for (let i = 1; i <= 6; i++) {
          const lesson = allLessons[i];
          
          // Initialize lesson data with slot number
          const lessonData = {
            slot: i
          };
          
          // Only include lesson info if it exists in database
          if (lesson && lesson.lessonName) {
            lessonData.lessonName = lesson.lessonName;
            if (lesson.lessonDescription) {
              lessonData.lessonDescription = lesson.lessonDescription;
            }
            
            // Get student's lesson progress - check if data actually exists
            const lessonProgressRef = db.ref(`students/${req.userId}/lessonProgress/${i}`);
            const progressSnapshot = await lessonProgressRef.once('value');
            const progress = progressSnapshot.val();
            
            // Get class averages - check if data actually exists
            const classStatsRef = db.ref(`classStats/lessons/${i}`);
            const classStatsSnapshot = await classStatsRef.once('value');
            const classStats = classStatsSnapshot.val();
            
            // Only include status if progress exists, is an object, and has status field with a valid value
            if (progress && typeof progress === 'object' && progress !== null && 
                progress.status && typeof progress.status === 'string' && progress.status.trim() !== '') {
              lessonData.status = progress.status;
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
          }
          
          lessons.push(lessonData);
        }

    // Calculate profile completion
    let completionScore = 0;
    if (studentData.email) completionScore += 15;
    if (studentData.fullName) completionScore += 15;
    if (studentData.gender) completionScore += 10;
    if (studentData.studentNumber) completionScore += 15;
    if (studentData.batch) completionScore += 10;
    if (studentData.address) completionScore += 10;
    if (studentData.contactNumber) completionScore += 10;
    if (studentData.birthday) completionScore += 15;

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
      isVerified: studentData.isVerified || completionScore >= 80,
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

// Get student profile
router.get('/profile', verifyStudentToken, async (req, res) => {
  try {
    const studentRef = db.ref(`students/${req.userId}`);
    const snapshot = await studentRef.once('value');
    let studentData = snapshot.val();

    if (!studentData) {
      studentData = {
        email: req.user.email,
        status: 'active',
        createdAt: new Date().toISOString()
      };
      await studentRef.set(studentData);
    }

    // Calculate profile completion
    let completionScore = 0;
    if (studentData.email) completionScore += 15;
    if (studentData.fullName) completionScore += 15;
    if (studentData.gender) completionScore += 10;
    if (studentData.studentNumber) completionScore += 15;
    if (studentData.batch) completionScore += 10;
    if (studentData.address) completionScore += 10;
    if (studentData.contactNumber) completionScore += 10;
    if (studentData.birthday) completionScore += 15;

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
        isVerified: studentData.isVerified || completionScore >= 80
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update student profile
router.put('/profile', verifyStudentToken, async (req, res) => {
  try {
    const { fullName, gender, studentNumber, batch, address, contactNumber, birthday, profilePicture } = req.body;
    
    console.log('Profile update request received for userId:', req.userId);
    console.log('Profile update - ProfilePicture provided:', profilePicture !== undefined, 'Value:', profilePicture ? 'base64 string (' + profilePicture.length + ' chars)' : profilePicture);
    
    const studentRef = db.ref(`students/${req.userId}`);
    const snapshot = await studentRef.once('value');
    const existing = snapshot.val() || {};
    
    console.log('Profile update - Existing data keys:', Object.keys(existing));

    // Ensure email is preserved
    const updatedData = {
      ...existing,
      email: req.user.email || existing.email,
      fullName: fullName !== undefined ? fullName : existing.fullName,
      gender: gender !== undefined ? gender : existing.gender,
      studentNumber: studentNumber !== undefined ? studentNumber : existing.studentNumber,
      batch: batch !== undefined ? batch : existing.batch,
      address: address !== undefined ? address : existing.address,
      contactNumber: contactNumber !== undefined ? contactNumber : existing.contactNumber,
      birthday: birthday !== undefined ? birthday : existing.birthday,
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

    // Calculate profile completion
    let completionScore = 0;
    if (updatedData.email) completionScore += 15;
    if (updatedData.fullName) completionScore += 15;
    if (updatedData.gender) completionScore += 10;
    if (updatedData.studentNumber) completionScore += 15;
    if (updatedData.batch) completionScore += 10;
    if (updatedData.address) completionScore += 10;
    if (updatedData.contactNumber) completionScore += 10;
    if (updatedData.birthday) completionScore += 15;

    // Auto-verify if completion is 80%+
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

