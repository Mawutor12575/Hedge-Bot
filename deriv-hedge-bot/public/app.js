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
let activeProposalCount = 0;
let contractSubscriptionIds = [];
let pendingProposals = {
    higher: null,
    lower: null
};
let proposalMap = new Map(); // Map proposal ID to direction

// Trading Parameters
const TRADING_CONFIG = {
    barrierOffset: 14.9962,
    minPayout: 2.3,
    defaultDuration: 5,
    defaultStake: 1.0
};

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
const marketSelect = document.getElementById('market-select');
const tickHistoryDiv = document.getElementById('tick-history');
const pauseTicksBtn = document.getElementById('pause-ticks-btn');
const lastTenDigitsSpan = document.getElementById('last-ten-digits');
const lastDigitDisplay = document.getElementById('last-digit-display');
const marketSymbolSpan = document.getElementById('market-symbol');

// Set default values
if (stakeInput) stakeInput.value = TRADING_CONFIG.defaultStake;
if (durationInput) durationInput.value = TRADING_CONFIG.defaultDuration;
if (offsetInput) offsetInput.value = TRADING_CONFIG.barrierOffset;
if (profitTargetInput) profitTargetInput.value = '5.00';

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
    
    const tickData = {
        price: currentPrice,
        time: Date.now(),
        change: tickHistory.length > 0 ? currentPrice - tickHistory[0].price : 0
    };
    
    tickHistory.unshift(tickData);
    if (tickHistory.length > maxTickHistory) tickHistory.pop();
    
    const priceStr = currentPrice.toFixed(2);
    const lastDigit = priceStr.slice(-1);
    if (lastDigitDisplay) lastDigitDisplay.textContent = lastDigit;
    
    if (!isNaN(parseInt(lastDigit))) {
        lastTenDigits.unshift(lastDigit);
        if (lastTenDigits.length > 10) lastTenDigits.pop();
        if (lastTenDigitsSpan) lastTenDigitsSpan.textContent = lastTenDigits.join(' ');
    }
    
    if (!isTickDisplayPaused) updateTickDisplay();
    
    // Update tick indicators for both positions
    updateTickIndicators();
}

function updateTickIndicators() {
    if (currentPositions.higher && currentPositions.higher.ticksElapsed !== undefined) {
        updateTickCircles('higher', currentPositions.higher.ticksElapsed, currentPositions.higher.profit);
    }
    if (currentPositions.lower && currentPositions.lower.ticksElapsed !== undefined) {
        updateTickCircles('lower', currentPositions.lower.ticksElapsed, currentPositions.lower.profit);
    }
}

function updateTickDisplay() {
    if (!tickHistoryDiv) return;
    
    if (tickHistory.length === 0) {
        tickHistoryDiv.innerHTML = '<div class="tick-placeholder">Waiting for ticks...</div>';
        return;
    }
    
    tickHistoryDiv.innerHTML = '';
    const recentTicks = tickHistory.slice(0, 20);
    
    recentTicks.forEach((tick, index) => {
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
            activeProposalCount = 0;
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
            demoBtn.classList.add('active');
            realBtn.classList.remove('active');
        } else {
            realBtn.classList.add('active');
            demoBtn.classList.remove('active');
        }
        
        enableControls(true);
        subscribeToTicks();
        
        ws.send(JSON.stringify({ balance: 1, req_id: Date.now() }));
    }
    
    if (data.tick) handleTick(data);
    
    if (data.proposal) {
        // Resolve direction: first try req_id map, then fall back to contract_type
        let direction = proposalMap.get(data.req_id);
        if (!direction) {
            if (data.proposal.contract_type === 'CALL') {
                direction = 'higher';
            } else if (data.proposal.contract_type === 'PUT') {
                direction = 'lower';
            }
        }
        handleProposalResponse(data.proposal, direction);
    }
    
    if (data.buy) handleBuyResponse(data.buy);
    
    if (data.sell) handleSellResponse(data.sell);
    
    if (data.proposal_open_contract) {
        const contract = data.proposal_open_contract;
        updateContractValue(contract);
        
        if (contract.is_sold) {
            const profit = contract.profit || 0;
            addLogEntry(`📊 Contract ${contract.contract_id} closed. ${profit >= 0 ? '✅ WIN' : '❌ LOSS'}: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`, profit >= 0 ? 'win' : 'loss');
            
            sessionStats.totalTrades++;
            sessionStats.sessionPnL += profit;
            sessionStats.totalProfit += profit;
            if (profit > 0) sessionStats.wins++;
            updateStatsDisplay();
            
            if (currentPositions.higher && currentPositions.higher.id === contract.contract_id) {
                currentPositions.higher = null;
                const higherIndicator = document.getElementById('higher-tick-indicator');
                if (higherIndicator) higherIndicator.innerHTML = '';
                if (closeHigherBtn) closeHigherBtn.disabled = true;
            }
            if (currentPositions.lower && currentPositions.lower.id === contract.contract_id) {
                currentPositions.lower = null;
                const lowerIndicator = document.getElementById('lower-tick-indicator');
                if (lowerIndicator) lowerIndicator.innerHTML = '';
                if (closeLowerBtn) closeLowerBtn.disabled = true;
            }
            
            // If both are gone, disable close-both too
            if (!currentPositions.higher && !currentPositions.lower) {
                if (closeBothBtn) closeBothBtn.disabled = true;
            }
            
            contractSubscriptionIds = contractSubscriptionIds.filter(id => id !== contract.contract_id);
            
            if (!currentPositions.higher && !currentPositions.lower && isBotRunning) {
                tradingLock = false;
                setTimeout(() => placeHedgeTrade(), 2000);
            }
        }
    }
    
    if (data.balance) updateBalanceDisplay(data.balance.balance);
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
    addLogEntry(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
    addLogEntry(`🤖 Hedge Bot started on ${marketSelect.options[marketSelect.selectedIndex]?.textContent || currentSymbol}`, 'system');
    addLogEntry(`📊 Strategy: Parallel HIGHER/LOWER trades with ${durationInput.value} ticks duration`, 'system');
    addLogEntry(`💰 Stake: $${stakeInput.value} each | Offset: ${offsetInput.value} points`, 'system');
    addLogEntry(`🎯 Profit Target: $${profitTargetInput.value} | Auto-close: ${autoCloseToggle.checked ? 'ON' : 'OFF'}`, 'system');
    addLogEntry(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
    
    // Create tick indicators based on duration
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

function updateTickCircles(direction, ticksElapsed, profit) {
    const indicator = document.getElementById(`${direction}-tick-indicator`);
    if (!indicator) return;
    
    const circles = indicator.querySelectorAll('.tick-circle');
    
    circles.forEach((circle, index) => {
        if (index < ticksElapsed) {
            // Animate the current tick
            if (index === ticksElapsed - 1) {
                if (profit > 0) {
                    circle.classList.add('profit-tick');
                    setTimeout(() => circle.classList.remove('profit-tick'), 300);
                    circle.classList.add('profit');
                    circle.classList.remove('loss');
                } else if (profit < 0) {
                    circle.classList.add('loss-tick');
                    setTimeout(() => circle.classList.remove('loss-tick'), 300);
                    circle.classList.add('loss');
                    circle.classList.remove('profit');
                } else {
                    circle.classList.remove('profit', 'loss');
                }
            } else if (index < ticksElapsed - 1) {
                // Already processed ticks - keep their color
                if (profit > 0) {
                    circle.classList.add('profit');
                    circle.classList.remove('loss');
                } else if (profit < 0) {
                    circle.classList.add('loss');
                    circle.classList.remove('profit');
                }
            }
        }
    });
}

function stopBot() {
    isBotRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    tradingLock = false;
    activeProposalCount = 0;
    pendingProposals = { higher: null, lower: null };
    proposalMap.clear();
    addLogEntry('🛑 Bot stopped', 'system');
    
    if (autoCloseInterval) {
        clearInterval(autoCloseInterval);
        autoCloseInterval = null;
    }
}

async function emergencyStop() {
    addLogEntry('⚠️⚠️⚠️ EMERGENCY STOP ACTIVATED ⚠️⚠️⚠️', 'system');
    addLogEntry('🔒 Closing all positions immediately...', 'system');
    
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
    if (tradingLock) {
        addLogEntry('⏳ Waiting for previous trade cycle to complete...', 'system');
        setTimeout(placeHedgeTrade, 2000);
        return;
    }
    
    if (!currentPrice) {
        setTimeout(placeHedgeTrade, 1000);
        return;
    }
    
    tradingLock = true;
    
    const stake = parseFloat(stakeInput.value);
    const duration = parseInt(durationInput.value);
    const offset = parseFloat(offsetInput.value);
    
    const higherBarrier = `+${offset.toFixed(4)}`;
    const lowerBarrier = `-${offset.toFixed(4)}`;
    
    addLogEntry(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
    addLogEntry(`🎯 Placing Parallel Hedge Trade at ${currentPrice.toFixed(2)}`, 'system');
    addLogEntry(`📈 HIGHER: ${higherBarrier} (CALL) - Price must rise by ${offset} points`, 'system');
    addLogEntry(`📉 LOWER: ${lowerBarrier} (PUT) - Price must fall by ${offset} points`, 'system');
    addLogEntry(`⏱️ Duration: ${duration} ticks | 💰 Stake: $${stake} each`, 'system');
    addLogEntry(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
    
    activeProposalCount = 2;
    
    // Proposal for CALL (higher)
    const higherReqId = Date.now();
    proposalMap.set(higherReqId, 'higher');
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
        req_id: higherReqId
    }));
    
    // Proposal for PUT (lower) — use a distinct req_id after a short delay
    setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const lowerReqId = Date.now();
            proposalMap.set(lowerReqId, 'lower');
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
                req_id: lowerReqId
            }));
        }
    }, 300);
}

function handleProposalResponse(proposal, direction) {
    if (proposal && proposal.id) {
        // If direction wasn't passed, try to determine from contract_type
        if (!direction) {
            if (proposal.contract_type === 'CALL') {
                direction = 'higher';
            } else if (proposal.contract_type === 'PUT') {
                direction = 'lower';
            }
        }
        
        const payout = parseFloat(proposal.payout);
        const stake = parseFloat(stakeInput.value);
        const profitPotential = payout - stake;
        const profitPercent = (profitPotential / stake) * 100;
        
        addLogEntry(`📝 ${direction?.toUpperCase() || 'UNKNOWN'} Proposal: ${proposal.contract_type || 'Contract'} | Payout $${payout.toFixed(2)} | Profit: $${profitPotential.toFixed(2)} (${profitPercent.toFixed(1)}%)`, 'system');
        
        const minPayout = TRADING_CONFIG.minPayout;
        if (profitPotential >= minPayout) {
            addLogEntry(`✅ ${direction?.toUpperCase() || ''} proposal accepted - purchasing contract...`, 'success');
            ws.send(JSON.stringify({
                buy: proposal.id,
                price: proposal.ask_price,
                req_id: Date.now()
            }));
        } else {
            addLogEntry(`⚠️ ${direction?.toUpperCase() || ''} proposal rejected: Profit $${profitPotential.toFixed(2)} below minimum $${minPayout.toFixed(2)}`, 'system');
            activeProposalCount--;
            if (activeProposalCount === 0) {
                tradingLock = false;
                setTimeout(() => placeHedgeTrade(), 2000);
            }
        }
    } else if (proposal && proposal.error) {
        addLogEntry(`❌ Proposal error: ${proposal.error.message}`, 'system');
        activeProposalCount--;
        if (activeProposalCount === 0) {
            tradingLock = false;
            setTimeout(() => placeHedgeTrade(), 2000);
        }
    }
}

function handleBuyResponse(buy) {
    const direction = buy.contract_type === 'CALL' ? 'higher' : 'lower';
    
    // Only accept if this direction doesn't already have a contract
    if (currentPositions[direction]) {
        addLogEntry(`⚠️ ${direction.toUpperCase()} contract already exists. Skipping duplicate.`, 'system');
        activeProposalCount--;
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
        profit: 0,
        profitPercent: 0
    };
    
    addLogEntry(`✅ ${direction.toUpperCase()} contract purchased! ID: ${buy.contract_id} | Price: $${buy.buy_price}`, 'success');
    
    // Enable close buttons now that we have an open position
    if (closeHigherBtn) closeHigherBtn.disabled = false;
    if (closeLowerBtn) closeLowerBtn.disabled = false;
    if (closeBothBtn) closeBothBtn.disabled = false;
    
    ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: buy.contract_id,
        req_id: Date.now()
    }));
    
    contractSubscriptionIds.push(buy.contract_id);
    activeProposalCount--;
    
    if (currentPositions.higher && currentPositions.lower && autoCloseToggle.checked && !autoCloseInterval) {
        autoCloseInterval = setInterval(checkAutoClose, 500);
        addLogEntry(`📊 Auto-close monitoring started (checking every 0.5s)`, 'system');
    }
}

function updateContractValue(contract) {
    let direction = null;
    if (currentPositions.higher && currentPositions.higher.id === contract.contract_id) {
        direction = 'higher';
    } else if (currentPositions.lower && currentPositions.lower.id === contract.contract_id) {
        direction = 'lower';
    } else {
        return;
    }
    
    // Use contract.profit directly when the API provides it (most reliable)
    // currentValue is the current sell/bid price of the contract (not the spot price)
    const buyPrice = currentPositions[direction]?.entryPrice || contract.buy_price || 0;
    let currentValue, profit;

    if (contract.profit !== undefined && contract.profit !== null) {
        // API gives us profit directly — most accurate
        profit = parseFloat(contract.profit);
        currentValue = buyPrice + profit;
    } else if (contract.sell_price !== undefined && contract.sell_price !== null) {
        currentValue = parseFloat(contract.sell_price);
        profit = currentValue - buyPrice;
    } else {
        // Fallback: no useful value yet
        currentValue = buyPrice;
        profit = 0;
    }

    const profitPercent = buyPrice > 0 ? (profit / buyPrice) * 100 : 0;
    
    // Calculate ticks left based on contract expiry
    let ticksLeft = 0;
    if (contract.date_expiry) {
        ticksLeft = Math.max(0, contract.date_expiry - Math.floor(Date.now() / 1000));
    } else if (currentPositions[direction]?.duration) {
        const elapsedSeconds = (Date.now() - (currentPositions[direction]?.buyTimestamp || Date.now())) / 1000;
        ticksLeft = Math.max(0, currentPositions[direction].duration - Math.floor(elapsedSeconds));
    }
    
    // Calculate ticks elapsed
    const totalDuration = currentPositions[direction]?.duration || parseInt(durationInput.value);
    const ticksElapsed = Math.max(0, totalDuration - ticksLeft);
    
    if (currentPositions[direction]) {
        currentPositions[direction].currentValue = currentValue;
        currentPositions[direction].ticksLeft = ticksLeft;
        currentPositions[direction].ticksElapsed = ticksElapsed;
        currentPositions[direction].profit = profit;
        currentPositions[direction].profitPercent = profitPercent;
    }
    
    const change = currentValue - (previousValues[direction] || 0);
    
    updatePositionDisplay(direction, currentValue, profit, profitPercent, change, ticksLeft);
    updateTickCircles(direction, ticksElapsed, profit);
    
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
    setTimeout(() => {
        element.classList.remove(`${type}-glow`);
    }, 1000);
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
        pnlEl.textContent = `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} (${profitPercent.toFixed(1)}%)`;
        pnlEl.className = `pnl ${profit >= 0 ? 'gain' : 'loss'}`;
    }
    if (changeEl) {
        const changeSymbol = change >= 0 ? '▲' : '▼';
        changeEl.textContent = `${changeSymbol} $${Math.abs(change).toFixed(2)}`;
        changeEl.className = `change ${change >= 0 ? 'positive' : 'negative'}`;
    }
    if (ticksEl) ticksEl.textContent = ticksLeft;
    if (barrierEl && currentPositions[direction]) barrierEl.textContent = currentPositions[direction].barrier;
}

function updateCombinedValues() {
    const higherProfit = currentPositions.higher?.profit || 0;
    const lowerProfit = currentPositions.lower?.profit || 0;
    const totalStake = parseFloat(stakeInput.value) * 2;
    const netProfit = higherProfit + lowerProfit;
    const netProfitPercent = totalStake > 0 ? (netProfit / totalStake) * 100 : 0;
    
    // Combined value = sum of current contract values (buy_price + profit each)
    const higherValue = currentPositions.higher
        ? (currentPositions.higher.entryPrice || 0) + higherProfit
        : 0;
    const lowerValue = currentPositions.lower
        ? (currentPositions.lower.entryPrice || 0) + lowerProfit
        : 0;
    const combinedValue = higherValue + lowerValue;
    
    const combinedValueEl = document.getElementById('combined-value');
    const netProfitEl = document.getElementById('net-profit');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    
    if (combinedValueEl) combinedValueEl.textContent = `$${combinedValue.toFixed(2)}`;
    if (netProfitEl) {
        netProfitEl.textContent = `${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)} (${netProfitPercent.toFixed(1)}%)`;
        netProfitEl.className = `net-profit ${netProfit >= 0 ? 'positive' : 'negative'}`;
    }
    
    const target = parseFloat(profitTargetInput.value);
    if (target > 0) {
        const progress = Math.min((netProfit / target) * 100, 100);
        if (progressFill) progressFill.style.width = `${Math.max(0, progress)}%`;
        if (progressText) progressText.textContent = `${Math.round(progress)}%`;
    }
}

function checkAutoClose() {
    if (!autoCloseToggle.checked || !isBotRunning) return;
    
    const higherProfit = currentPositions.higher?.profit || 0;
    const lowerProfit = currentPositions.lower?.profit || 0;
    const netProfit = higherProfit + lowerProfit;
    const target = parseFloat(profitTargetInput.value);
    
    if (netProfit >= target && target > 0) {
        addLogEntry(`🎯🎯🎯 TARGET REACHED! Net profit $${netProfit.toFixed(2)} >= $${target.toFixed(2)}`, 'win');
        addLogEntry(`🔄 Closing both contracts to secure profit...`, 'win');
        closeBothContracts();
        return;
    }
    
    if (higherProfit > 1.0 && lowerProfit < -0.5) {
        addLogEntry(`🎯 Profitable opportunity detected! Higher: +$${higherProfit.toFixed(2)} | Lower: $${lowerProfit.toFixed(2)}`, 'win');
        closeBothContracts();
    } else if (lowerProfit > 1.0 && higherProfit < -0.5) {
        addLogEntry(`🎯 Profitable opportunity detected! Lower: +$${lowerProfit.toFixed(2)} | Higher: $${higherProfit.toFixed(2)}`, 'win');
        closeBothContracts();
    }
}

async function closeContract(direction, isEmergency = false) {
    const position = currentPositions[direction];
    if (!position || !position.id) {
        addLogEntry(`⚠️ No active ${direction.toUpperCase()} contract to close`, 'system');
        return;
    }
    
    const profit = position.profit || 0;
    addLogEntry(`🔒 Closing ${direction.toUpperCase()} contract (ID: ${position.id}) | Current P/L: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}${isEmergency ? ' - EMERGENCY' : ''}`, 'system');
    
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
        
        if (closeHigherBtn) closeHigherBtn.disabled = true;
        if (closeLowerBtn) closeLowerBtn.disabled = true;
        if (closeBothBtn) closeBothBtn.disabled = true;
        
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
            addLogEntry(`🔄 Preparing next hedge trade cycle in 3 seconds...`, 'system');
            setTimeout(() => placeHedgeTrade(), 3000);
        }
    }, 1000);
}

function handleSellResponse(sell) {
    const profit = sell.sold_for - sell.bought_for;
    addLogEntry(`💰 Contract sold for $${sell.sold_for.toFixed(2)} | ${profit >= 0 ? 'Profit' : 'Loss'}: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`, profit >= 0 ? 'win' : 'loss');
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
    ws.send(JSON.stringify({ 
        switch_account: type === 'demo' ? 1 : 0,
        req_id: Date.now()
    }));
    
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
    const inputs = [stakeInput, durationInput, offsetInput, profitTargetInput, autoCloseToggle, marketSelect];
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
