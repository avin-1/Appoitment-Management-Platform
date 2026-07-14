const calendarService = require('../services/calendarService');
const { asyncHandler } = require('../middlewares/errorMiddleware');

exports.getGoogleAuthUrl = asyncHandler(async (req, res) => {
    // The user's ID should be passed as a query param or extracted from JWT if protected
    // Here we'll assume it's passed as a query parameter for simplicity or extracted from auth middleware
    const userId = req.user ? req.user.id : req.query.userId;
    
    if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const url = calendarService.getAuthUrl(userId);
    res.status(200).json({ success: true, url });
});

exports.googleAuthCallback = asyncHandler(async (req, res) => {
    const code = req.query.code;
    const userId = req.query.state; // State contains the userId

    if (!code || !userId) {
        return res.status(400).json({ success: false, error: 'Code or User ID missing from callback' });
    }

    await calendarService.handleCallback(code, userId);
    
    // Redirect to frontend doctor dashboard
    res.redirect('http://localhost:5173/doctor?calendar_connected=true');
});
