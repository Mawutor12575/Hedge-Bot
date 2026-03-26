// Configuration
const API_BASE = '/api';
let ws = null;
let isBotRunning = false;
let currentPositions = {
    higher: null,
    lower: null
};
let previousValues = {
    higher: 0,
    lower: 0
};
let sessionStats = {
    totalTrades: 0,
    wins: 0,
    totalProfit: 0,
    sessionPnL: 0
};
let autoCloseInterval = null;

// Deriv OAuth Configuration
const DERIV_APP_ID = 'YOUR_APP_ID'; // Replace with your Deriv App ID
const REDIRECT_URI = `${window.location.origin}/api/auth/callback`;
const DERIV_AUTH_URL = `https://oauth.deriv.com/oauth2/authorize?app_id=${DERIV_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=read write trade`;

// DOM Elements
const loginBtn = document.getElementById('login-btn');
const startBtn = document.getElementById('start-bot');
const stopBtn = document.getElementById('stop-bot');
const emergencyBtn = document.getElementById('emergency-stop');
const autoCloseToggle = document.getElementById('auto-close-toggle');
const profitTargetInput = document.getElementById('profit-target');
const stakeInput = document.getElementById('stake');
const durationInput = document.getElementById('duration');
const offsetInput = document.getElementById('offset');
const closeHigherBtn = document.getElementById('close-higher');
const closeLowerBtn = document.getElementById('close-lower');
const closeBothBtn = document.getElementById('close-both');
const demoBtn = document.getElementById('demo-btn');
const realBtn = document.getElementById('real-btn');
const authStatus = document.getElementById('auth-status');

// Check for OAuth callback
const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get('code');
if (code) {
    exchangeCodeForToken(code);
}

// Event Listeners
loginBtn.addEventListener('click', () => {
    window.location.href = DERIV_AUTH_URL;
});

startBtn.addEventListener('click', startBot);
stopBtn.addEventListener('click', stopBot);
emergencyBtn.addEventListener('click', emergencyStop);
closeHigherBtn.addEventListener('click', () => closeContract('higher'));
closeLowerBtn.addEventListener('click', () => closeContract('lower'));
closeBothBtn.addEventListener('click', closeBothContracts);

demoBtn.addEventListener('click', () => switchAccount('demo'));
realBtn.addEventListener('click', () => switchAccount('real'));

// Exchange authorization code for token
async function exchangeCodeForToken(code) {
    try {
        const response = await fetch(`${API_BASE}/auth/callback?code=${code}`);
        const data = await response.json();
        
        if (data.success) {
            localStorage.setItem('deriv_token', data.token);
            localStorage.setItem('deriv_refresh_token', data.refresh_token);
            connectWebSocket();
            updateAuthStatus(true);
            addLogEntry('Connected to Deriv successfully!', 'system');
            enableControls(true);
        } else {
            addLogEntry('Authentication failed: ' + data.error, 'system');
        }
    } catch (error) {
        addLogEntry('Authentication error: ' + error.message, 'system');
    }
}

// Connect WebSocket to Deriv
function connectWebSocket() {
    const token = localStorage.getItem('deriv_token');
    if (!token) return;
    
    ws = new WebSocket('wss://ws.deriv.com/websockets/v3');
    
    ws.onopen = () => {
        ws.send(JSON.stringify({
            authorize: token
        }));
        addLogEntry('WebSocket connected and authorized', 'system');
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleDerivMessage(data);
    };
    
    ws.onerror = (error) => {
        addLogEntry('WebSocket error: ' + error, 'system');
    };
    
    ws.onclose = () => {
        addLogEntry('WebSocket disconnected. Reconnecting in 5 seconds...', 'system');
        setTimeout(connectWebSocket, 5000);
    };
}

// Handle messages from Deriv
function handleDerivMessage(data) {
    if (data.error) {
        addLogEntry(`API Error: ${data.error.message}`, 'system');
        return;
    }
    
    // Handle authorization response
    if (data.authorize) {
        localStorage.setItem('deriv_balance', data.authorize.balance);
        updateBalanceDisplay(data.authorize.balance);
        addLogEntry(`Authorized as ${data.authorize.email}`, 'system');
    }
    
    // Handle proposal response
    if (data.proposal) {
        handleProposalResponse(data.proposal);
    }
    
    // Handle buy response
    if (data.buy) {
        handleBuyResponse(data.buy);
    }
    
    // Handle sell response
    if (data.sell) {
        handleSellResponse(data.sell);
    }
    
    // Handle portfolio updates
    if (data.portfolio) {
        updatePortfolio(data.portfolio);
    }
    
    // Handle contract updates
    if (data.contract) {
        updateContractValue(data.contract);
    }
}

// Start bot
async function startBot() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        addLogEntry('Please connect to Deriv first', 'system');
        return;
    }
    
    isBotRunning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    addLogEntry('Bot started. Monitoring for trades...', 'system');
    
    // Start trading loop
    await placeHedgeTrade();
}

// Stop bot
function stopBot() {
    isBotRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    addLogEntry('Bot stopped', 'system');
    
    if (autoCloseInterval) {
        clearInterval(autoCloseInterval);
        autoCloseInterval = null;
    }
}

// Emergency stop - close all positions and stop bot
async function emergencyStop() {
    addLogEntry('⚠️ EMERGENCY STOP ACTIVATED', 'system');
    
    if (currentPositions.higher) {
        await closeContract('higher', true);
    }
    if (currentPositions.lower) {
        await closeContract('lower', true);
    }
    
    stopBot();
}

// Place hedge trade (both higher and lower)
async function placeHedgeTrade() {
    if (!isBotRunning) return;
    
    const stake = parseFloat(stakeInput.value);
    const duration = parseInt(durationInput.value);
    const offset = parseFloat(offsetInput.value);
    
    // Get current price
    ws.send(JSON.stringify({
        ticks: 1,
        subscribe: 1
    }));
    
    // Wait for price then place trades
    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        if (data.tick) {
            const currentPrice = data.tick.quote;
            const higherBarrier = currentPrice + offset;
            const lowerBarrier = currentPrice - offset;
            
            // Place HIGHER trade
            ws.send(JSON.stringify({
                proposal: 1,
                amount: stake,
                barrier: higherBarrier.toFixed(2),
                contract_type: "CALL",
                currency: "USD",
                duration: duration,
                duration_unit: "t",
                symbol: "R_75"
            }));
            
            // Place LOWER trade (will be handled in separate message)
            ws.send(JSON.stringify({
                proposal: 1,
                amount: stake,
                barrier: lowerBarrier.toFixed(2),
                contract_type: "PUT",
                currency: "USD",
                duration: duration,
                duration_unit: "t",
                symbol: "R_75"
            }));
        }
    };
}

// Update contract values in real-time
function updateContractValue(contract) {
    const direction = contract.contract_type === 'CALL' ? 'higher' : 'lower';
    const currentValue = contract.sell_price || contract.buy_price;
    const previousValue = previousValues[direction];
    const profit = currentValue - contract.buy_price;
    
    // Store current position
    if (!currentPositions[direction]) {
        currentPositions[direction] = {
            id: contract.contract_id,
            entryPrice: contract.buy_price,
            barrier: contract.barrier,
            ticksLeft: contract.date_expiry - Math.floor(Date.now() / 1000)
        };
    } else {
        currentPositions[direction].ticksLeft = contract.date_expiry - Math.floor(Date.now() / 1000);
    }
    
    // Update UI with glow effect based on change
    const change = currentValue - previousValue;
    updatePositionDisplay(direction, currentValue, profit, change, currentPositions[direction].ticksLeft);
    
    // Trigger glow effect
    if (change > 0) {
        showGlow(direction, 'gain');
    } else if (change < 0) {
        showGlow(direction, 'loss');
    }
    
    previousValues[direction] = currentValue;
    
    // Update combined values
    updateCombinedValues();
    
    // Check auto-close condition
    if (autoCloseToggle.checked && isBotRunning) {
        checkAutoClose();
    }
}

// Show glow effect on position card
function showGlow(direction, type) {
    const element = document.getElementById(`${direction}-position`);
    element.classList.add(`${type}-glow`);
    setTimeout(() => {
        element.classList.remove(`${type}-glow`);
    }, 1000);
}

// Update position display
function updatePositionDisplay(direction, value, profit, change, ticksLeft) {
    const valueEl = document.getElementById(`${direction}-value`);
    const pnlEl = document.getElementById(`${direction}-pnl`);
    const changeEl = document.getElementById(`${direction}-change`);
    const ticksEl = document.getElementById(`${direction}-ticks`);
    const barrierEl = document.getElementById(`${direction}-barrier`);
    
    valueEl.textContent = `$${value.toFixed(2)}`;
    valueEl.className = `value ${profit >= 0 ? 'gain' : 'loss'}`;
    
    pnlEl.textContent = `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`;
    pnlEl.className = `pnl ${profit >= 0 ? 'gain' : 'loss'}`;
    
    changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}`;
    changeEl.className = `change ${change >= 0 ? 'positive' : 'negative'}`;
    
    ticksEl.textContent = ticksLeft;
    
    if (currentPositions[direction]) {
        barrierEl.textContent = currentPositions[direction].barrier;
    }
}

// Update combined values
function updateCombinedValues() {
    const higherValue = previousValues.higher || 0;
    const lowerValue = previousValues.lower || 0;
    const combinedValue = higherValue + lowerValue;
    const totalStake = parseFloat(stakeInput.value) * 2;
    const netProfit = combinedValue - totalStake;
    
    document.getElementById('combined-value').textContent = `$${combinedValue.toFixed(2)}`;
    const netProfitEl = document.getElementById('net-profit');
    netProfitEl.textContent = `${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}`;
    netProfitEl.className = `net-profit ${netProfit >= 0 ? 'positive' : 'negative'}`;
    
    // Update progress bar
    const target = parseFloat(profitTargetInput.value);
    const progress = Math.min((combinedValue / target) * 100, 100);
    document.getElementById('progress-fill').style.width = `${progress}%`;
    document.getElementById('progress-text').textContent = `${Math.round(progress)}%`;
}

// Check auto-close condition
function checkAutoClose() {
    const higherValue = previousValues.higher || 0;
    const lowerValue = previousValues.lower || 0;
    const combinedValue = higherValue + lowerValue;
    const target = parseFloat(profitTargetInput.value);
    
    if (combinedValue >= target) {
        addLogEntry(`Auto-close triggered! Combined value $${combinedValue.toFixed(2)} reached target $${target.toFixed(2)}`, 'system');
        closeBothContracts();
    }
}

// Close a single contract
async function closeContract(direction, isEmergency = false) {
    const position = currentPositions[direction];
    if (!position || !position.id) {
        addLogEntry(`No ${direction.toUpperCase()} contract to close`, 'system');
        return;
    }
    
    ws.send(JSON.stringify({
        sell: position.id,
        price: 0 // Deriv will calculate current price
    }));
    
    addLogEntry(`Closing ${direction.toUpperCase()} contract${isEmergency ? ' (EMERGENCY)' : ''}`, 'system');
}

// Close both contracts
async function closeBothContracts() {
    if (currentPositions.higher) {
        await closeContract('higher');
    }
    if (currentPositions.lower) {
        await closeContract('lower');
    }
    
    // Update statistics
    const higherValue = previousValues.higher || 0;
    const lowerValue = previousValues.lower || 0;
    const totalStake = parseFloat(stakeInput.value) * 2;
    const profit = (higherValue + lowerValue) - totalStake;
    
    sessionStats.totalTrades++;
    sessionStats.sessionPnL += profit;
    sessionStats.totalProfit += profit;
    
    if (profit > 0) {
        sessionStats.wins++;
        addLogEntry(`Hedge closed with profit: +$${profit.toFixed(2)}`, 'win');
    } else {
        addLogEntry(`Hedge closed with loss: $${profit.toFixed(2)}`, 'loss');
    }
    
    updateStatsDisplay();
    
    // Clear current positions
    currentPositions = { higher: null, lower: null };
    previousValues = { higher: 0, lower: 0 };
    
    // Reset displays
    document.getElementById('higher-value').textContent = '$0.00';
    document.getElementById('lower-value').textContent = '$0.00';
    document.getElementById('combined-value').textContent = '$0.00';
    document.getElementById('net-profit').textContent = '$0.00';
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-text').textContent = '0%';
    
    // Place next trade if bot is still running
    if (isBotRunning) {
        setTimeout(() => placeHedgeTrade(), 1000);
    }
}

// Update statistics display
function updateStatsDisplay() {
    const winRate = sessionStats.totalTrades > 0 
        ? (sessionStats.wins / sessionStats.totalTrades * 100).toFixed(1)
        : 0;
    
    document.getElementById('total-trades').textContent = sessionStats.totalTrades;
    document.getElementById('win-rate').textContent = `${winRate}%`;
    document.getElementById('total-profit').textContent = `$${sessionStats.totalProfit.toFixed(2)}`;
    document.getElementById('session-pnl').textContent = `${sessionStats.sessionPnL >= 0 ? '+' : ''}$${sessionStats.sessionPnL.toFixed(2)}`;
    document.getElementById('session-pnl').className = `stat-value ${sessionStats.sessionPnL >= 0 ? 'profit' : 'loss'}`;
}

// Switch between demo and real accounts
async function switchAccount(type) {
    ws.send(JSON.stringify({
        switch_account: type === 'demo' ? 1 : 0
    }));
    
    addLogEntry(`Switching to ${type.toUpperCase()} account...`, 'system');
    
    if (type === 'demo') {
        demoBtn.classList.add('active');
        realBtn.classList.remove('active');
    } else {
        realBtn.classList.add('active');
        demoBtn.classList.remove('active');
    }
}

// Update authentication status
function updateAuthStatus(connected) {
    if (connected) {
        authStatus.className = 'auth-status connected';
        authStatus.querySelector('span:last-child').textContent = 'Connected';
        loginBtn.style.display = 'none';
        document.getElementById('account-switch').style.display = 'flex';
    }
}

// Enable/disable controls
function enableControls(enabled) {
    const inputs = [stakeInput, durationInput, offsetInput, profitTargetInput, autoCloseToggle];
    inputs.forEach(input => input.disabled = !enabled);
    
    startBtn.disabled = !enabled;
    emergencyBtn.disabled = !enabled;
    closeHigherBtn.disabled = !enabled;
    closeLowerBtn.disabled = !enabled;
    closeBothBtn.disabled = !enabled;
}

// Add entry to trade log
function addLogEntry(message, type = 'system') {
    const logContainer = document.getElementById('trade-log');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContainer.insertBefore(entry, logContainer.firstChild);
    
    // Keep only last 50 entries
    while (logContainer.children.length > 50) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

// Update balance display
function updateBalanceDisplay(balance) {
    const balanceEl = document.getElementById('account-balance');
    if (balanceEl) {
        balanceEl.textContent = `$${balance.toFixed(2)}`;
    }
}

// Handle proposal response
function handleProposalResponse(proposal) {
    // Store proposal ID for purchase
    if (proposal.id) {
        ws.send(JSON.stringify({
            buy: proposal.id,
            price: proposal.ask_price
        }));
    }
}

// Handle buy response
function handleBuyResponse(buy) {
    const direction = buy.contract_type === 'CALL' ? 'higher' : 'lower';
    currentPositions[direction] = {
        id: buy.contract_id,
        entryPrice: buy.buy_price,
        barrier: buy.barrier,
        ticksLeft: buy.duration
    };
    
    addLogEntry(`${direction.toUpperCase()} contract purchased: $${buy.buy_price}`, 'system');
    
    // Subscribe to contract updates
    ws.send(JSON.stringify({
        subscribe: 1,
        contract_id: buy.contract_id
    }));
}

// Handle sell response
function handleSellResponse(sell) {
    const profit = sell.sold_for - sell.bought_for;
    addLogEntry(`Contract closed. Sold for: $${sell.sold_for.toFixed(2)} (${profit >= 0 ? '+' : ''}$${profit.toFixed(2)})`, profit >= 0 ? 'win' : 'loss');
}

// Update portfolio
function updatePortfolio(portfolio) {
    // Update open positions
    portfolio.contracts.forEach(contract => {
        updateContractValue(contract);
    });
}