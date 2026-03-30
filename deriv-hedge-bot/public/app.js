// Configuration
let ws = null;
let isBotRunning = false;
let currentPosition = null;
let sessionStats = {
    totalTrades: 0,
    wins: 0,
    totalProfit: 0,
    sessionPnL: 0
};
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

// Trading Parameters
const TRADING_CONFIG = {
    barrierOffset: 14.9962,
    defaultDuration: 5,
    defaultStake: 1.0
};

// DOM Elements
const loginBtn = document.getElementById('connect-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const emergencyBtn = document.getElementById('emergency-btn');
const stakeInput = document.getElementById('stake');
const durationInput = document.getElementById('duration');
const offsetInput = document.getElementById('offset');
const closeBtn = document.getElementById('close-higher');
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
if (closeBtn) closeBtn.addEventListener('click', closeContract);
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
        handleProposalResponse(data.proposal);
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
            
            if (currentPosition && currentPosition.id === contract.contract_id) {
                currentPosition = null;
                if (closeBtn) closeBtn.disabled = true;
            }
            
            if (!currentPosition && isBotRunning) {
                tradingLock = false;
                setTimeout(() => placeTrade(), 2000);
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
    addLogEntry(`🤖 Bot started on ${marketSelect.options[marketSelect.selectedIndex]?.textContent || currentSymbol}`, 'system');
    addLogEntry(`📊 Strategy: HIGHER (CALL) trades with ${durationInput.value} ticks duration`, 'system');
    addLogEntry(`💰 Stake: $${stakeInput.value} | Offset: ${offsetInput.value} points`, 'system');
    addLogEntry(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
    
    await placeTrade();
}

function stopBot() {
    isBotRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    tradingLock = false;
    addLogEntry('🛑 Bot stopped', 'system');
}

async function emergencyStop() {
    addLogEntry('⚠️⚠️⚠️ EMERGENCY STOP ACTIVATED ⚠️⚠️⚠️', 'system');
    addLogEntry('🔒 Closing position immediately...', 'system');
    
    if (currentPosition && currentPosition.id) {
        await closeContract(true);
    }
    stopBot();
}

async function placeTrade() {
    if (!isBotRunning) return;
    if (tradingLock) {
        addLogEntry('⏳ Waiting for previous trade to complete...', 'system');
        setTimeout(placeTrade, 2000);
        return;
    }
    
    if (!currentPrice) {
        setTimeout(placeTrade, 1000);
        return;
    }
    
    tradingLock = true;
    
    const stake = parseFloat(stakeInput.value);
    const duration = parseInt(durationInput.value);
    const offset = parseFloat(offsetInput.value);
    const barrier = `+${offset.toFixed(4)}`;
    
    addLogEntry(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
    addLogEntry(`🎯 Placing HIGHER (CALL) Trade at ${currentPrice.toFixed(2)}`, 'system');
    addLogEntry(`📈 Barrier: ${barrier} - Price must rise by ${offset} points`, 'system');
    addLogEntry(`⏱️ Duration: ${duration} ticks | 💰 Stake: $${stake}`, 'system');
    addLogEntry(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
    
    // Send proposal
    ws.send(JSON.stringify({
        proposal: 1,
        amount: stake,
        basis: 'stake',
        contract_type: "CALL",
        currency: "USD",
        duration: duration,
        duration_unit: "t",
        symbol: currentSymbol,
        barrier: barrier,
        req_id: Date.now()
    }));
}

function handleProposalResponse(proposal) {
    if (proposal && proposal.id) {
        const payout = parseFloat(proposal.payout);
        const stake = parseFloat(stakeInput.value);
        const profitPotential = payout - stake;
        const profitPercent = (profitPotential / stake) * 100;
        
        addLogEntry(`📝 Proposal: Payout $${payout.toFixed(2)} | Profit: $${profitPotential.toFixed(2)} (${profitPercent.toFixed(1)}%)`, 'system');
        
        const minPayout = 2.3; // Minimum profit in USD
        if (profitPotential >= minPayout) {
            addLogEntry(`✅ Proposal accepted - purchasing contract...`, 'success');
            ws.send(JSON.stringify({
                buy: proposal.id,
                price: proposal.ask_price,
                req_id: Date.now()
            }));
        } else {
            addLogEntry(`⚠️ Proposal rejected: Profit $${profitPotential.toFixed(2)} below minimum $${minPayout.toFixed(2)}`, 'system');
            tradingLock = false;
            setTimeout(() => placeTrade(), 2000);
        }
    } else if (proposal && proposal.error) {
        addLogEntry(`❌ Proposal error: ${proposal.error.message}`, 'system');
        tradingLock = false;
        setTimeout(() => placeTrade(), 2000);
    }
}

function handleBuyResponse(buy) {
    if (currentPosition) {
        addLogEntry(`⚠️ Contract already exists. Skipping duplicate.`, 'system');
        return;
    }
    
    currentPosition = {
        id: buy.contract_id,
        entryPrice: buy.buy_price,
        barrier: buy.barrier,
        duration: buy.duration,
        buyTimestamp: Date.now(),
        profit: 0
    };
    
    addLogEntry(`✅ Contract purchased! ID: ${buy.contract_id} | Price: $${buy.buy_price}`, 'success');
    
    // Update display
    const barrierEl = document.getElementById('higher-barrier');
    if (barrierEl) barrierEl.textContent = buy.barrier;
    
    const entryEl = document.getElementById('higher-entry');
    if (entryEl) entryEl.textContent = `$${buy.buy_price}`;
    
    const currentEl = document.getElementById('higher-current');
    if (currentEl) currentEl.textContent = `$${buy.buy_price}`;
    
    if (closeBtn) closeBtn.disabled = false;
    
    ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: buy.contract_id,
        req_id: Date.now()
    }));
}

function updateContractValue(contract) {
    if (!currentPosition || currentPosition.id !== contract.contract_id) {
        return;
    }
    
    const buyPrice = currentPosition.entryPrice;
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
    
    currentPosition.profit = profit;
    
    updatePositionDisplay(currentValue, profit, profitPercent);
}

function updatePositionDisplay(value, profit, profitPercent) {
    const currentEl = document.getElementById('higher-current');
    const pnlEl = document.getElementById('higher-pnl');
    
    if (currentEl) {
        currentEl.textContent = `$${value.toFixed(2)}`;
    }
    if (pnlEl) {
        pnlEl.textContent = `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} (${profitPercent.toFixed(1)}%)`;
        pnlEl.style.color = profit >= 0 ? '#00ff88' : '#ff4444';
    }
    
    // Update net profit display
    const netProfitEl = document.getElementById('net-profit');
    if (netProfitEl) {
        netProfitEl.textContent = `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`;
        netProfitEl.style.color = profit >= 0 ? '#00ff88' : '#ff4444';
    }
}

async function closeContract(isEmergency = false) {
    if (!currentPosition || !currentPosition.id) {
        addLogEntry(`⚠️ No active contract to close`, 'system');
        return;
    }
    
    const profit = currentPosition.profit || 0;
    addLogEntry(`🔒 Closing contract (ID: ${currentPosition.id}) | Current P/L: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}${isEmergency ? ' - EMERGENCY' : ''}`, 'system');
    
    ws.send(JSON.stringify({ 
        sell: currentPosition.id,
        price: 0,
        req_id: Date.now()
    }));
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
    if (closeBtn) closeBtn.disabled = !enabled;
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
