const fetch = require('node-fetch');

module.exports = async (req, res) => {
    const { code } = req.query;
    
    if (!code) {
        return res.status(400).json({ error: 'No authorization code provided' });
    }
    
    try {
        // Exchange code for access token
        const response = await fetch('https://oauth.deriv.com/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: process.env.REDIRECT_URI,
                client_id: process.env.DERIV_APP_ID,
                client_secret: process.env.DERIV_APP_SECRET,
            }),
        });
        
        const data = await response.json();
        
        if (data.access_token) {
            // Store token in session or return to frontend
            res.json({
                success: true,
                token: data.access_token,
                refresh_token: data.refresh_token,
                expires_in: data.expires_in
            });
        } else {
            res.json({
                success: false,
                error: data.error_description || 'Failed to get access token'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};