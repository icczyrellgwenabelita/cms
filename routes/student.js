const express = require('express');
const router = express.Router();
const { verifyStudentToken } = require('../middleware/auth');
const { db } = require('../config/firebase');
async function getUserData(userId) {
  const studentRef = db.ref(`students/${userId}`);
  const studentSnapshot = await studentRef.once('value');
  let studentData = studentSnapshot.val();
  let isUser = false;
  if (!studentData) {
    const userRef = db.ref(`users/${userId}`);
    const userSnapshot = await userRef.once('value');
    const userData = userSnapshot.val();
    
    if (userData) {
      isUser = true;
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
        _userData: userData
      };
    }
  }
  return { studentData, isUser };
}
router.get('/dashboard', verifyStudentToken, async (req, res) => {
  try {
    console.log('Dashboard request received for userId:', req.userId);
    
    const { studentData: data, isUser } = await getUserData(req.userId);
    let studentData = data;
    console.log('Raw studentData from Firebase:', JSON.stringify(studentData ? Object.keys(studentData) : 'null'));
    console.log('Is user from users database:', isUser);
    if (!studentData) {
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
        const lessonsRef = db.ref('lessons');
        const lessonsSnapshot = await lessonsRef.once('value');
        const allLessons = lessonsSnapshot.val() || {};
        
        const lessons = [];
        for (let i = 1; i <= 6; i++) {
          const lesson = allLessons[i];
          
          const lessonData = {
            slot: i
          };
          
          if (lesson && lesson.lessonName) {
            lessonData.lessonName = lesson.lessonName;
            if (lesson.lessonDescription) {
              lessonData.lessonDescription = lesson.lessonDescription;
            }
          }
          
          let progress = null;
          if (isUser) {
            const userProgressRef = db.ref(`users/${req.userId}/progress/lesson${i}`);
            const userProgressSnapshot = await userProgressRef.once('value');
            const userProgress = userProgressSnapshot.val();
            
            console.log(`Lesson ${i} progress from users DB:`, JSON.stringify(userProgress));
            
            if (userProgress) {
              const quizCompleted = userProgress.quiz?.completed || false;
              const simCompleted = userProgress.simulation?.completed || false;
              const quizAttempts = userProgress.quiz?.attempts || 0;
              const simAttempts = userProgress.simulation?.attempts || 0;
              
              console.log(`Lesson ${i} - Quiz completed: ${quizCompleted}, Sim completed: ${simCompleted}, Quiz attempts: ${quizAttempts}, Sim attempts: ${simAttempts}`);
              
              let status = 'not_started';
              if (quizCompleted && simCompleted) {
                status = 'completed';
                console.log(`Lesson ${i} - Status: completed (both quiz and sim completed)`);
              } else if (quizCompleted || simCompleted || quizAttempts > 0 || simAttempts > 0) {
                status = 'in_progress';
                console.log(`Lesson ${i} - Status: in_progress (one or both incomplete)`);
              } else {
                console.log(`Lesson ${i} - Status: not_started (no attempts)`);
              }
              
              progress = {
                status: status,
                quizScore: userProgress.quiz?.highestScore || null
              };
              
              console.log(`Lesson ${i} - Final progress object:`, JSON.stringify(progress));
            } else {
              console.log(`Lesson ${i} - No progress data found in users database`);
            }
          } else {
            const lessonProgressRef = db.ref(`students/${req.userId}/lessonProgress/${i}`);
            const progressSnapshot = await lessonProgressRef.once('value');
            progress = progressSnapshot.val();
            console.log(`Lesson ${i} progress from students DB:`, JSON.stringify(progress));
          }
          
          const classStatsRef = db.ref(`classStats/lessons/${i}`);
          const classStatsSnapshot = await classStatsRef.once('value');
          const classStats = classStatsSnapshot.val();
          
          if (progress && typeof progress === 'object' && progress !== null && 
              progress.status && typeof progress.status === 'string' && progress.status.trim() !== '') {
            lessonData.status = progress.status;
          } else {
            lessonData.status = 'not_started';
          }
          
          if (progress && typeof progress === 'object' && progress !== null &&
              'quizScore' in progress && 
              progress.quizScore !== null && 
              progress.quizScore !== undefined && 
              typeof progress.quizScore === 'number' &&
              !isNaN(progress.quizScore)) {
            lessonData.quizScore = progress.quizScore;
          }
          
          if (classStats && typeof classStats === 'object' && classStats !== null) {
            if ('avgQuizGrade' in classStats &&
                classStats.avgQuizGrade !== null && 
                classStats.avgQuizGrade !== undefined && 
                typeof classStats.avgQuizGrade === 'number' &&
                !isNaN(classStats.avgQuizGrade)) {
              lessonData.avgClassGrade = classStats.avgQuizGrade;
            }
            
            if ('highestQuizGrade' in classStats &&
                classStats.highestQuizGrade !== null && 
                classStats.highestQuizGrade !== undefined && 
                typeof classStats.highestQuizGrade === 'number' &&
                !isNaN(classStats.highestQuizGrade)) {
              lessonData.highestGrade = classStats.highestQuizGrade;
            }
            
            if ('avgQuizTime' in classStats &&
                classStats.avgQuizTime !== null && 
                classStats.avgQuizTime !== undefined && 
                typeof classStats.avgQuizTime === 'number' &&
                !isNaN(classStats.avgQuizTime)) {
              lessonData.avgQuizTime = classStats.avgQuizTime;
            }
            
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
    let completionScore = 0;
    const isVerified = studentData.isVerified || studentData.verified || false;
    
    if (isVerified) {
      completionScore = 50;
    } else {
      if (studentData.email) completionScore += 15;
      if (studentData.fullName) completionScore += 15;
      if (studentData.gender) completionScore += 10;
      if (studentData.studentNumber) completionScore += 15;
      if (studentData.batch) completionScore += 10;
      if (studentData.address) completionScore += 10;
      if (studentData.contactNumber) completionScore += 10;
      if (studentData.birthday) completionScore += 15;
    }
    let profilePictureValue = null;
    console.log('Dashboard: Checking for profilePicture...');
    console.log('Dashboard: studentData type:', typeof studentData);
    console.log('Dashboard: studentData keys:', studentData ? Object.keys(studentData) : 'null');
    
    if (studentData && typeof studentData === 'object' && studentData !== null) {
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
    let completionScore = 0;
    const isVerified = studentData.isVerified || studentData.verified || false;
    
    if (isVerified) {
      completionScore = 50;
    } else {
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
router.put('/profile', verifyStudentToken, async (req, res) => {
  try {
    let { fullName, gender, studentNumber, batch, address, contactNumber, birthday, profilePicture } = req.body;
    if (typeof fullName === 'string') {
      fullName = fullName.trim();
    }
    const nameRegex = /^[A-Za-z\s]{1,60}$/;
    if (fullName && !nameRegex.test(fullName)) {
      return res.status(400).json({
        success: false,
        error: 'Full name must contain letters and spaces only (max 60 characters)'
      });
    }
    if (studentNumber && !/^\d+$/.test(studentNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Student number must contain only numbers'
      });
    }
    if (batch && !['2022', '2023', '2024', '2025'].includes(batch)) {
      return res.status(400).json({
        success: false,
        error: 'Batch must be one of: 2022, 2023, 2024, or 2025'
      });
    }
    let cleanedContactNumber = contactNumber;
    if (typeof contactNumber === 'string') {
      contactNumber = contactNumber.trim();
    }
    if (contactNumber) {
      const cleanContact = contactNumber.replace(/\D/g, '');
      if (cleanContact.length > 11) {
        return res.status(400).json({
          success: false,
          error: 'Contact number must be maximum 11 digits'
        });
      }
      if (cleanContact.length > 0 && !/^\d+$/.test(cleanContact)) {
        return res.status(400).json({
          success: false,
          error: 'Contact number must contain only numbers'
        });
      }
      cleanedContactNumber = cleanContact;
    }
    
    console.log('Profile update request received for userId:', req.userId);
    console.log('Profile update - ProfilePicture provided:', profilePicture !== undefined, 'Value:', profilePicture ? 'base64 string (' + profilePicture.length + ' chars)' : profilePicture);
    
    const { studentData: data, isUser } = await getUserData(req.userId);
    const existing = data || {};
    
    console.log('Profile update - Is user from users database:', isUser);
    console.log('Profile update - Existing data keys:', Object.keys(existing));
    if (isUser) {
      const userRef = db.ref(`users/${req.userId}`);
      const userSnapshot = await userRef.once('value');
      const userData = userSnapshot.val() || {};
      const existingStudentInfo = userData.studentInfo || {};
      
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
          contactNumber: contactNumber !== undefined ? cleanedContactNumber : existingStudentInfo.contactNumber,
          birthday: birthday !== undefined ? birthday : existingStudentInfo.birthday
        }
      };
      
      if (profilePicture !== undefined) {
        if (profilePicture === null || profilePicture === 'null') {
          delete updatedUserData.profilePicture;
        } else if (typeof profilePicture === 'string' && profilePicture.trim() !== '') {
          updatedUserData.profilePicture = profilePicture;
        }
      }
      
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
    const studentRef = db.ref(`students/${req.userId}`);
    const snapshot = await studentRef.once('value');
    const studentExisting = snapshot.val() || {};
    const updatedData = {
      ...studentExisting,
      email: req.user.email || studentExisting.email,
      fullName: fullName !== undefined ? fullName : studentExisting.fullName,
      gender: gender !== undefined ? gender : studentExisting.gender,
      studentNumber: studentNumber !== undefined ? studentNumber : studentExisting.studentNumber,
      batch: batch !== undefined ? batch : studentExisting.batch,
      address: address !== undefined ? address : studentExisting.address,
      contactNumber: contactNumber !== undefined ? cleanedContactNumber : studentExisting.contactNumber,
      birthday: birthday !== undefined ? birthday : studentExisting.birthday,
      updatedAt: new Date().toISOString()
    };
    if (profilePicture !== undefined) {
      if (profilePicture === null || profilePicture === 'null') {
        delete updatedData.profilePicture;
        console.log('Removing profile picture from database');
      } else if (typeof profilePicture === 'string' && profilePicture.trim() !== '') {
        updatedData.profilePicture = profilePicture;
        console.log('Saving profile picture to database, length:', profilePicture.length);
      }
    }
    await studentRef.set(updatedData);
    
    const verifySnapshot = await studentRef.once('value');
    const savedData = verifySnapshot.val() || {};
    console.log('Profile saved. ProfilePicture in saved data:', savedData.hasOwnProperty('profilePicture') ? 'Yes (length: ' + (savedData.profilePicture?.length || 0) + ')' : 'No');
    let completionScore = 0;
    if (updatedData.email) completionScore += 15;
    if (updatedData.fullName) completionScore += 15;
    if (updatedData.gender) completionScore += 10;
    if (updatedData.studentNumber) completionScore += 15;
    if (updatedData.batch) completionScore += 10;
    if (updatedData.address) completionScore += 10;
    if (updatedData.contactNumber) completionScore += 10;
    if (updatedData.birthday) completionScore += 15;
    if (completionScore >= 80) {
      updatedData.isVerified = true;
      await studentRef.set(updatedData);
    }
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