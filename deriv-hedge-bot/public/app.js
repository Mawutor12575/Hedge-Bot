// INTELLIGENT DERIV HEDGE BOT v2.1 - FULL PRODUCTION CODE (FIXED)
// All issues resolved: small profits accepted, manual/smart barrier toggle added dynamically,
// stop/emergency buttons fully functional, auto-close toggle works, tick display optimized & faster

let ws = null;
let isBotRunning = false;
let currentPositions = { higher: null, lower: null };
let previousValues = { higher: 0, lower: 0 };
let sessionStats = { totalTrades: 0, wins: 0, totalProfit: 0, sessionPnL: 0 };
let autoCloseInterval = null;
let currentPrice = null;
let currentAccountType = 'demo';
let isConnected = false;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let reconnectDelay = 1000;
let currentSymbol = 'R_75';
let availableMarkets = [];
let tickHistory = [];
let maxTickHistory = 50;
let lastTenDigits = [];
let isTickDisplayPaused = false;
let tradingLock = false;
let recentChanges = [];
let useSmartOffset = true;   // default: smart mode ON (toggle added dynamically)

const TRADING_CONFIG = {
    minPayout: 1.0   // lowered so small profits are accepted
};

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
const marketSelect = document.getElementById('market-select');
const tickHistoryDiv = document.getElementById('tick-history');
const pauseTicksBtn = document.getElementById('pause-ticks-btn');
const lastTenDigitsSpan = document.getElementById('last-ten-digits');
const lastDigitDisplay = document.getElementById('last-digit-display');
const marketSymbolSpan = document.getElementById('market-symbol');
const volatilityDisplay = document.getElementById('volatility-display');
const avgMoveSpan = document.getElementById('avg-move');
const offsetHint = document.getElementById('offset-hint');

if (stakeInput) stakeInput.value = 1.00;
if (durationInput) durationInput.value = 8;
if (offsetInput) offsetInput.value = 1.00;
if (profitTargetInput) profitTargetInput.value = 4.00;

if (loginBtn) loginBtn.addEventListener('click', connectWithToken);
if (startBtn) startBtn.addEventListener('click', startBot);
if (stopBtn) stopBtn.addEventListener('click', stopBot);
if (emergencyBtn) emergencyBtn.addEventListener('click', emergencyStop);
if (closeHigherBtn) closeHigherBtn.addEventListener('click', () => closeContract('higher'));
if (closeLowerBtn) closeLowerBtn.addEventListener('click', () => closeContract('lower'));
if (closeBothBtn) closeBothBtn.addEventListener('click', closeBothContracts);
if (demoBtn) demoBtn.addEventListener('click', () => switchAccount('demo'));
if (realBtn) realBtn.addEventListener('click', () => switchAccount('real'));
if (marketSelect) marketSelect.addEventListener('change', onMarketChange);
if (pauseTicksBtn) pauseTicksBtn.addEventListener('click', toggleTickDisplay);

if (apiTokenInput) {
    apiTokenInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') connectWithToken();
    });
}

window.addEventListener('load', () => {
    const token = localStorage.getItem('deriv_token');
    if (token) {
        apiTokenInput.value = token;
        connectWithToken();
    }
    loadAvailableMarkets();

    // Dynamically add Smart Offset toggle right after the offset input (no HTML change needed)
    if (offsetInput && offsetInput.parentElement) {
        const toggleHTML = `
            <div class="toggle-group" style="margin-top: 8px; display: flex; align-items: center; gap: 10px;">
                <label style="font-size: 12px; color: #00ccff;">Use Smart Offset</label>
                <div class="toggle-switch">
                    <input type="checkbox" id="smart-offset-toggle" checked>
                    <span class="toggle-slider"></span>
                </div>
                <small id="smart-status-text" style="font-size:10px; color:#00ff88;">(auto-adjusted by volatility)</small>
            </div>`;
        offsetInput.parentElement.insertAdjacentHTML('afterend', toggleHTML);

        const smartToggle = document.getElementById('smart-offset-toggle');
        if (smartToggle) {
            smartToggle.addEventListener('change', () => {
                useSmartOffset = smartToggle.checked;
                addLogEntry(`Smart Offset ${useSmartOffset ? 'ENABLED (volatility adaptive)' : 'DISABLED (manual barrier only)'}`, 'system');
            });
        }
    }
});

async function loadAvailableMarkets() {
    addLogEntry('Loading available markets...', 'system');
    
    const testWs = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=84911');
    
    testWs.onopen = () => {
        testWs.send(JSON.stringify({
            active_symbols: 'brief',
            product_type: 'basic',
            req_id: Date.now()
        }));
    };
    
    testWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.active_symbols) {
            const syntheticIndices = data.active_symbols.filter(symbol => 
                symbol.market === 'synthetic' || 
                symbol.display_name.includes('Volatility') ||
                symbol.display_name.includes('Jump')
            );
            
            availableMarkets = syntheticIndices;
            populateMarketDropdown();
            addLogEntry(`Loaded ${availableMarkets.length} synthetic indices`, 'system');
            testWs.close();
        }
    };
    
    testWs.onerror = () => {
        addLogEntry('Failed to load markets, using default', 'system');
        availableMarkets = [
            { symbol: 'R_75', display_name: 'Volatility 75 Index' },
            { symbol: 'R_50', display_name: 'Volatility 50 Index' },
            { symbol: 'R_100', display_name: 'Volatility 100 Index' },
            { symbol: 'R_25', display_name: 'Volatility 25 Index' },
            { symbol: 'R_10', display_name: 'Volatility 10 Index' }
        ];
        populateMarketDropdown();
    };
    
    setTimeout(() => {
        if (availableMarkets.length === 0) testWs.close();
    }, 5000);
}

function populateMarketDropdown() {
    if (!marketSelect) return;
    
    marketSelect.innerHTML = '';
    availableMarkets.forEach(market => {
        const option = document.createElement('option');
        option.value = market.symbol;
        option.textContent = market.display_name;
        marketSelect.appendChild(option);
    });
    
    const defaultOption = Array.from(marketSelect.options).find(opt => opt.value === 'R_75');
    if (defaultOption) {
        marketSelect.value = 'R_75';
        currentSymbol = 'R_75';
        if (marketSymbolSpan) marketSymbolSpan.textContent = 'R_75';
    }
}

function onMarketChange() {
    if (!marketSelect) return;
    
    if (isBotRunning && (currentPositions.higher || currentPositions.lower)) {
        addLogEntry('Cannot switch market while positions are open. Stop bot first.', 'system');
        marketSelect.value = currentSymbol;
        return;
    }
    
    currentSymbol = marketSelect.value;
    if (marketSymbolSpan) marketSymbolSpan.textContent = currentSymbol;
    
    addLogEntry(`Switched to market: ${marketSelect.options[marketSelect.selectedIndex].textContent} (${currentSymbol})`, 'system');
    
    if (ws && ws.readyState === WebSocket.OPEN && isConnected) {
        subscribeToTicks();
    }
}

function subscribeToTicks() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    tickHistory = [];
    recentChanges = [];
    lastTenDigits = [];
    updateTickDisplay();
    
    ws.send(JSON.stringify({
        forget_all: 'ticks',
        req_id: Date.now()
    }));
    
    ws.send(JSON.stringify({
        ticks: currentSymbol,
        subscribe: 1,
        req_id: Date.now()
    }));
    
    addLogEntry(`Subscribed to ${currentSymbol} ticks`, 'system');
}

function handleTick(data) {
    if (!data.tick || !data.tick.quote) return;
    
    currentPrice = data.tick.quote;
    updatePriceDisplay(currentPrice);
    
    const previousPrice = tickHistory[0] ? tickHistory[0].price : currentPrice;
    const change = currentPrice - previousPrice;
    
    const tickData = {
        price: currentPrice,
        time: Date.now(),
        change: change
    };
    
    tickHistory.unshift(tickData);
    if (tickHistory.length > maxTickHistory) tickHistory.pop();
    
    recentChanges.unshift(Math.abs(change));
    if (recentChanges.length > 30) recentChanges.pop();
    
    const avgVol = recentChanges.length ? (recentChanges.reduce((a, b) => a + b, 0) / recentChanges.length) : 0;
    if (volatilityDisplay) volatilityDisplay.textContent = avgVol.toFixed(3);
    if (avgMoveSpan) avgMoveSpan.textContent = avgVol.toFixed(3);
    
    const priceStr = currentPrice.toFixed(2);
    const lastDigit = priceStr.slice(-1);
    if (lastDigitDisplay) lastDigitDisplay.textContent = lastDigit;
    
    if (!isNaN(parseInt(lastDigit))) {
        lastTenDigits.unshift(lastDigit);
        if (lastTenDigits.length > 10) lastTenDigits.pop();
        if (lastTenDigitsSpan) lastTenDigitsSpan.textContent = lastTenDigits.join(' ');
    }
    
    if (!isTickDisplayPaused) updateTickDisplay();
    
    if (currentPositions.higher) currentPositions.higher.ticksElapsed = (currentPositions.higher.ticksElapsed || 0) + 1;
    if (currentPositions.lower) currentPositions.lower.ticksElapsed = (currentPositions.lower.ticksElapsed || 0) + 1;
    
    updateTickIndicators();
    updateContractValueFromTick();
}

function getCurrentVolatility() {
    if (recentChanges.length < 5) return 1.0;
    return recentChanges.reduce((a, b) => a + b, 0) / recentChanges.length;
}

function calculateSmartOffset() {
    const vol = getCurrentVolatility();
    let smart = Math.max(0.6, vol * 2.2);
    return Math.round(smart * 10) / 10;
}

function updateTickIndicators() {
    if (currentPositions.higher && currentPositions.higher.ticksElapsed !== undefined) {
        updateTickCircles('higher', currentPositions.higher.ticksElapsed, currentPositions.higher.profit || 0);
    }
    if (currentPositions.lower && currentPositions.lower.ticksElapsed !== undefined) {
        updateTickCircles('lower', currentPositions.lower.ticksElapsed, currentPositions.lower.profit || 0);
    }
}

function updateTickDisplay() {
    if (!tickHistoryDiv) return;
    
    if (tickHistory.length === 0) {
        tickHistoryDiv.innerHTML = '<div class="tick-placeholder">Waiting for intelligent tick feed...</div>';
        return;
    }
    
    tickHistoryDiv.innerHTML = '';
    const recentTicks = tickHistory.slice(0, 12);  // reduced from 20 for speed
    
    recentTicks.forEach((tick) => {
        const tickElement = document.createElement('div');
        tickElement.className = 'tick-item';
        const changeClass = tick.change >= 0 ? 'up' : 'down';
        tickElement.classList.add(changeClass);
        tickElement.innerHTML = `
            <span class="tick-price">$${tick.price.toFixed(2)}</span>
            <span class="tick-change">${tick.change >= 0 ? '▲' : '▼'}${Math.abs(tick.change).toFixed(2)}</span>
        `;
        tickHistoryDiv.appendChild(tickElement);
    });
    
    tickHistoryDiv.scrollTop = 0;
}

function toggleTickDisplay() {
    isTickDisplayPaused = !isTickDisplayPaused;
    if (pauseTicksBtn) {
        if (isTickDisplayPaused) {
            pauseTicksBtn.textContent = 'Resume';
            pauseTicksBtn.style.background = '#ff4444';
            addLogEntry('Tick display paused', 'system');
        } else {
            pauseTicksBtn.textContent = 'Pause';
            pauseTicksBtn.style.background = '';
            updateTickDisplay();
            addLogEntry('Tick display resumed', 'system');
        }
    }
}

async function connectWithToken() {
    const token = apiTokenInput.value.trim();
    if (!token) {
        addLogEntry('Please enter your API token', 'system');
        return;
    }
    addLogEntry('Connecting with API token...', 'system');
    localStorage.setItem('deriv_token', token);
    connectWebSocket(token);
}

function connectWebSocket(token) {
    if (!token) {
        addLogEntry('No token found. Please enter your API token.', 'system');
        return;
    }
    
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    
    ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=84911');
    
    ws.onopen = () => {
        addLogEntry('WebSocket connected, authorizing...', 'system');
        ws.send(JSON.stringify({ 
            authorize: token,
            req_id: Date.now()
        }));
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleDerivMessage(data);
        } catch (error) {
            addLogEntry(`Error parsing message: ${error.message}`, 'system');
        }
    };
    
    ws.onerror = (error) => {
        addLogEntry('WebSocket error occurred', 'system');
        console.error('WebSocket error:', error);
    };
    
    ws.onclose = (event) => {
        addLogEntry(`WebSocket disconnected. Code: ${event.code}`, 'system');
        updateAuthStatus(false);
        enableControls(false);
        isConnected = false;
        
        currentPositions = { higher: null, lower: null };
        previousValues = { higher: 0, lower: 0 };
        
        const resetEls = ['higher-value', 'lower-value', 'higher-pnl', 'lower-pnl', 'combined-value', 'net-profit'];
        resetEls.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '$0.00';
        });
        
        if (isBotRunning && reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            addLogEntry(`Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})...`, 'system');
            setTimeout(() => connectWebSocket(token), reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        } else {
            reconnectAttempts = 0;
            reconnectDelay = 1000;
        }
    };
}

function handleDerivMessage(data) {
    if (data.error) {
        addLogEntry(`API Error: ${data.error.message}`, 'system');
        
        if (data.error.code === 'InvalidToken' || data.error.message.includes('Invalid token')) {
            addLogEntry('Invalid API token. Please check your token and try again.', 'system');
            updateAuthStatus(false);
            enableControls(false);
            localStorage.removeItem('deriv_token');
            if (ws) ws.close();
        }
        
        if (data.error.message.includes('barrier')) {
            tradingLock = false;
        }
        return;
    }
    
    if (data.authorize) {
        const loginid = data.authorize.loginid;
        currentAccountType = loginid && loginid.startsWith('VRTC') ? 'demo' : 'real';
        isConnected = true;
        reconnectAttempts = 0;
        reconnectDelay = 1000;
        
        updateAuthStatus(true);
        updateBalanceDisplay(data.authorize.balance);
        addLogEntry(`Authorized as ${data.authorize.email || data.authorize.loginid} (${currentAccountType.toUpperCase()} account)`, 'system');
        
        if (currentAccountType === 'demo') {
            if (demoBtn) demoBtn.classList.add('active');
            if (realBtn) realBtn.classList.remove('active');
        } else {
            if (realBtn) realBtn.classList.add('active');
            if (demoBtn) demoBtn.classList.remove('active');
        }
        
        enableControls(true);
        subscribeToTicks();
        
        ws.send(JSON.stringify({ balance: 1, req_id: Date.now() }));
    }
    
    if (data.tick) handleTick(data);
    
    if (data.proposal) {
        handleProposalResponse(data.proposal);
    }
    
    if (data.buy) handleBuyResponse(data.buy);
    
    if (data.proposal_open_contract) {
        const contract = data.proposal_open_contract;
        updateContractValueFromProposal(contract);
        
        if (contract.is_sold) {
            const profit = contract.profit || 0;
            addLogEntry(`Contract ${contract.contract_id} closed. ${profit >= 0 ? 'WIN' : 'LOSS'}: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`, profit >= 0 ? 'win' : 'loss');
            
            sessionStats.totalTrades++;
            sessionStats.sessionPnL += profit;
            sessionStats.totalProfit += profit;
            if (profit > 0) sessionStats.wins++;
            updateStatsDisplay();
            
            if (currentPositions.higher && currentPositions.higher.id === contract.contract_id) {
                currentPositions.higher = null;
            }
            if (currentPositions.lower && currentPositions.lower.id === contract.contract_id) {
                currentPositions.lower = null;
            }
            
            if (!currentPositions.higher && !currentPositions.lower && isBotRunning) {
                tradingLock = false;
                setTimeout(() => placeHedgeTrade(), 1500);
            }
        }
    }
    
    if (data.balance) updateBalanceDisplay(data.balance.balance);
    if (data.sell) handleSellResponse(data.sell);
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
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (emergencyBtn) emergencyBtn.disabled = false;
    
    addLogEntry('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'system');
    addLogEntry('INTELLIGENT HEDGE BOT STARTED', 'system');
    addLogEntry(`Market: ${marketSelect.options[marketSelect.selectedIndex]?.textContent || currentSymbol}`, 'system');
    addLogEntry(`Strategy: Volatility-adaptive parallel hedge`, 'system');
    addLogEntry(`Stake: $${stakeInput.value} each | Duration: ${durationInput.value} ticks`, 'system');
    addLogEntry(`Profit Target: $${profitTargetInput.value} | Smart offset: ${useSmartOffset ? 'ON' : 'OFF'}`, 'system');
    addLogEntry('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'system');
    
    const duration = parseInt(durationInput.value);
    createTickIndicators(duration);
    
    await placeHedgeTrade();
}

function createTickIndicators(duration) {
    const higherIndicator = document.getElementById('higher-tick-indicator');
    const lowerIndicator = document.getElementById('lower-tick-indicator');
    
    if (higherIndicator) {
        higherIndicator.innerHTML = '';
        for (let i = 0; i < duration; i++) {
            const circle = document.createElement('div');
            circle.className = 'tick-circle';
            higherIndicator.appendChild(circle);
        }
    }
    
    if (lowerIndicator) {
        lowerIndicator.innerHTML = '';
        for (let i = 0; i < duration; i++) {
            const circle = document.createElement('div');
            circle.className = 'tick-circle';
            lowerIndicator.appendChild(circle);
        }
    }
}

async function placeHedgeTrade() {
    if (!isBotRunning) return;
    if (tradingLock) {
        setTimeout(placeHedgeTrade, 1000);
        return;
    }
    
    if (!currentPrice) {
        setTimeout(placeHedgeTrade, 1000);
        return;
    }
    
    tradingLock = true;
    
    const stake = parseFloat(stakeInput.value);
    const duration = parseInt(durationInput.value);
    const offset = useSmartOffset ? calculateSmartOffset() : parseFloat(offsetInput.value) || 1.0;
    
    if (useSmartOffset && offsetHint) {
        offsetHint.textContent = `(smart: ${offset.toFixed(1)} pts)`;
    }
    
    const higherBarrier = `+${offset.toFixed(4)}`;
    const lowerBarrier = `-${offset.toFixed(4)}`;
    
    addLogEntry(`Placing intelligent hedge trade at $${currentPrice.toFixed(2)}`, 'system');
    addLogEntry(`HIGHER barrier: ${higherBarrier} | LOWER barrier: ${lowerBarrier}`, 'system');
    addLogEntry(`Duration: ${duration} ticks | Stake: $${stake} each`, 'system');
    
    ws.send(JSON.stringify({
        proposal: 1,
        amount: stake,
        basis: 'stake',
        contract_type: "CALL",
        currency: "USD",
        duration: duration,
        duration_unit: "t",
        symbol: currentSymbol,
        barrier: higherBarrier,
        req_id: Date.now()
    }));
    
    setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                proposal: 1,
                amount: stake,
                basis: 'stake',
                contract_type: "PUT",
                currency: "USD",
                duration: duration,
                duration_unit: "t",
                symbol: currentSymbol,
                barrier: lowerBarrier,
                req_id: Date.now()
            }));
        }
    }, 180);
}

function handleProposalResponse(proposal) {
    if (!proposal || proposal.error) {
        addLogEntry(`Proposal error: ${proposal?.error?.message || 'Unknown'}`, 'system');
        tradingLock = false;
        return;
    }
    
    const direction = proposal.contract_type === 'CALL' ? 'higher' : 'lower';
    const payout = parseFloat(proposal.payout);
    const askPrice = parseFloat(proposal.ask_price);
    const profitPotential = payout - askPrice;
    
    addLogEntry(`${direction.toUpperCase()} proposal: Payout $${payout.toFixed(2)} | Potential profit $${profitPotential.toFixed(2)}`, 'system');
    
    // ALWAYS buy - small profits are accepted as requested
    addLogEntry(`Accepting ${direction.toUpperCase()} proposal and purchasing...`, 'success');
    ws.send(JSON.stringify({
        buy: proposal.id,
        price: askPrice,
        req_id: Date.now()
    }));
}

function handleBuyResponse(buy) {
    const direction = buy.contract_type === 'CALL' ? 'higher' : 'lower';
    
    if (currentPositions[direction]) {
        tradingLock = false;
        return;
    }
    
    currentPositions[direction] = {
        id: buy.contract_id,
        entryPrice: buy.buy_price,
        barrier: buy.barrier,
        duration: buy.duration,
        buyTimestamp: Date.now(),
        contractType: buy.contract_type,
        ticksElapsed: 0,
        currentValue: buy.buy_price,
        profit: 0
    };
    
    addLogEntry(`✅ ${direction.toUpperCase()} contract purchased! ID: ${buy.contract_id}`, 'success');
    
    ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: buy.contract_id,
        req_id: Date.now()
    }));
    
    if (currentPositions.higher && currentPositions.lower && autoCloseToggle.checked && !autoCloseInterval) {
        autoCloseInterval = setInterval(checkAutoClose, 400);
    }
    
    tradingLock = false;
}

function updateContractValueFromTick() {
    if (currentPositions.higher) updateContractValueFromProposal({ contract_id: currentPositions.higher.id });
    if (currentPositions.lower) updateContractValueFromProposal({ contract_id: currentPositions.lower.id });
}

function updateContractValueFromProposal(contract) {
    let direction = null;
    if (currentPositions.higher && currentPositions.higher.id === contract.contract_id) direction = 'higher';
    else if (currentPositions.lower && currentPositions.lower.id === contract.contract_id) direction = 'lower';
    if (!direction) return;
    
    const pos = currentPositions[direction];
    const currentValue = contract.sell_price || contract.current_spot || pos.currentValue || 0;
    const profit = currentValue - (pos.entryPrice || 0);
    
    let ticksLeft = 0;
    if (contract.date_expiry) {
        ticksLeft = Math.max(0, contract.date_expiry - Math.floor(Date.now() / 1000));
    } else {
        ticksLeft = Math.max(0, pos.duration - (pos.ticksElapsed || 0));
    }
    
    pos.currentValue = currentValue;
    pos.profit = profit;
    pos.ticksLeft = ticksLeft;
    
    const change = currentValue - (previousValues[direction] || 0);
    
    updatePositionDisplay(direction, currentValue, profit, 0, change, ticksLeft);
    
    if (change > 0) showGlow(direction, 'gain');
    else if (change < 0) showGlow(direction, 'loss');
    
    previousValues[direction] = currentValue;
    updateCombinedValues();
}

function showGlow(direction, type) {
    const element = document.getElementById(`${direction}-position`);
    if (!element) return;
    element.classList.remove('gain-glow', 'loss-glow');
    void element.offsetWidth;
    element.classList.add(`${type}-glow`);
    setTimeout(() => element.classList.remove(`${type}-glow`), 1000);
}

function updatePositionDisplay(direction, value, profit, profitPercent, change, ticksLeft) {
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
        const changeSymbol = change >= 0 ? '▲' : '▼';
        changeEl.textContent = `${changeSymbol} $${Math.abs(change).toFixed(2)}`;
        changeEl.className = `change ${change >= 0 ? 'positive' : 'negative'}`;
    }
    if (ticksEl) ticksEl.textContent = ticksLeft;
    if (barrierEl && currentPositions[direction]) barrierEl.textContent = currentPositions[direction].barrier || '—';
}

function updateCombinedValues() {
    const higherProfit = currentPositions.higher?.profit || 0;
    const lowerProfit = currentPositions.lower?.profit || 0;
    const netProfit = higherProfit + lowerProfit;
    const combinedValue = (currentPositions.higher?.currentValue || 0) + (currentPositions.lower?.currentValue || 0);
    
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
    if (target > 0) {
        const progress = Math.min((netProfit / target) * 100, 100);
        if (progressFill) progressFill.style.width = `${Math.max(0, progress)}%`;
        if (progressText) progressText.textContent = `${Math.round(progress)}%`;
    }
}

function updateTickCircles(direction, ticksElapsed, profit) {
    const indicator = document.getElementById(`${direction}-tick-indicator`);
    if (!indicator) return;
    
    const circles = indicator.querySelectorAll('.tick-circle');
    
    circles.forEach((circle, index) => {
        if (index < ticksElapsed) {
            if (profit > 0) {
                circle.classList.add('profit');
                circle.classList.remove('loss');
            } else if (profit < 0) {
                circle.classList.add('loss');
                circle.classList.remove('profit');
            }
        }
    });
}

function checkAutoClose() {
    if (!autoCloseToggle.checked || !isBotRunning) return;
    
    const higherProfit = currentPositions.higher?.profit || 0;
    const lowerProfit = currentPositions.lower?.profit || 0;
    const netProfit = higherProfit + lowerProfit;
    const target = parseFloat(profitTargetInput.value);
    
    if (netProfit >= target && target > 0) {
        addLogEntry(`TARGET REACHED! Net profit $${netProfit.toFixed(2)}`, 'win');
        closeBothContracts();
        return;
    }
    
    if ((higherProfit > 2.0 && lowerProfit < -0.8) || (lowerProfit > 2.0 && higherProfit < -0.8)) {
        addLogEntry(`Mid-trade profit opportunity detected - closing both`, 'win');
        closeBothContracts();
    }
}

async function closeContract(direction) {
    const position = currentPositions[direction];
    if (!position || !position.id) {
        addLogEntry(`No active ${direction.toUpperCase()} contract to close`, 'system');
        return;
    }
    
    addLogEntry(`Closing ${direction.toUpperCase()} contract (ID: ${position.id})`, 'system');
    
    ws.send(JSON.stringify({ 
        sell: position.id,
        price: 0,
        req_id: Date.now()
    }));
}

async function closeBothContracts() {
    if (currentPositions.higher && currentPositions.higher.id) {
        await closeContract('higher');
    }
    if (currentPositions.lower && currentPositions.lower.id) {
        await closeContract('lower');
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
        
        tradingLock = false;
        
        if (isBotRunning) {
            setTimeout(() => placeHedgeTrade(), 1500);
        }
    }, 800);
}

function handleSellResponse(sell) {
    const profit = sell.sold_for - sell.bought_for;
    addLogEntry(`Contract sold for $${sell.sold_for.toFixed(2)} | ${profit >= 0 ? 'Profit' : 'Loss'}: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`, profit >= 0 ? 'win' : 'loss');
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
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ 
            switch_account: type === 'demo' ? 1 : 0,
            req_id: Date.now()
        }));
    }
    
    if (type === 'demo') {
        if (demoBtn) demoBtn.classList.add('active');
        if (realBtn) realBtn.classList.remove('active');
        currentAccountType = 'demo';
    } else {
        if (realBtn) realBtn.classList.add('active');
        if (demoBtn) demoBtn.classList.remove('active');
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
    const inputs = [stakeInput, durationInput, offsetInput, profitTargetInput, autoCloseToggle, marketSelect];
    inputs.forEach(input => { 
        if (input) input.disabled = !enabled; 
    });
    if (startBtn) startBtn.disabled = !enabled;
    if (stopBtn) stopBtn.disabled = !enabled;
    if (emergencyBtn) emergencyBtn.disabled = !enabled;
    if (closeHigherBtn) closeHigherBtn.disabled = !enabled;
    if (closeLowerBtn) closeLowerBtn.disabled = !enabled;
    if (closeBothBtn) closeBothBtn.disabled = !enabled;
}

function stopBot() {
    isBotRunning = false;
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    if (emergencyBtn) emergencyBtn.disabled = true;
    tradingLock = false;
    if (autoCloseInterval) {
        clearInterval(autoCloseInterval);
        autoCloseInterval = null;
    }
    addLogEntry('🛑 Intelligent bot stopped', 'system');
}

async function emergencyStop() {
    addLogEntry('🚨 EMERGENCY STOP ACTIVATED', 'system');
    await closeBothContracts();
    stopBot();
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

addLogEntry('✅ Intelligent Hedge Bot v2.1 loaded. All fixes applied. Connect token to begin.', 'system');
