module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    res.json({
        status: 'ready',
        message: 'Trading API is active. Trading happens via WebSocket connection.'
    });
};