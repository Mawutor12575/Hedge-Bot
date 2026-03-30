// Configuration
let ws = null;
let isConnected = false;
let currentToken = null;

// DOM Elements
const loginBtn = document.getElementById('connect-token-btn');
const authStatus = document.getElementById('auth-status');
const apiTokenInput = document.getElementById('api-token');
const tokenSection = document.getElementById('token-section');
const accountSwitch = document.getElementById('account-switch');
const startBtn = document.getElementById('start-bot');
const stopBtn = document.getElementById('stop-bot');
const marketSelect = document.getElementById('market-select');
const currentPriceEl = document.getElementById('current-price');

// Event Listeners
if (loginBtn) loginBtn.addEventListener('click', connectWithToken);
if (startBtn) startBtn.addEventListener('click', startBot);
if (stopBtn) stopBtn.addEventListener('click', stopBot);

// Load saved token
window.addEventListener('load', () => {
    const token = localStorage.getItem('deriv_token');
    if (token) {
        apiTokenInput.value = token;
        connectWithToken();
    }
});

async function connectWithToken() {
    const token = apiTokenInput.value.trim();
    if (!token) {
        addLogEntry('Please enter your API token', 'system');
        return;
    }
    
    addLogEntry('Connecting with API token...', 'system');
    localStorage.setItem('deriv_token', token);
    currentToken = token;
    connectWebSocket();
}

function connectWebSocket() {
    if (!currentToken) {
        addLogEntry('No token found', 'system');
        return;
    }
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    
    // Create WebSocket connection
    ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=84911');
    
    ws.onopen = () => {
        addLogEntry('WebSocket connected, authorizing...', 'system');
        // Send authorization
        ws.send(JSON.stringify({ 
            authorize: currentToken,
            req_id: 1
        }));
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('Received message:', data); // Debug log
            
            // Handle authorization response
            if (data.authorize) {
                isConnected = true;
                addLogEntry(`✅ Connected! Account: ${data.authorize.loginid}`, 'success');
                updateAuthStatus(true);
                
                // Subscribe to ticks for R_75
                ws.send(JSON.stringify({
                    ticks: 'R_75',
                    subscribe: 1,
                    req_id: 2
                }));
                
                // Request balance
                ws.send(JSON.stringify({ 
                    balance: 1, 
                    req_id: 3 
                }));
            }
            
            // Handle ticks
            if (data.tick) {
                const price = data.tick.quote;
                if (currentPriceEl) {
                    currentPriceEl.textContent = `$${price.toFixed(2)}`;
                }
                addLogEntry(`Tick: $${price.toFixed(2)}`, 'info');
            }
            
            // Handle balance
            if (data.balance) {
                const balanceEl = document.getElementById('account-balance');
                if (balanceEl) {
                    balanceEl.textContent = `$${data.balance.balance.toFixed(2)}`;
                }
            }
            
            // Handle errors
            if (data.error) {
                addLogEntry(`Error: ${data.error.message}`, 'error');
                if (data.error.code === 'InvalidToken') {
                    updateAuthStatus(false);
                    localStorage.removeItem('deriv_token');
                    if (ws) ws.close();
                }
            }
            
        } catch (error) {
            addLogEntry(`Parse error: ${error.message}`, 'error');
            console.error('Parse error:', error);
        }
    };
    
    ws.onerror = (error) => {
        addLogEntry('WebSocket error occurred', 'error');
        console.error('WebSocket error:', error);
    };
    
    ws.onclose = (event) => {
        addLogEntry(`WebSocket disconnected. Code: ${event.code}`, 'system');
        isConnected = false;
        updateAuthStatus(false);
        
        // Try to reconnect if we have a token
        if (currentToken) {
            addLogEntry('Attempting to reconnect in 3 seconds...', 'system');
            setTimeout(() => connectWebSocket(), 3000);
        }
    };
}

function startBot() {
    if (!isConnected) {
        addLogEntry('Please connect to Deriv first', 'system');
        return;
    }
    addLogEntry('Bot started (simplified mode)', 'success');
}

function stopBot() {
    addLogEntry('Bot stopped', 'system');
}

function updateAuthStatus(connected) {
    if (!authStatus) return;
    if (connected) {
        authStatus.className = 'auth-status connected';
        const statusSpan = authStatus.querySelector('span:last-child');
        if (statusSpan) statusSpan.textContent = 'Connected';
        if (tokenSection) tokenSection.style.display = 'none';
        if (accountSwitch) accountSwitch.style.display = 'flex';
        if (startBtn) startBtn.disabled = false;
    } else {
        authStatus.className = 'auth-status disconnected';
        const statusSpan = authStatus.querySelector('span:last-child');
        if (statusSpan) statusSpan.textContent = 'Disconnected';
        if (tokenSection) tokenSection.style.display = 'flex';
        if (accountSwitch) accountSwitch.style.display = 'none';
        if (startBtn) startBtn.disabled = true;
    }
}

function addLogEntry(message, type = 'system') {
    const logContainer = document.getElementById('trade-log');
    if (!logContainer) return;
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContainer.insertBefore(entry, logContainer.firstChild);
    
    while (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

// Make sure DOM elements exist
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, checking elements...');
    console.log('loginBtn:', loginBtn);
    console.log('apiTokenInput:', apiTokenInput);
});
