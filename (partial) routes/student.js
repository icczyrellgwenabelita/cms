// Get LMS assessment history for a specific lesson page
router.get('/lessons/:slot/pages/:pageId/assessment-history', verifyStudentToken, async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const slot = parseInt(req.params.slot, 10);
    const { pageId } = req.params;

    if (!Number.isFinite(slot) || slot < 1) {
      return res.status(400).json({ error: 'Invalid slot number (must be >= 1)' });
    }

    const baseRef = db.ref(`users/${userId}/lmsAssessments/lesson${slot}/pages/${pageId}`);
    const [summarySnap, attemptsSnap] = await Promise.all([
      baseRef.child('summary').once('value'),
      baseRef.child('attempts').once('value')
    ]);

    const summary = summarySnap.val() || null;
    const attemptsVal = attemptsSnap.val() || {};

    if (!summary || !attemptsVal || Object.keys(attemptsVal).length === 0) {
      return res.json({
        success: true,
        summary: null,
        lastAttempt: null
      });
    }

    // Find last attempt by highest attemptNumber (fallback to latest key)
    let lastAttempt = null;
    Object.values(attemptsVal).forEach((attempt) => {
      if (!attempt) return;
      if (!lastAttempt || (attempt.attemptNumber || 0) > (lastAttempt.attemptNumber || 0)) {
        lastAttempt = attempt;
      }
    });

    return res.json({
      success: true,
      summary,
      lastAttempt: lastAttempt || null
    });
  } catch (error) {
    console.error('Error in GET /api/student/lessons/:slot/pages/:pageId/assessment-history:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});






