// Configuration
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
let currentPrice = null;
let currentAccountType = 'demo'; // 'demo' or 'real'

// DOM Elements
const loginBtn = document.getElementById('connect-token-btn');
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
const apiTokenInput = document.getElementById('api-token');
const tokenSection = document.getElementById('token-section');
const accountSwitch = document.getElementById('account-switch');

// Event Listeners
if (loginBtn) loginBtn.addEventListener('click', connectWithToken);
if (startBtn) startBtn.addEventListener('click', startBot);
if (stopBtn) stopBtn.addEventListener('click', stopBot);
if (emergencyBtn) emergencyBtn.addEventListener('click', emergencyStop);
if (closeHigherBtn) closeHigherBtn.addEventListener('click', () => closeContract('higher'));
if (closeLowerBtn) closeLowerBtn.addEventListener('click', () => closeContract('lower'));
if (closeBothBtn) closeBothBtn.addEventListener('click', closeBothContracts);
if (demoBtn) demoBtn.addEventListener('click', () => switchAccount('demo'));
if (realBtn) realBtn.addEventListener('click', () => switchAccount('real'));

// Enter key support for token input
if (apiTokenInput) {
    apiTokenInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            connectWithToken();
        }
    });
}

// Check for existing token on load
window.addEventListener('load', () => {
    const token = localStorage.getItem('deriv_token');
    if (token) {
        apiTokenInput.value = token;
        connectWithToken();
    }
});

// Connect using API token
async function connectWithToken() {
    const token = apiTokenInput.value.trim();
    
    if (!token) {
        addLogEntry('Please enter your API token', 'system');
        return;
    }
    
    addLogEntry('Connecting with API token...', 'system');
    
    // Store token
    localStorage.setItem('deriv_token', token);
    
    // Connect WebSocket
    connectWebSocket(token);
}

// Connect WebSocket to Deriv
function connectWebSocket(token) {
    if (!token) {
        addLogEntry('No token found. Please enter your API token.', 'system');
        return;
    }
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    
    ws = new WebSocket('wss://ws.deriv.com/websockets/v3?app_id=1089');
    
    ws.onopen = () => {
        ws.send(JSON.stringify({ authorize: token }));
        addLogEntry('WebSocket connected, authorizing...', 'system');
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleDerivMessage(data);
    };
    
    ws.onerror = (error) => {
        addLogEntry('WebSocket error occurred', 'system');
        console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
        addLogEntry('WebSocket disconnected.', 'system');
        updateAuthStatus(false);
        enableControls(false);
        
        // Clear positions on disconnect
        currentPositions = { higher: null, lower: null };
        previousValues = { higher: 0, lower: 0 };
        
        // Reset displays
        const resetEls = ['higher-value', 'lower-value', 'higher-pnl', 'lower-pnl', 'combined-value', 'net-profit'];
        resetEls.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '$0.00';
        });
    };
}

// Handle messages from Deriv
function handleDerivMessage(data) {
    if (data.error) {
        addLogEntry(`API Error: ${data.error.message}`, 'system');
        
        // Handle invalid token
        if (data.error.code === 'InvalidToken' || data.error.message.includes('Invalid token')) {
            addLogEntry('Invalid API token. Please check your token and try again.', 'system');
            updateAuthStatus(false);
            enableControls(false);
            localStorage.removeItem('deriv_token');
        }
        return;
    }
    
    if (data.authorize) {
        // Determine account type from loginid
        const loginid = data.authorize.loginid;
        currentAccountType = loginid && loginid.startsWith('VRTC') ? 'demo' : 'real';
        
        updateAuthStatus(true);
        updateBalanceDisplay(data.authorize.balance);
        addLogEntry(`Authorized as ${data.authorize.email || data.authorize.loginid} (${currentAccountType.toUpperCase()} account)`, 'system');
        
        // Update account switch buttons
        if (currentAccountType === 'demo') {
            demoBtn.classList.add('active');
            realBtn.classList.remove('active');
        } else {
            realBtn.classList.add('active');
            demoBtn.classList.remove('active');
        }
        
        // Enable controls after successful auth
        enableControls(true);
        
        // Subscribe to price ticks
        ws.send(JSON.stringify({
            ticks: 1,
            subscribe: 1,
            symbol: "R_75"
        }));
        
        // Get balance updates
        ws.send(JSON.stringify({
            balance: 1,
            subscribe: 1
        }));
    }
    
    if (data.tick) {
        currentPrice = data.tick.quote;
        updatePriceDisplay(currentPrice);
    }
    
    if (data.proposal) {
        handleProposalResponse(data.proposal);
    }
    
    if (data.buy) {
        handleBuyResponse(data.buy);
    }
    
    if (data.sell) {
        handleSellResponse(data.sell);
    }
    
    if (data.contract) {
        updateContractValue(data.contract);
    }
    
    if (data.portfolio) {
        data.portfolio.contracts.forEach(contract => {
            updateContractValue(contract);
        });
    }
    
    if (data.balance) {
        updateBalanceDisplay(data.balance.balance);
    }
}

function updatePriceDisplay(price) {
    const priceEl = document.getElementById('current-price');
    if (priceEl) priceEl.textContent = `$${price.toFixed(2)}`;
}

function updateBalanceDisplay(balance) {
    const balanceEl = document.getElementById('account-balance');
    if (balanceEl) balanceEl.textContent = `$${parseFloat(balance).toFixed(2)}`;
}

async function startBot() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        addLogEntry('Please connect to Deriv first', 'system');
        return;
    }
    
    if (!currentPrice) {
        addLogEntry('Waiting for price feed...', 'system');
        return;
    }
    
    isBotRunning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    addLogEntry('Bot started. Monitoring for trades...', 'system');
    await placeHedgeTrade();
}

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

async function emergencyStop() {
    addLogEntry('⚠️ EMERGENCY STOP ACTIVATED', 'system');
    addLogEntry('Closing all positions...', 'system');
    
    if (currentPositions.higher && currentPositions.higher.id) {
        await closeContract('higher', true);
    }
    if (currentPositions.lower && currentPositions.lower.id) {
        await closeContract('lower', true);
    }
    stopBot();
}

async function placeHedgeTrade() {
    if (!isBotRunning) return;
    if (!currentPrice) {
        setTimeout(placeHedgeTrade, 1000);
        return;
    }
    
    const stake = parseFloat(stakeInput.value);
    const duration = parseInt(durationInput.value);
    const offset = parseFloat(offsetInput.value);
    
    const higherBarrier = (currentPrice + offset).toFixed(2);
    const lowerBarrier = (currentPrice - offset).toFixed(2);
    
    addLogEntry(`Placing trades at price ${currentPrice.toFixed(2)}`, 'system');
    addLogEntry(`  HIGHER barrier: ${higherBarrier}`, 'system');
    addLogEntry(`  LOWER barrier: ${lowerBarrier}`, 'system');
    
    ws.send(JSON.stringify({
        proposal: 1,
        amount: stake,
        barrier: higherBarrier,
        contract_type: "CALL",
        currency: "USD",
        duration: duration,
        duration_unit: "t",
        symbol: "R_75"
    }));
    
    setTimeout(() => {
        ws.send(JSON.stringify({
            proposal: 1,
            amount: stake,
            barrier: lowerBarrier,
            contract_type: "PUT",
            currency: "USD",
            duration: duration,
            duration_unit: "t",
            symbol: "R_75"
        }));
    }, 500);
}

function handleProposalResponse(proposal) {
    if (proposal && proposal.id) {
        ws.send(JSON.stringify({
            buy: proposal.id,
            price: proposal.ask_price
        }));
    }
}

function handleBuyResponse(buy) {
    const direction = buy.contract_type === 'CALL' ? 'higher' : 'lower';
    currentPositions[direction] = {
        id: buy.contract_id,
        entryPrice: buy.buy_price,
        barrier: buy.barrier,
        duration: buy.duration,
        buyTimestamp: Date.now()
    };
    
    addLogEntry(`${direction.toUpperCase()} contract purchased: $${buy.buy_price}`, 'system');
    
    ws.send(JSON.stringify({
        subscribe: 1,
        contract_id: buy.contract_id
    }));
    
    ws.send(JSON.stringify({
        portfolio: 1,
        subscribe: 1
    }));
    
    if (autoCloseToggle.checked && !autoCloseInterval) {
        autoCloseInterval = setInterval(checkAutoClose, 1000);
    }
}

function updateContractValue(contract) {
    const direction = contract.contract_type === 'CALL' ? 'higher' : 'lower';
    const currentValue = contract.sell_price || contract.current_spot || 0;
    const previousValue = previousValues[direction] || 0;
    const profit = currentValue - (contract.buy_price || 0);
    
    if (currentPositions[direction]) {
        currentPositions[direction].currentValue = currentValue;
        currentPositions[direction].ticksLeft = Math.max(0, contract.date_expiry - Math.floor(Date.now() / 1000));
        currentPositions[direction].profit = profit;
    }
    
    const change = currentValue - previousValue;
    
    updatePositionDisplay(direction, currentValue, profit, change, currentPositions[direction]?.ticksLeft || 0);
    
    if (change > 0) {
        showGlow(direction, 'gain');
    } else if (change < 0) {
        showGlow(direction, 'loss');
    }
    
    previousValues[direction] = currentValue;
    updateCombinedValues();
}

function showGlow(direction, type) {
    const element = document.getElementById(`${direction}-position`);
    if (!element) return;
    element.classList.remove('gain-glow', 'loss-glow');
    void element.offsetWidth;
    element.classList.add(`${type}-glow`);
}

function updatePositionDisplay(direction, value, profit, change, ticksLeft) {
    const valueEl = document.getElementById(`${direction}-value`);
    const pnlEl = document.getElementById(`${direction}-pnl`);
    const changeEl = document.getElementById(`${direction}-change`);
    const ticksEl = document.getElementById(`${direction}-ticks`);
    const barrierEl = document.getElementById(`${direction}-barrier`);
    
    if (valueEl) {
        valueEl.textContent = `$${value.toFixed(2)}`;
        valueEl.className = `value ${profit >= 0 ? 'gain' : 'loss'}`;
    }
    if (pnlEl) {
        pnlEl.textContent = `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`;
        pnlEl.className = `pnl ${profit >= 0 ? 'gain' : 'loss'}`;
    }
    if (changeEl) {
        changeEl.textContent = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}`;
        changeEl.className = `change ${change >= 0 ? 'positive' : 'negative'}`;
    }
    if (ticksEl) ticksEl.textContent = ticksLeft;
    if (barrierEl && currentPositions[direction]) barrierEl.textContent = currentPositions[direction].barrier;
}

function updateCombinedValues() {
    const higherValue = previousValues.higher || 0;
    const lowerValue = previousValues.lower || 0;
    const combinedValue = higherValue + lowerValue;
    const totalStake = parseFloat(stakeInput.value) * 2;
    const netProfit = combinedValue - totalStake;
    
    const combinedValueEl = document.getElementById('combined-value');
    const netProfitEl = document.getElementById('net-profit');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    
    if (combinedValueEl) combinedValueEl.textContent = `$${combinedValue.toFixed(2)}`;
    if (netProfitEl) {
        netProfitEl.textContent = `${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}`;
        netProfitEl.className = `net-profit ${netProfit >= 0 ? 'positive' : 'negative'}`;
    }
    
    const target = parseFloat(profitTargetInput.value);
    const progress = Math.min((netProfit / target) * 100, 100);
    if (progressFill) progressFill.style.width = `${Math.max(0, progress)}%`;
    if (progressText) progressText.textContent = `${Math.round(progress)}%`;
}

function checkAutoClose() {
    if (!autoCloseToggle.checked || !isBotRunning) return;
    
    const higherValue = previousValues.higher || 0;
    const lowerValue = previousValues.lower || 0;
    const combinedValue = higherValue + lowerValue;
    const totalStake = parseFloat(stakeInput.value) * 2;
    const netProfit = combinedValue - totalStake;
    const target = parseFloat(profitTargetInput.value);
    
    if (netProfit >= target) {
        addLogEntry(`🎯 AUTO-CLOSE TRIGGERED! Net profit $${netProfit.toFixed(2)} reached target $${target.toFixed(2)}`, 'win');
        closeBothContracts();
    }
}

async function closeContract(direction, isEmergency = false) {
    const position = currentPositions[direction];
    if (!position || !position.id) {
        addLogEntry(`No ${direction.toUpperCase()} contract to close`, 'system');
        return;
    }
    
    addLogEntry(`Closing ${direction.toUpperCase()} contract${isEmergency ? ' (EMERGENCY)' : ''}...`, 'system');
    ws.send(JSON.stringify({ sell: position.id }));
}

async function closeBothContracts() {
    let higherClosed = false, lowerClosed = false;
    
    if (currentPositions.higher && currentPositions.higher.id) {
        await closeContract('higher');
        higherClosed = true;
    }
    if (currentPositions.lower && currentPositions.lower.id) {
        await closeContract('lower');
        lowerClosed = true;
    }
    
    if (!higherClosed && !lowerClosed) {
        addLogEntry('No active contracts to close', 'system');
        return;
    }
    
    if (autoCloseInterval) {
        clearInterval(autoCloseInterval);
        autoCloseInterval = null;
    }
    
    setTimeout(() => {
        currentPositions = { higher: null, lower: null };
        previousValues = { higher: 0, lower: 0 };
        
        const resetEls = ['higher-value', 'lower-value', 'higher-pnl', 'lower-pnl', 'combined-value', 'net-profit'];
        resetEls.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '$0.00';
        });
        
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        if (progressFill) progressFill.style.width = '0%';
        if (progressText) progressText.textContent = '0%';
        
        if (isBotRunning) setTimeout(() => placeHedgeTrade(), 2000);
    }, 500);
}

function handleSellResponse(sell) {
    const profit = sell.sold_for - sell.bought_for;
    addLogEntry(`Contract closed. Sold for: $${sell.sold_for.toFixed(2)} (${profit >= 0 ? '+' : ''}$${profit.toFixed(2)})`, profit >= 0 ? 'win' : 'loss');
    
    sessionStats.totalTrades++;
    sessionStats.sessionPnL += profit;
    sessionStats.totalProfit += profit;
    if (profit > 0) sessionStats.wins++;
    updateStatsDisplay();
}

function updateStatsDisplay() {
    const winRate = sessionStats.totalTrades > 0 ? (sessionStats.wins / sessionStats.totalTrades * 100).toFixed(1) : 0;
    
    const totalTradesEl = document.getElementById('total-trades');
    const winRateEl = document.getElementById('win-rate');
    const totalProfitEl = document.getElementById('total-profit');
    const sessionPnLEl = document.getElementById('session-pnl');
    
    if (totalTradesEl) totalTradesEl.textContent = sessionStats.totalTrades;
    if (winRateEl) winRateEl.textContent = `${winRate}%`;
    if (totalProfitEl) {
        totalProfitEl.textContent = `$${sessionStats.totalProfit.toFixed(2)}`;
        totalProfitEl.className = `stat-value ${sessionStats.totalProfit >= 0 ? 'profit' : 'loss'}`;
    }
    if (sessionPnLEl) {
        sessionPnLEl.textContent = `${sessionStats.sessionPnL >= 0 ? '+' : ''}$${sessionStats.sessionPnL.toFixed(2)}`;
        sessionPnLEl.className = `stat-value ${sessionStats.sessionPnL >= 0 ? 'profit' : 'loss'}`;
    }
}

async function switchAccount(type) {
    addLogEntry(`Switching to ${type.toUpperCase()} account...`, 'system');
    ws.send(JSON.stringify({ switch_account: type === 'demo' ? 1 : 0 }));
    
    if (type === 'demo') {
        demoBtn.classList.add('active');
        realBtn.classList.remove('active');
        currentAccountType = 'demo';
    } else {
        realBtn.classList.add('active');
        demoBtn.classList.remove('active');
        currentAccountType = 'real';
    }
    
    sessionStats = { totalTrades: 0, wins: 0, totalProfit: 0, sessionPnL: 0 };
    updateStatsDisplay();
}

function updateAuthStatus(connected) {
    if (!authStatus) return;
    if (connected) {
        authStatus.className = 'auth-status connected';
        const statusSpan = authStatus.querySelector('span:last-child');
        if (statusSpan) statusSpan.textContent = 'Connected';
        if (tokenSection) tokenSection.style.display = 'none';
        if (accountSwitch) accountSwitch.style.display = 'flex';
    } else {
        authStatus.className = 'auth-status disconnected';
        const statusSpan = authStatus.querySelector('span:last-child');
        if (statusSpan) statusSpan.textContent = 'Disconnected';
        if (tokenSection) tokenSection.style.display = 'flex';
        if (accountSwitch) accountSwitch.style.display = 'none';
    }
}

function enableControls(enabled) {
    const inputs = [stakeInput, durationInput, offsetInput, profitTargetInput, autoCloseToggle];
    inputs.forEach(input => { if (input) input.disabled = !enabled; });
    if (startBtn) startBtn.disabled = !enabled;
    if (emergencyBtn) emergencyBtn.disabled = !enabled;
    if (closeHigherBtn) closeHigherBtn.disabled = !enabled;
    if (closeLowerBtn) closeLowerBtn.disabled = !enabled;
    if (closeBothBtn) closeBothBtn.disabled = !enabled;
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
