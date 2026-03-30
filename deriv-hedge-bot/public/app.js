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
let currentToken = null;
let tradingLock = false;
let activeProposalCount = 0;
let proposalMap = new Map();

// Trading Parameters
const TRADING_CONFIG = {
    barrierOffset: 14.9962,
    defaultDuration: 5,
    defaultStake: 1.0,
    minPayout: 2.3
};

// DOM Elements
const loginBtn = document.getElementById('connect-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const emergencyBtn = document.getElementById('emergency-btn');
const stakeInput = document.getElementById('stake');
const durationInput = document.getElementById('duration');
const offsetInput = document.getElementById('offset');
const closeHigherBtn = document.getElementById('close-higher');
const closeLowerBtn = document.getElementById('close-lower');
const closeBothBtn = document.getElementById('close-both');
const demoBtn = document.getElementById('demo-switch');
const realBtn = document.getElementById('real-switch');
const authStatus = document.getElementById('connection-status');
const apiTokenInput = document.getElementById('token');
const accountSwitch = document.getElementById('account-buttons');
const marketSelect = document.getElementById('market');

// Set default values
if (stakeInput) stakeInput.value = TRADING_CONFIG.defaultStake;
if (durationInput) durationInput.value = TRADING_CONFIG.defaultDuration;
if (offsetInput) offsetInput.value = TRADING_CONFIG.barrierOffset;

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
    }
}

function onMarketChange() {
    if (!marketSelect) return;
    
    currentSymbol = marketSelect.value;
    addLogEntry(`Switched to market: ${marketSelect.options[marketSelect.selectedIndex].textContent} (${currentSymbol})`, 'system');
    
    if (ws && ws.readyState === WebSocket.OPEN && isConnected) {
        subscribeToTicks();
    }
}

function subscribeToTicks() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
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
}

function updatePriceDisplay(price) {
    const priceEl = document.getElementById('price-display');
    if (priceEl) priceEl.textContent = `Price: $${price.toFixed(2)}`;
}

function updateBalanceDisplay(balance) {
    const balanceEl = document.getElementById('balance-display');
    if (balanceEl) balanceEl.textContent = `Balance: $${parseFloat(balance).toFixed(2)}`;
}

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
        addLogEntry('No token found. Please enter your API token.', 'system');
        return;
    }
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    
    ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=84911');
    
    ws.onopen = () => {
        addLogEntry('WebSocket connected, authorizing...', 'system');
        ws.send(JSON.stringify({ 
            authorize: currentToken,
            req_id: Date.now()
        }));
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('Received:', data);
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
        
        const resetEls = ['higher-current', 'lower-current', 'higher-pnl', 'lower-pnl', 'net-profit'];
        resetEls.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '-';
        });
        
        if (isBotRunning && reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            addLogEntry(`Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})...`, 'system');
            setTimeout(() => connectWebSocket(), reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        } else {
            reconnectAttempts = 0;
            reconnectDelay = 1000;
            if (isBotRunning) {
                isBotRunning = false;
                if (startBtn) startBtn.disabled = false;
                if (stopBtn) stopBtn.disabled = true;
            }
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
        addLogEntry(`✅ Authorized as ${data.authorize.email || data.authorize.loginid} (${currentAccountType.toUpperCase()} account)`, 'success');
        
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
        return;
    }
    
    if (data.tick) {
        handleTick(data);
        return;
    }
    
    if (data.proposal) {
        let direction = proposalMap.get(data.req_id);
        handleProposalResponse(data.proposal, direction);
        return;
    }
    
    if (data.buy) {
        handleBuyResponse(data.buy);
        return;
    }
    
    if (data.sell) {
        handleSellResponse(data.sell);
        return;
    }
    
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
                if (closeHigherBtn) closeHigherBtn.disabled = true;
            }
            if (currentPositions.lower && currentPositions.lower.id === contract.contract_id) {
                currentPositions.lower = null;
                if (closeLowerBtn) closeLowerBtn.disabled = true;
            }
            
            if (!currentPositions.higher && !currentPositions.lower) {
                if (closeBothBtn) closeBothBtn.disabled = true;
            }
            
            if (!currentPositions.higher && !currentPositions.lower && isBotRunning) {
                tradingLock = false;
                setTimeout(() => placeHedgeTrade(), 2000);
            }
        }
        return;
    }
    
    if (data.balance) {
        updateBalanceDisplay(data.balance.balance);
        return;
    }
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
    addLogEntry(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
    
    await placeHedgeTrade();
}

function stopBot() {
    isBotRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    tradingLock = false;
    activeProposalCount = 0;
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
    addLogEntry(`📈 HIGHER (CALL): Barrier ${higherBarrier} - Price must rise by ${offset} points`, 'system');
    addLogEntry(`📉 LOWER (PUT): Barrier ${lowerBarrier} - Price must fall by ${offset} points`, 'system');
    addLogEntry(`⏱️ Duration: ${duration} ticks | 💰 Stake: $${stake} each`, 'system');
    addLogEntry(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
    
    activeProposalCount = 2;
    
    // Send both proposals with unique request IDs
    const timestamp = Date.now();
    
    // Higher (CALL) proposal
    const higherReqId = timestamp;
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
    
    // Lower (PUT) proposal
    const lowerReqId = timestamp + 1;
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
    
    addLogEntry(`📤 Sent both HIGHER and LOWER proposals simultaneously`, 'system');
}

function handleProposalResponse(proposal, direction) {
    if (!direction) {
        addLogEntry(`❌ Cannot determine direction for proposal`, 'system');
        activeProposalCount--;
        if (activeProposalCount === 0) {
            tradingLock = false;
            setTimeout(() => placeHedgeTrade(), 2000);
        }
        return;
    }
    
    if (proposal && proposal.id) {
        const payout = parseFloat(proposal.payout);
        const stake = parseFloat(stakeInput.value);
        const profitPotential = payout - stake;
        const profitPercent = (profitPotential / stake) * 100;
        
        addLogEntry(`📝 ${direction.toUpperCase()} Proposal: Payout $${payout.toFixed(2)} | Profit: $${profitPotential.toFixed(2)} (${profitPercent.toFixed(1)}%)`, 'system');
        
        if (profitPotential >= TRADING_CONFIG.minPayout) {
            addLogEntry(`✅ ${direction.toUpperCase()} proposal accepted - purchasing contract...`, 'success');
            ws.send(JSON.stringify({
                buy: proposal.id,
                price: proposal.ask_price,
                req_id: Date.now()
            }));
        } else {
            addLogEntry(`⚠️ ${direction.toUpperCase()} proposal rejected: Profit $${profitPotential.toFixed(2)} below minimum $${TRADING_CONFIG.minPayout.toFixed(2)}`, 'system');
            activeProposalCount--;
            if (activeProposalCount === 0) {
                tradingLock = false;
                setTimeout(() => placeHedgeTrade(), 2000);
            }
        }
    } else if (proposal && proposal.error) {
        addLogEntry(`❌ ${direction.toUpperCase()} proposal error: ${proposal.error.message}`, 'system');
        activeProposalCount--;
        if (activeProposalCount === 0) {
            tradingLock = false;
            setTimeout(() => placeHedgeTrade(), 2000);
        }
    }
}

function handleBuyResponse(buy) {
    const direction = buy.contract_type === 'CALL' ? 'higher' : 'lower';
    
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
        profit: 0,
        profitPercent: 0
    };
    
    addLogEntry(`✅ ${direction.toUpperCase()} contract purchased! ID: ${buy.contract_id} | Price: $${buy.buy_price}`, 'success');
    
    // Update display
    const barrierEl = document.getElementById(`${direction}-barrier`);
    if (barrierEl) barrierEl.textContent = buy.barrier;
    
    const entryEl = document.getElementById(`${direction}-entry`);
    if (entryEl) entryEl.textContent = `$${buy.buy_price}`;
    
    const currentEl = document.getElementById(`${direction}-current`);
    if (currentEl) currentEl.textContent = `$${buy.buy_price}`;
    
    if (direction === 'higher' && closeHigherBtn) closeHigherBtn.disabled = false;
    if (direction === 'lower' && closeLowerBtn) closeLowerBtn.disabled = false;
    if (closeBothBtn) closeBothBtn.disabled = false;
    
    ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: buy.contract_id,
        req_id: Date.now()
    }));
    
    activeProposalCount--;
    
    // Check if both contracts are now active
    if (currentPositions.higher && currentPositions.lower) {
        addLogEntry(`🎉 Both HIGHER and LOWER contracts are now active!`, 'success');
        tradingLock = false;
        
        // Start auto-close monitoring if enabled (you can add this feature later)
        if (!autoCloseInterval) {
            autoCloseInterval = setInterval(checkAutoClose, 500);
            addLogEntry(`📊 Auto-close monitoring started (checking every 0.5s)`, 'system');
        }
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
    
    const buyPrice = currentPositions[direction].entryPrice;
    let profit;

    if (contract.profit !== undefined && contract.profit !== null) {
        profit = parseFloat(contract.profit);
    } else if (contract.sell_price !== undefined && contract.sell_price !== null) {
        profit = parseFloat(contract.sell_price) - buyPrice;
    } else {
        profit = 0;
    }

    const profitPercent = buyPrice > 0 ? (profit / buyPrice) * 100 : 0;
    const currentValue = buyPrice + profit;
    
    currentPositions[direction].profit = profit;
    currentPositions[direction].profitPercent = profitPercent;
    
    updatePositionDisplay(direction, currentValue, profit, profitPercent);
    updateCombinedValues();
}

function updatePositionDisplay(direction, value, profit, profitPercent) {
    const currentEl = document.getElementById(`${direction}-current`);
    const pnlEl = document.getElementById(`${direction}-pnl`);
    
    if (currentEl) {
        currentEl.textContent = `$${value.toFixed(2)}`;
    }
    if (pnlEl) {
        pnlEl.textContent = `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} (${profitPercent.toFixed(1)}%)`;
        pnlEl.style.color = profit >= 0 ? '#00ff88' : '#ff4444';
    }
}

function updateCombinedValues() {
    const higherProfit = currentPositions.higher?.profit || 0;
    const lowerProfit = currentPositions.lower?.profit || 0;
    const netProfit = higherProfit + lowerProfit;
    
    const netProfitEl = document.getElementById('net-profit');
    if (netProfitEl) {
        netProfitEl.textContent = `${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}`;
        netProfitEl.style.color = netProfit >= 0 ? '#00ff88' : '#ff4444';
    }
}

function checkAutoClose() {
    if (!isBotRunning) return;
    
    const higherProfit = currentPositions.higher?.profit || 0;
    const lowerProfit = currentPositions.lower?.profit || 0;
    const netProfit = higherProfit + lowerProfit;
    
    // Auto-close when one side is profitable enough to cover the loss of the other
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
    addLogEntry(`🔒 Closing both contracts...`, 'system');
    
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
        
        if (closeHigherBtn) closeHigherBtn.disabled = true;
        if (closeLowerBtn) closeLowerBtn.disabled = true;
        if (closeBothBtn) closeBothBtn.disabled = true;
        
        const resetEls = ['higher-current', 'lower-current', 'higher-pnl', 'lower-pnl', 'net-profit'];
        resetEls.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '-';
        });
        
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
    
    const cycleCountEl = document.getElementById('cycle-count');
    const winCountEl = document.getElementById('win-count');
    const totalProfitEl = document.getElementById('total-profit');
    
    if (cycleCountEl) cycleCountEl.textContent = sessionStats.totalTrades;
    if (winCountEl) winCountEl.textContent = sessionStats.wins;
    if (totalProfitEl) {
        totalProfitEl.textContent = `$${sessionStats.totalProfit.toFixed(2)}`;
        totalProfitEl.style.color = sessionStats.totalProfit >= 0 ? '#00ff88' : '#ff4444';
    }
}

async function switchAccount(type) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        addLogEntry('Not connected to Deriv', 'system');
        return;
    }
    
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
        authStatus.className = 'status connected';
        const dot = authStatus.querySelector('.dot');
        if (dot) dot.style.background = '#00ff88';
        if (accountSwitch) accountSwitch.style.display = 'flex';
        if (startBtn) startBtn.disabled = false;
    } else {
        authStatus.className = 'status disconnected';
        const dot = authStatus.querySelector('.dot');
        if (dot) dot.style.background = '#ff4444';
        if (accountSwitch) accountSwitch.style.display = 'none';
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = true;
    }
}

function enableControls(enabled) {
    const inputs = [stakeInput, durationInput, offsetInput, marketSelect];
    inputs.forEach(input => { if (input) input.disabled = !enabled; });
    if (startBtn) startBtn.disabled = !enabled;
    if (emergencyBtn) emergencyBtn.disabled = !enabled;
    if (closeHigherBtn) closeHigherBtn.disabled = !enabled;
    if (closeLowerBtn) closeLowerBtn.disabled = !enabled;
    if (closeBothBtn) closeBothBtn.disabled = !enabled;
}

function addLogEntry(message, type = 'system') {
    const logContainer = document.getElementById('log');
    if (!logContainer) return;
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContainer.insertBefore(entry, logContainer.firstChild);
    
    while (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.lastChild);
    }
}
