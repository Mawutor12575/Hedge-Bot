const fetch = require('node-fetch');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    const { code } = req.query;
    
    if (!code) {
        return res.status(400).json({ error: 'No authorization code provided' });
    }
    
    try {
        const DERIV_APP_ID = '32OON3K9cYrXZrNK02Xvh';
        const REDIRECT_URI = `${req.headers.origin || 'https://' + req.headers.host}/api/auth/callback`;
        
        const response = await fetch('https://oauth.deriv.com/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
                client_id: DERIV_APP_ID,
            }),
        });
        
        const data = await response.json();
        
        if (data.access_token) {
            res.json({
                success: true,
                token: data.access_token,
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