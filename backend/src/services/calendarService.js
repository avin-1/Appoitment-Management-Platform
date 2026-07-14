const { google } = require('googleapis');
const supabase = require('../config/supabase');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// Define the scopes required for calendar access
const scopes = [
    'https://www.googleapis.com/auth/calendar'
];

/**
 * Returns the Google Auth URL for the consent screen.
 */
exports.getAuthUrl = (userId) => {
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes,
        state: userId // pass user ID as state to link token on callback
    });
};

/**
 * Handles the OAuth callback, exchanges code for tokens, and saves them.
 */
exports.handleCallback = async (code, userId) => {
    try {
        const { tokens } = await oauth2Client.getToken(code);
        
        // Save to Supabase
        const { error } = await supabase.from('google_oauth_tokens').upsert({
            user_id: userId,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expiry: new Date(tokens.expiry_date).toISOString()
        });

        if (error) throw error;
        
        return tokens;
    } catch (error) {
        console.error("Google OAuth Callback Error:", error.message);
        throw new Error('Failed to process Google OAuth callback');
    }
};

/**
 * Helper function to set credentials for a specific user.
 */
const setCredentialsForUser = async (userId) => {
    const { data: tokenData, error } = await supabase
        .from('google_oauth_tokens')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (error || !tokenData) {
        throw new Error('User has not connected Google Calendar');
    }

    const client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    client.setCredentials({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expiry_date: new Date(tokenData.token_expiry).getTime()
    });

    // Handle token refresh automatically by googleapis
    client.on('tokens', async (tokens) => {
        if (tokens.refresh_token) {
            await supabase.from('google_oauth_tokens').update({
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                token_expiry: new Date(tokens.expiry_date).toISOString()
            }).eq('user_id', userId);
        } else {
            await supabase.from('google_oauth_tokens').update({
                access_token: tokens.access_token,
                token_expiry: new Date(tokens.expiry_date).toISOString()
            }).eq('user_id', userId);
        }
    });

    return google.calendar({ version: 'v3', auth: client });
};

/**
 * Create a calendar event for a user.
 */
exports.createEvent = async (userId, eventDetails) => {
    try {
        const calendar = await setCredentialsForUser(userId);
        const response = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: eventDetails,
        });
        return response.data;
    } catch (error) {
        console.error("Error creating Google Calendar event:", error.message);
        return null; // Return null gracefully to avoid breaking the main flow
    }
};

/**
 * Update a calendar event for a user.
 */
exports.updateEvent = async (userId, eventId, eventDetails) => {
    try {
        const calendar = await setCredentialsForUser(userId);
        const response = await calendar.events.update({
            calendarId: 'primary',
            eventId: eventId,
            requestBody: eventDetails,
        });
        return response.data;
    } catch (error) {
        console.error("Error updating Google Calendar event:", error.message);
        return null;
    }
};

/**
 * Delete a calendar event for a user.
 */
exports.deleteEvent = async (userId, eventId) => {
    try {
        const calendar = await setCredentialsForUser(userId);
        await calendar.events.delete({
            calendarId: 'primary',
            eventId: eventId,
        });
        return true;
    } catch (error) {
        console.error("Error deleting Google Calendar event:", error.message);
        return false;
    }
};
