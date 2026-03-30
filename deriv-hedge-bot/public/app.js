// ============================================
// DERIV HEDGE BOT - PROPER PARALLEL TRADES
// FIXED: Both trades placed, correct P&L, working close buttons
// ============================================

// State
let ws = null;
let isBotRunning = false;
let isConnected = false;
let currentPrice = null;
let currentSymbol = 'R_75';
let currentPositions = { 
    higher: null, 
    lower: null 
};
let sessionStats = { 
    cycles: 0, 
    wins: 0, 
    totalProfit: 0 
};
let lastContractUpdate = {};

// DOM Elements
let connectBtn, startBtn, stopBtn, emergencyBtn, demoSwitch, realSwitch;
let marketSelect, stakeInput, durationInput, offsetInput;
let closeHigherBtn, closeLowerBtn, closeBothBtn;
let logDiv, tokenInput;

// Helper: Add log entry
function addLog(msg, type = 'info') {
    const logDiv = document.getElementById('log');
    if (!logDiv) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logDiv.insertBefore(entry, logDiv.firstChild);
    while (logDiv.children.length > 150) logDiv.removeChild(logDiv.lastChild);
}

// Update displays
function updateBalance(balance) {
    const balanceDiv = document.getElementById('balance-display');
    if (balanceDiv) balanceDiv.innerHTML = `Balance: $${parseFloat(balance).toFixed(2)}`;
}

function updatePrice(price) {
    const priceDiv = document.getElementById('price-display');
    if (priceDiv) priceDiv.innerHTML = `Price: $${price.toFixed(2)}`;
    currentPrice = price;
}

function updateStats() {
    const winRate = sessionStats.cycles > 0 ? (sessionStats.wins / sessionStats.cycles * 100).toFixed(1) : 0;
    const cycleEl = document.getElementById('cycle-count');
    const winEl = document.getElementById('win-count');
    const totalEl = document.getElementById('total-profit');
    if (cycleEl) cycleEl.innerHTML = sessionStats.cycles;
    if (winEl) winEl.innerHTML = `${sessionStats.wins} (${winRate}%)`;
    if (totalEl) totalEl.innerHTML = `$${sessionStats.totalProfit.toFixed(2)}`;
    totalEl.style.color = sessionStats.totalProfit >= 0 ? '#00ff88' : '#ff4444';
}

function updateNetProfit() {
    const higherProfit = currentPositions.higher?.profit || 0;
    const lowerProfit = currentPositions.lower?.profit || 0;
    const net = higherProfit + lowerProfit;
    const netEl = document.getElementById('net-profit');
    if (netEl) {
        netEl.innerHTML = `$${net.toFixed(2)}`;
        netEl.style.color = net >= 0 ? '#00ff88' : '#ff4444';
    }
    return net;
}

function updatePositionUI(direction) {
    const pos = currentPositions[direction];
    const barrierEl = document.getElementById(`${direction}-barrier`);
    const entryEl = document.getElementById(`${direction}-entry`);
    const currentEl = document.getElementById(`${direction}-current`);
    const pnlSpan = document.getElementById(`${direction}-pnl`);
    
    if (pos) {
        if (barrierEl) barrierEl.innerHTML = pos.barrier || '-';
        if (entryEl) entryEl.innerHTML = pos.entryPrice ? `$${pos.entryPrice.toFixed(2)}` : '-';
        if (currentEl) currentEl.innerHTML = pos.currentValue ? `$${pos.currentValue.toFixed(2)}` : '-';
        if (pnlSpan) {
            const profit = pos.profit || 0;
            pnlSpan.innerHTML = `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`;
            pnlSpan.style.color = profit >= 0 ? '#00ff88' : '#ff4444';
        }
    } else {
        if (barrierEl) barrierEl.innerHTML = '-';
        if (entryEl) entryEl.innerHTML = '-';
        if (currentEl) currentEl.innerHTML = '-';
        if (pnlSpan) {
            pnlSpan.innerHTML = '-';
            pnlSpan.style.color = '#888';
        }
    }
}

function resetPositionUI(direction) {
    const barrierEl = document.getElementById(`${direction}-barrier`);
    const entryEl = document.getElementById(`${direction}-entry`);
    const currentEl = document.getElementById(`${direction}-current`);
    const pnlSpan = document.getElementById(`${direction}-pnl`);
    if (barrierEl) barrierEl.innerHTML = '-';
    if (entryEl) entryEl.innerHTML = '-';
    if (currentEl) currentEl.innerHTML = '-';
    if (pnlSpan) {
        pnlSpan.innerHTML = '-';
        pnlSpan.style.color = '#888';
    }
}

// WebSocket connection
function connectWebSocket(token) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    
    addLog('Connecting to Deriv...');
    ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=84911');
    
    ws.onopen = () => {
        addLog('WebSocket connected, authorizing...');
        ws.send(JSON.stringify({ authorize: token, req_id: 1 }));
    };
    
    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            handleMessage(data);
        } catch(err) {
            console.error('Parse error:', err);
        }
    };
    
    ws.onerror = () => {
        addLog('WebSocket error', 'error');
    };
    
    ws.onclose = () => {
        addLog('Disconnected from Deriv', 'error');
        isConnected = false;
        const statusDiv = document.getElementById('connection-status');
        if (statusDiv) statusDiv.classList.remove('connected');
        enableControls(false);
    };
}

function handleMessage(data) {
    if (data.error) {
        addLog(`Error: ${data.error.message}`, 'error');
        if (data.error.code === 'InvalidToken') {
            localStorage.removeItem('deriv_token');
            isConnected = false;
            const statusDiv = document.getElementById('connection-status');
            if (statusDiv) statusDiv.classList.remove('connected');
        }
        return;
    }
    
    // Auth response
    if (data.authorize) {
        isConnected = true;
        const statusDiv = document.getElementById('connection-status');
        if (statusDiv) {
            statusDiv.classList.add('connected');
            const span = statusDiv.querySelector('span:last-child');
            if (span) span.innerHTML = 'Connected';
        }
        updateBalance(data.authorize.balance);
        addLog(`✅ Authorized: ${data.authorize.email || data.authorize.loginid}`, 'success');
        
        // Show account buttons
        const accountBtns = document.getElementById('account-buttons');
        if (accountBtns) accountBtns.style.display = 'flex';
        
        const isDemo = data.authorize.loginid?.startsWith('VRTC');
        if (isDemo) {
            if (demoSwitch) demoSwitch.classList.add('active');
            if (realSwitch) realSwitch.classList.remove('active');
        } else {
            if (realSwitch) realSwitch.classList.add('active');
            if (demoSwitch) demoSwitch.classList.remove('active');
        }
        
        enableControls(true);
        if (startBtn) startBtn.disabled = false;
        
        // Subscribe to ticks
        ws.send(JSON.stringify({ ticks: currentSymbol, subscribe: 1, req_id: 2 }));
        ws.send(JSON.stringify({ balance: 1, req_id: 3 }));
    }
    
    // Tick response
    if (data.tick && data.tick.quote) {
        updatePrice(data.tick.quote);
    }
    
    // Balance update
    if (data.balance) {
        updateBalance(data.balance.balance);
    }
    
    // Proposal response
    if (data.proposal) {
        handleProposal(data.proposal);
    }
    
    // Buy response
    if (data.buy) {
        handleBuy(data.buy);
    }
    
    // Contract update (this is where we get current value and profit)
    if (data.proposal_open_contract) {
        handleContractUpdate(data.proposal_open_contract);
    }
}

// Place both trades
function placeBothTrades() {
    if (!isBotRunning) {
        addLog('Bot not running', 'error');
        return;
    }
    if (currentPositions.higher || currentPositions.lower) {
        addLog('Positions already active, waiting for them to close...');
        return;
    }
    if (!currentPrice) {
        addLog('Waiting for price feed...');
        setTimeout(placeBothTrades, 1000);
        return;
    }
    
    const stake = parseFloat(stakeInput.value);
    const duration = parseInt(durationInput.value);
    const offset = parseFloat(offsetInput.value);
    const higherBarrier = `+${offset.toFixed(4)}`;
    const lowerBarrier = `-${offset.toFixed(4)}`;
    
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    addLog(`🎯 Placing PARALLEL trades at ${currentPrice.toFixed(2)}`);
    addLog(`📈 HIGHER (CALL) - Barrier: ${higherBarrier}`);
    addLog(`📉 LOWER (PUT) - Barrier: ${lowerBarrier}`);
    addLog(`⏱️ Duration: ${duration} ticks | 💰 Stake: $${stake} each`);
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    // Send HIGHER proposal
    const higherReqId = Date.now();
    addLog(`📤 Sending HIGHER proposal...`);
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
    
    // Send LOWER proposal after 1 second
    setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN && isBotRunning) {
            const lowerReqId = Date.now();
            addLog(`📤 Sending LOWER proposal...`);
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
    }, 1000);
}

function handleProposal(proposal) {
    const direction = proposal.contract_type === 'CALL' ? 'higher' : 'lower';
    const stake = parseFloat(stakeInput.value);
    const payout = parseFloat(proposal.payout);
    const netProfit = payout - stake;
    
    addLog(`📝 ${direction.toUpperCase()} proposal: Payout $${payout.toFixed(2)} | Net $${netProfit.toFixed(2)}`);
    
    // Accept any proposal with positive net profit
    if (netProfit > 0) {
        addLog(`✅ ${direction.toUpperCase()} accepted - buying...`, 'success');
        ws.send(JSON.stringify({
            buy: proposal.id,
            price: proposal.ask_price,
            req_id: Date.now()
        }));
    } else {
        addLog(`❌ ${direction.toUpperCase()} rejected: Net profit too low`, 'error');
    }
}

function handleBuy(buy) {
    const direction = buy.contract_type === 'CALL' ? 'higher' : 'lower';
    
    currentPositions[direction] = {
        id: buy.contract_id,
        entryPrice: buy.buy_price,
        barrier: buy.barrier,
        duration: buy.duration,
        buyTimestamp: Date.now(),
        currentValue: buy.buy_price,
        profit: 0
    };
    
    addLog(`✅ ${direction.toUpperCase()} PURCHASED! ID: ${buy.contract_id} at $${buy.buy_price}`, 'success');
    
    // Update UI
    updatePositionUI(direction);
    const card = document.getElementById(`${direction}-card`);
    if (card) card.style.borderLeftColor = '#00ff88';
    
    // Subscribe to contract updates
    ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: buy.contract_id,
        req_id: Date.now()
    }));
    
    // Enable close buttons if both positions exist
    if (currentPositions.higher && currentPositions.lower) {
        if (closeHigherBtn) closeHigherBtn.disabled = false;
        if (closeLowerBtn) closeLowerBtn.disabled = false;
        if (closeBothBtn) closeBothBtn.disabled = false;
        addLog(`🎯 BOTH POSITIONS ACTIVE! Monitoring P&L...`, 'success');
    }
}

function handleContractUpdate(contract) {
    // Find which position this contract belongs to
    let direction = null;
    if (currentPositions.higher && currentPositions.higher.id === contract.contract_id) {
        direction = 'higher';
    } else if (currentPositions.lower && currentPositions.lower.id === contract.contract_id) {
        direction = 'lower';
    } else {
        return;
    }
    
    const pos = currentPositions[direction];
    if (!pos) return;
    
    // CRITICAL: The correct current value is in contract.current_spot
    // For options, the value changes based on how close the price is to the barrier
    const currentValue = contract.current_spot || contract.buy_price || 0;
    
    // Calculate profit correctly
    const profit = currentValue - pos.entryPrice;
    
    // Update position data
    pos.currentValue = currentValue;
    pos.profit = profit;
    
    // Update UI
    updatePositionUI(direction);
    
    // Update net profit display
    updateNetProfit();
    
    // Check if contract is closed
    if (contract.is_sold) {
        const finalProfit = contract.profit || profit;
        addLog(`📊 ${direction.toUpperCase()} CLOSED: ${finalProfit >= 0 ? 'WIN' : 'LOSS'} $${finalProfit.toFixed(2)}`, finalProfit >= 0 ? 'success' : 'error');
        
        currentPositions[direction] = null;
        resetPositionUI(direction);
        const card = document.getElementById(`${direction}-card`);
        if (card) card.style.borderLeftColor = '#444';
        
        // If both closed, complete cycle
        if (!currentPositions.higher && !currentPositions.lower) {
            // Calculate final net profit
            const netProfit = (currentPositions.higher?.profit || 0) + (currentPositions.lower?.profit || 0);
            
            sessionStats.cycles++;
            if (netProfit > 0) sessionStats.wins++;
            sessionStats.totalProfit += netProfit;
            updateStats();
            
            addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            addLog(`🏁 CYCLE COMPLETE | Net: ${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}`, netProfit >= 0 ? 'success' : 'error');
            addLog(`📈 Total Profit: $${sessionStats.totalProfit.toFixed(2)}`, 'success');
            addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            
            // Disable close buttons
            if (closeHigherBtn) closeHigherBtn.disabled = true;
            if (closeLowerBtn) closeLowerBtn.disabled = true;
            if (closeBothBtn) closeBothBtn.disabled = true;
            
            // Reset positions object
            currentPositions = { higher: null, lower: null };
            
            // Schedule next trade
            if (isBotRunning) {
                addLog(`🔄 Next cycle in 3 seconds...`);
                setTimeout(() => placeBothTrades(), 3000);
            }
        }
    }
}

// Close functions
function closeContract(direction) {
    const pos = currentPositions[direction];
    if (!pos || !pos.id) {
        addLog(`No active ${direction.toUpperCase()} contract`, 'error');
        return;
    }
    addLog(`🔒 Closing ${direction.toUpperCase()} contract (ID: ${pos.id})...`);
    ws.send(JSON.stringify({ sell: pos.id, price: 0, req_id: Date.now() }));
}

function closeBoth() {
    addLog(`🔒 Closing BOTH contracts...`);
    if (currentPositions.higher) closeContract('higher');
    if (currentPositions.lower) closeContract('lower');
}

// Bot controls
function startBot() {
    if (!isConnected) {
        addLog('Please connect first', 'error');
        return;
    }
    if (!currentPrice) {
        addLog('Waiting for price feed...', 'error');
        setTimeout(startBot, 1000);
        return;
    }
    
    // Reset positions before starting
    currentPositions = { higher: null, lower: null };
    resetPositionUI('higher');
    resetPositionUI('lower');
    
    isBotRunning = true;
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (emergencyBtn) emergencyBtn.disabled = false;
    
    addLog(`🚀 HEDGE BOT STARTED on ${marketSelect.value}`, 'success');
    addLog(`💡 Settings: $${stakeInput.value} each | ${durationInput.value} ticks | offset ${offsetInput.value}`);
    
    placeBothTrades();
}

function stopBot() {
    isBotRunning = false;
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    addLog(`🛑 Bot stopped`, 'error');
}

function emergencyStop() {
    addLog(`⚠️⚠️⚠️ EMERGENCY STOP - Closing all positions ⚠️⚠️⚠️`, 'error');
    isBotRunning = false;
    if (currentPositions.higher) closeContract('higher');
    if (currentPositions.lower) closeContract('lower');
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
}

// Account switching
function switchAccount(type) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        addLog('Not connected', 'error');
        return;
    }
    addLog(`Switching to ${type} account...`);
    ws.send(JSON.stringify({ switch_account: type === 'demo' ? 1 : 0, req_id: Date.now() }));
}

function enableControls(enabled) {
    if (marketSelect) marketSelect.disabled = !enabled;
    if (stakeInput) stakeInput.disabled = !enabled;
    if (durationInput) durationInput.disabled = !enabled;
    if (offsetInput) offsetInput.disabled = !enabled;
    if (!enabled) {
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = true;
        if (emergencyBtn) emergencyBtn.disabled = true;
    }
}

function onMarketChange() {
    currentSymbol = marketSelect.value;
    addLog(`Switched to ${marketSelect.options[marketSelect.selectedIndex].text}`);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ forget_all: 'ticks', req_id: Date.now() }));
        ws.send(JSON.stringify({ ticks: currentSymbol, subscribe: 1, req_id: Date.now() }));
    }
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    // Get all DOM elements
    connectBtn = document.getElementById('connect-btn');
    startBtn = document.getElementById('start-btn');
    stopBtn = document.getElementById('stop-btn');
    emergencyBtn = document.getElementById('emergency-btn');
    demoSwitch = document.getElementById('demo-switch');
    realSwitch = document.getElementById('real-switch');
    marketSelect = document.getElementById('market');
    stakeInput = document.getElementById('stake');
    durationInput = document.getElementById('duration');
    offsetInput = document.getElementById('offset');
    closeHigherBtn = document.getElementById('close-higher');
    closeLowerBtn = document.getElementById('close-lower');
    closeBothBtn = document.getElementById('close-both');
    tokenInput = document.getElementById('token');
    
    // Attach event listeners
    if (connectBtn) {
        connectBtn.addEventListener('click', () => {
            const token = tokenInput ? tokenInput.value.trim() : '';
            if (!token) {
                addLog('❌ Please enter your API token', 'error');
                return;
            }
            localStorage.setItem('deriv_token', token);
            connectWebSocket(token);
        });
    }
    
    if (startBtn) startBtn.addEventListener('click', startBot);
    if (stopBtn) stopBtn.addEventListener('click', stopBot);
    if (emergencyBtn) emergencyBtn.addEventListener('click', emergencyStop);
    if (demoSwitch) demoSwitch.addEventListener('click', () => switchAccount('demo'));
    if (realSwitch) realSwitch.addEventListener('click', () => switchAccount('real'));
    if (marketSelect) marketSelect.addEventListener('change', onMarketChange);
    if (closeHigherBtn) closeHigherBtn.addEventListener('click', () => closeContract('higher'));
    if (closeLowerBtn) closeLowerBtn.addEventListener('click', () => closeContract('lower'));
    if (closeBothBtn) closeBothBtn.addEventListener('click', closeBoth);
    
    // Load saved token
    const savedToken = localStorage.getItem('deriv_token');
    if (savedToken && tokenInput) {
        tokenInput.value = savedToken;
        addLog('Found saved token, connecting...');
        connectWebSocket(savedToken);
    } else {
        addLog('🛡️ Hedge Bot v2.0 Ready - Enter your API token and click Connect');
    }
});
