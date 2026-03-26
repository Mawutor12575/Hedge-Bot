module.exports = async (req, res) => {
    res.json({ 
        status: 'ready',
        message: 'WebSocket endpoint. Connect to wss://ws.deriv.com/websockets/v3 directly from frontend.'
    });
};