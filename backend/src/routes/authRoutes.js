const express = require('express');
const router = express.Router();
const oauthController = require('../controllers/oauthController');
const { protect } = require('../middlewares/authMiddleware');

// Get Auth URL - can be protected so only logged-in users can link their calendar
router.get('/google/url', protect, oauthController.getGoogleAuthUrl);

// Google Callback (cannot be protected via JWT as it's a redirect from Google)
router.get('/google/callback', oauthController.googleAuthCallback);

module.exports = router;
