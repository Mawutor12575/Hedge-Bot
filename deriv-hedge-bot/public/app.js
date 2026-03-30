// ============================================
// DERIV HEDGE BOT - PARALLEL TRADING SYSTEM v2
// Fixed: Proper parallel trade placement
// ============================================

// ===== CONFIGURATION =====
let ws = null;
let isBotRunning = false;
let isConnected = false;
let tradingLock = false;
let currentPrice = null;
let currentSymbol = 'R_75';
let tickHistory = [];
let lastDigits = [];
let pendingProposals = {
    higher: { sent: false, proposalId: null, requestId: null },
    lower: { sent: false, proposalId: null, requestId: null }
};
let currentPositions = { higher: null, lower: null };
let sessionStats = {
    totalCycles: 0,
    winningCycles: 0,
    totalNetProfit: 0
};

// ===== DOM Elements =====
const connectBtn = document.getElementById('connect-btn');
const startBtn = document.getElementById('start-bot');
const stopBtn = document.getElementById('stop-bot');
const emergencyBtn = document.getElementById('emergency-stop');
const demoBtn = document.getElementById('demo-btn');
const realBtn = document.getElementById('real-btn');
const marketSelect = document.getElementById('market-select');
const stakeInput = document.getElementById('stake');
const durationInput = document.getElementById('duration');
const offsetInput = document.getElementById('offset');
const minPayoutInput = document.getElementById('min-payout');
const profitTargetInput = document.getElementById('profit-target');
const closeHigherBtn = document.getElementById('close-higher');
const closeLowerBtn = document.getElementById('close-lower');
const closeBothBtn = document.getElementById('close-both');
const pauseTicksBtn = document.getElementById('pause-ticks-btn');

// Auto-close toggle
let autoCloseToggle = true;

// ===== Helper Functions =====
function addLogEntry(message, type = 'system') {
    const logContainer = document.getElementById('trade-log');
    if (!logContainer) return;
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const timestamp = new Date().toLocaleTimeString();
    entry.innerHTML = `<span style="color:#666;">[${timestamp}]</span> ${message}`;
    logContainer.insertBefore(entry, logContainer.firstChild);
    
    while (logContainer.children.length > 200) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

function updateBalanceDisplay(balance) {
    const balanceEl = document.getElementById('account-balance');
    if (balanceEl) balanceEl.textContent = `$${parseFloat(balance).toFixed(2)}`;
}

function updatePriceDisplay(price) {
    const priceEl = document.getElementById('current-price');
    if (priceEl) priceEl.textContent = `$${price.toFixed(2)}`;
}

function updateStatsDisplay() {
    const winRate = sessionStats.totalCycles > 0 
        ? (sessionStats.winningCycles / sessionStats.totalCycles * 100).toFixed(1) 
        : 0;
    
    const totalCyclesEl = document.getElementById('total-cycles');
    const winningCyclesEl = document.getElementById('winning-cycles');
    const winRateEl = document.getElementById('win-rate');
    const totalProfitEl = document.getElementById('total-profit');
    
    if (totalCyclesEl) totalCyclesEl.textContent = sessionStats.totalCycles;
    if (winningCyclesEl) winningCyclesEl.textContent = sessionStats.winningCycles;
    if (winRateEl) winRateEl.textContent = `${winRate}%`;
    if (totalProfitEl) {
        totalProfitEl.textContent = `$${sessionStats.totalNetProfit.toFixed(2)}`;
        totalProfitEl.className = `stat-value ${sessionStats.totalNetProfit >= 0 ? 'profit' : 'loss'}`;
    }
}

function updateCombinedValues() {
    const higherProfit = currentPositions.higher?.profit || 0;
    const lowerProfit = currentPositions.lower?.profit || 0;
    const netProfit = higherProfit + lowerProfit;
    const combinedValue = (currentPositions.higher?.currentValue || 0) + (currentPositions.lower?.currentValue || 0);
    
    const combinedValueEl = document.getElementById('combined-value');
    const netProfitEl = document.getElementById('net-profit');
    
    if (combinedValueEl) combinedValueEl.textContent = `$${combinedValue.toFixed(2)}`;
    if (netProfitEl) {
        netProfitEl.textContent = `${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}`;
        netProfitEl.style.color = netProfit >= 0 ? '#00ff88' : '#ff4444';
    }
    
    // Update progress bar
    const target = parseFloat(profitTargetInput.value);
    if (target > 0) {
        const progress = Math.min((netProfit / target) * 100, 100);
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        if (progressFill) progressFill.style.width = `${progress}%`;
        if (progressText) progressText.textContent = `${Math.round(progress)}%`;
    }
    
    // Auto-close if target reached
    if (autoCloseToggle && netProfit >= target && target > 0 && (currentPositions.higher || currentPositions.lower)) {
        addLogEntry(`🎯 Target reached! Net profit $${netProfit.toFixed(2)} >= $${target.toFixed(2)}`, 'win');
        closeBothContracts();
    }
}

function updatePositionDisplay(direction, position) {
    const entryEl = document.getElementById(`${direction}-entry`);
    const currentEl = document.getElementById(`${direction}-current`);
    const ticksEl = document.getElementById(`${direction}-ticks`);
    const pnlEl = document.getElementById(`${direction}-pnl`);
    const barrierEl = document.getElementById(`${direction}-barrier`);
    
    if (entryEl) entryEl.textContent = `$${position.entryPrice.toFixed(2)}`;
    if (currentEl) currentEl.textContent = `$${position.currentValue.toFixed(2)}`;
    if (ticksEl) ticksEl.textContent = position.ticksLeft || 0;
    if (barrierEl) barrierEl.textContent = position.barrier;
    if (pnlEl) {
        pnlEl.textContent = `${position.profit >= 0 ? '+' : ''}$${position.profit.toFixed(2)}`;
        pnlEl.className = position.profit >= 0 ? 'gain' : 'loss';
    }
    
    // Update tick indicators
    updateTickIndicators(direction, position);
}

function updateTickIndicators(direction, position) {
    const indicator = document.getElementById(`${direction}-tick-indicator`);
    if (!indicator) return;
    
    const circles = indicator.querySelectorAll('.tick-circle');
    const ticksElapsed = position.ticksElapsed || 0;
    
    circles.forEach((circle, index) => {
        if (index < ticksElapsed) {
            if (position.profit > 0) {
                circle.classList.add('profit');
                circle.classList.remove('loss');
            } else if (position.profit < 0) {
                circle.classList.add('loss');
                circle.classList.remove('profit');
            }
        }
    });
}

function createTickIndicators(duration) {
    ['higher', 'lower'].forEach(direction => {
        const indicator = document.getElementById(`${direction}-tick-indicator`);
        if (indicator) {
            indicator.innerHTML = '';
            for (let i = 0; i < duration; i++) {
                const circle = document.createElement('div');
                circle.className = 'tick-circle';
                indicator.appendChild(circle);
            }
        }
    });
}

function showGlow(direction, type) {
    const element = document.getElementById(`${direction}-position`);
    if (!element) return;
    element.classList.remove('gain-glow', 'loss-glow');
    void element.offsetWidth;
    element.classList.add(`${type}-glow`);
    setTimeout(() => element.classList.remove(`${type}-glow`), 1000);
}

// ===== WebSocket Connection =====
function connectWebSocket(token) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    
    ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=84911');
    
    ws.onopen = () => {
        addLogEntry('WebSocket connected, authorizing...', 'system');
        ws.send(JSON.stringify({ authorize: token, req_id: Date.now() }));
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleMessage(data);
        } catch (e) {
            console.error('Parse error:', e);
        }
    };
    
    ws.onerror = () => addLogEntry('WebSocket error', 'error');
    
    ws.onclose = () => {
        addLogEntry('WebSocket disconnected', 'error');
        isConnected = false;
        updateAuthStatus(false);
        enableControls(false);
    };
}

function handleMessage(data) {
    if (data.error) {
        addLogEntry(`Error: ${data.error.message}`, 'error');
        if (data.error.code === 'InvalidToken') {
            localStorage.removeItem('deriv_token');
            updateAuthStatus(false);
        }
        return;
    }
    
    // Authorization response
    if (data.authorize) {
        isConnected = true;
        updateAuthStatus(true);
        updateBalanceDisplay(data.authorize.balance);
        
        const accountType = data.authorize.loginid?.startsWith('VRTC') ? 'demo' : 'real';
        addLogEntry(`✅ Connected: ${data.authorize.email || data.authorize.loginid} (${accountType.toUpperCase()})`, 'success');
        
        enableControls(true);
        startBtn.disabled = false;
        
        // Subscribe to ticks
        ws.send(JSON.stringify({ ticks: currentSymbol, subscribe: 1, req_id: Date.now() }));
        ws.send(JSON.stringify({ balance: 1, req_id: Date.now() }));
        
        if (accountType === 'demo') {
            demoBtn.classList.add('active');
            realBtn.classList.remove('active');
        } else {
            realBtn.classList.add('active');
            demoBtn.classList.remove('active');
        }
    }
    
    // Tick response
    if (data.tick) {
        handleTick(data.tick);
    }
    
    // Balance update
    if (data.balance) {
        updateBalanceDisplay(data.balance.balance);
    }
    
    // Proposal response
    if (data.proposal) {
        handleProposalResponse(data.proposal);
    }
    
    // Buy response
    if (data.buy) {
        handleBuyResponse(data.buy);
    }
    
    // Sell response
    if (data.sell) {
        handleSellResponse(data.sell);
    }
    
    // Contract update
    if (data.proposal_open_contract) {
        handleContractUpdate(data.proposal_open_contract);
    }
}

function handleTick(tick) {
    if (!tick.quote) return;
    
    currentPrice = tick.quote;
    updatePriceDisplay(currentPrice);
    
    // Update tick history
    const tickData = { price: currentPrice, time: Date.now() };
    tickHistory.unshift(tickData);
    if (tickHistory.length > 30) tickHistory.pop();
    
    // Update last digit
    const priceStr = currentPrice.toFixed(2);
    const lastDigit = priceStr.slice(-1);
    const lastDigitEl = document.getElementById('last-digit');
    if (lastDigitEl) lastDigitEl.textContent = lastDigit;
    
    // Update last 10 digits
    lastDigits.unshift(lastDigit);
    if (lastDigits.length > 10) lastDigits.pop();
    const lastTenEl = document.getElementById('last-ten-digits');
    if (lastTenEl) lastTenEl.textContent = lastDigits.join(' ');
    
    // Update tick display if not paused
    if (!isTickDisplayPaused) updateTickDisplay();
}

let isTickDisplayPaused = false;

function updateTickDisplay() {
    const container = document.getElementById('tick-history');
    if (!container) return;
    
    if (tickHistory.length === 0) {
        container.innerHTML = '<div class="tick-placeholder">Waiting for ticks...</div>';
        return;
    }
    
    container.innerHTML = '';
    tickHistory.slice(0, 20).forEach((tick, index) => {
        const change = index > 0 ? tick.price - tickHistory[index - 1].price : 0;
        const changeClass = change >= 0 ? 'up' : 'down';
        const tickEl = document.createElement('div');
        tickEl.className = `tick-item ${changeClass}`;
        tickEl.innerHTML = `$${tick.price.toFixed(2)} ${change >= 0 ? '▲' : '▼'}${Math.abs(change).toFixed(2)}`;
        container.appendChild(tickEl);
    });
}

function toggleTickDisplay() {
    isTickDisplayPaused = !isTickDisplayPaused;
    if (pauseTicksBtn) {
        pauseTicksBtn.textContent = isTickDisplayPaused ? 'Resume' : 'Pause';
    }
    if (!isTickDisplayPaused) updateTickDisplay();
}

// ===== Core Trading Logic =====
async function placeHedgeTrade() {
    if (!isBotRunning) {
        addLogEntry('Bot is not running, stopping trade cycle', 'system');
        return;
    }
    if (tradingLock) {
        setTimeout(placeHedgeTrade, 2000);
        return;
    }
    if (currentPositions.higher || currentPositions.lower) {
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
    const minPayout = parseFloat(minPayoutInput.value);
    
    const higherBarrier = `+${offset.toFixed(4)}`;
    const lowerBarrier = `-${offset.toFixed(4)}`;
    
    addLogEntry(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
    addLogEntry(`🎯 Placing PARALLEL HEDGE TRADE at ${currentPrice.toFixed(2)}`, 'system');
    addLogEntry(`📈 HIGHER: ${higherBarrier} | 📉 LOWER: ${lowerBarrier}`, 'system');
    addLogEntry(`⏱️ Duration: ${duration} ticks | 💰 Stake: $${stake} each`, 'system');
    addLogEntry(`🎯 Min payout needed: ${minPayout}x ($${minPayout.toFixed(2)} net profit)`, 'system');
    addLogEntry(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
    
    // Reset pending proposals
    pendingProposals = {
        higher: { sent: true, proposalId: null, requestId: Date.now() + '_higher' },
        lower: { sent: true, proposalId: null, requestId: Date.now() + '_lower' }
    };
    
    // Send HIGHER (CALL) proposal
    const higherReqId = Date.now();
    addLogEntry(`📤 Sending HIGHER (CALL) proposal...`, 'system');
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
    
    // Send LOWER (PUT) proposal after 500ms to ensure both are processed
    setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN && isBotRunning) {
            const lowerReqId = Date.now();
            addLogEntry(`📤 Sending LOWER (PUT) proposal...`, 'system');
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
    }, 500);
}

function handleProposalResponse(proposal) {
    const direction = proposal.contract_type === 'CALL' ? 'higher' : 'lower';
    const stake = parseFloat(stakeInput.value);
    const payout = parseFloat(proposal.payout);
    const netProfit = payout - stake;
    const minPayout = parseFloat(minPayoutInput.value);
    
    addLogEntry(`📝 ${direction.toUpperCase()} proposal: Payout $${payout.toFixed(2)} | Net $${netProfit.toFixed(2)} (${(payout).toFixed(2)}x)`, 'system');
    
    if (netProfit >= minPayout) {
        addLogEntry(`✅ ${direction.toUpperCase()} accepted - purchasing...`, 'success');
        ws.send(JSON.stringify({
            buy: proposal.id,
            price: proposal.ask_price,
            req_id: Date.now()
        }));
    } else {
        addLogEntry(`❌ ${direction.toUpperCase()} rejected: Net $${netProfit.toFixed(2)} < min $${minPayout.toFixed(2)}`, 'error');
        
        // If both proposals are rejected, unlock trading
        if (!currentPositions.higher && !currentPositions.lower) {
            tradingLock = false;
            if (isBotRunning) {
                setTimeout(() => placeHedgeTrade(), 3000);
            }
        }
    }
}

function handleBuyResponse(buy) {
    const direction = buy.contract_type === 'CALL' ? 'higher' : 'lower';
    
    // Update status display
    const statusEl = document.getElementById(`${direction}-status`);
    const barrierEl = document.getElementById(`${direction}-barrier`);
    if (statusEl) statusEl.textContent = 'Active';
    if (barrierEl) barrierEl.textContent = buy.barrier;
    
    currentPositions[direction] = {
        id: buy.contract_id,
        entryPrice: buy.buy_price,
        barrier: buy.barrier,
        duration: buy.duration,
        buyTimestamp: Date.now(),
        contractType: buy.contract_type,
        ticksElapsed: 0,
        ticksLeft: buy.duration,
        currentValue: buy.buy_price,
        profit: 0
    };
    
    addLogEntry(`✅ ${direction.toUpperCase()} PURCHASED! ID: ${buy.contract_id} | Entry: $${buy.buy_price}`, 'success');
    
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
        addLogEntry(`🎯 BOTH POSITIONS ACTIVE! Monitoring for profit...`, 'success');
        addLogEntry(`💰 Target net profit: $${(currentPositions.higher.profit + currentPositions.lower.profit).toFixed(2)}`, 'system');
    }
}

function handleContractUpdate(contract) {
    let direction = null;
    if (currentPositions.higher && currentPositions.higher.id === contract.contract_id) {
        direction = 'higher';
    } else if (currentPositions.lower && currentPositions.lower.id === contract.contract_id) {
        direction = 'lower';
    } else {
        return;
    }
    
    const position = currentPositions[direction];
    if (!position) return;
    
    const currentValue = contract.sell_price || contract.current_spot || contract.buy_price || 0;
    const profit = currentValue - position.entryPrice;
    
    // Calculate ticks left
    let ticksLeft = 0;
    if (contract.date_expiry) {
        ticksLeft = Math.max(0, contract.date_expiry - Math.floor(Date.now() / 1000));
    } else {
        const elapsedSeconds = (Date.now() - position.buyTimestamp) / 1000;
        ticksLeft = Math.max(0, position.duration - Math.floor(elapsedSeconds));
    }
    const ticksElapsed = position.duration - ticksLeft;
    
    // Update position data
    position.currentValue = currentValue;
    position.ticksLeft = ticksLeft;
    position.ticksElapsed = ticksElapsed;
    position.profit = profit;
    
    // Update display
    updatePositionDisplay(direction, position);
    updateCombinedValues();
    
    // Show glow effect on value change
    const prevProfit = position.prevProfit || 0;
    if (profit > prevProfit) showGlow(direction, 'gain');
    else if (profit < prevProfit) showGlow(direction, 'loss');
    position.prevProfit = profit;
    
    // Check if contract is closed
    if (contract.is_sold) {
        handleContractClosed(direction, profit);
    }
}

function handleContractClosed(direction, profit) {
    addLogEntry(`📊 ${direction.toUpperCase()} CLOSED: ${profit >= 0 ? '✅ WIN' : '❌ LOSS'} $${profit.toFixed(2)}`, profit >= 0 ? 'win' : 'loss');
    
    // Reset position
    currentPositions[direction] = null;
    const statusEl = document.getElementById(`${direction}-status`);
    if (statusEl) statusEl.textContent = 'Closed';
    
    // Disable close buttons
    if (!currentPositions.higher && !currentPositions.lower) {
        if (closeHigherBtn) closeHigherBtn.disabled = true;
        if (closeLowerBtn) closeLowerBtn.disabled = true;
        if (closeBothBtn) closeBothBtn.disabled = true;
        
        // Calculate net cycle profit
        const higherProfit = currentPositions.higher?.profit || 0;
        const lowerProfit = currentPositions.lower?.profit || 0;
        const netCycleProfit = higherProfit + lowerProfit;
        
        sessionStats.totalCycles++;
        if (netCycleProfit > 0) sessionStats.winningCycles++;
        sessionStats.totalNetProfit += netCycleProfit;
        updateStatsDisplay();
        
        addLogEntry(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
        addLogEntry(`🏁 CYCLE COMPLETE | Net: ${netCycleProfit >= 0 ? '+' : ''}$${netCycleProfit.toFixed(2)}`, netCycleProfit >= 0 ? 'win' : 'loss');
        addLogEntry(`📈 Total Net Profit: $${sessionStats.totalNetProfit.toFixed(2)}`, 'system');
        addLogEntry(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
        
        // Reset for next cycle
        tradingLock = false;
        
        // Clear tick indicators
        createTickIndicators(parseInt(durationInput.value));
        
        if (isBotRunning) {
            addLogEntry(`🔄 Next trade cycle in 3 seconds...`, 'system');
            setTimeout(() => placeHedgeTrade(), 3000);
        }
    }
}

function handleSellResponse(sell) {
    const profit = sell.sold_for - sell.bought_for;
    addLogEntry(`💰 Sold contract for $${sell.sold_for.toFixed(2)} | ${profit >= 0 ? 'Profit' : 'Loss'}: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`, profit >= 0 ? 'win' : 'loss');
}

// ===== Contract Management =====
function closeContract(direction) {
    const position = currentPositions[direction];
    if (!position || !position.id) {
        addLogEntry(`⚠️ No active ${direction.toUpperCase()} contract`, 'error');
        return;
    }
    
    addLogEntry(`🔒 Closing ${direction.toUpperCase()} contract (ID: ${position.id})`, 'system');
    ws.send(JSON.stringify({ sell: position.id, price: 0, req_id: Date.now() }));
}

function closeBothContracts() {
    addLogEntry(`🔒 Closing BOTH contracts...`, 'system');
    if (currentPositions.higher) closeContract('higher');
    if (currentPositions.lower) closeContract('lower');
}

// ===== Bot Controls =====
function startBot() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        addLogEntry('❌ Please connect to Deriv first', 'error');
        return;
    }
    if (!currentPrice) {
        addLogEntry('⏳ Waiting for price feed...', 'system');
        setTimeout(startBot, 2000);
        return;
    }
    
    isBotRunning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    tradingLock = false;
    
    // Reset positions display
    currentPositions = { higher: null, lower: null };
    const higherStatus = document.getElementById('higher-status');
    const lowerStatus = document.getElementById('lower-status');
    if (higherStatus) higherStatus.textContent = 'Waiting';
    if (lowerStatus) lowerStatus.textContent = 'Waiting';
    
    // Reset position values
    const resetFields = ['higher-entry', 'higher-current', 'higher-ticks', 'higher-pnl',
                         'lower-entry', 'lower-current', 'lower-ticks', 'lower-pnl',
                         'higher-barrier', 'lower-barrier'];
    resetFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '-';
    });
    
    // Create tick indicators
    createTickIndicators(parseInt(durationInput.value));
    
    const stake = parseFloat(stakeInput.value);
    const minPayout = parseFloat(minPayoutInput.value);
    const targetNet = stake * (minPayout - 2);
    
    addLogEntry(`🚀 HEDGE BOT STARTED on ${marketSelect.value}`, 'success');
    addLogEntry(`💡 Target net profit per win side: $${targetNet.toFixed(2)}`, 'system');
    addLogEntry(`💡 Total risk per cycle: $${(stake * 2).toFixed(2)}`, 'system');
    
    placeHedgeTrade();
}

function stopBot() {
    isBotRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    tradingLock = false;
    addLogEntry(`🛑 Bot stopped by user`, 'system');
}

function emergencyStop() {
    addLogEntry(`⚠️⚠️⚠️ EMERGENCY STOP ACTIVATED ⚠️⚠️⚠️`, 'error');
    isBotRunning = false;
    tradingLock = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    
    if (currentPositions.higher) closeContract('higher');
    if (currentPositions.lower) closeContract('lower');
    
    addLogEntry(`🔒 Emergency stop complete - all positions closed`, 'success');
}

// ===== Connection Management =====
function connectWithToken() {
    const token = document.getElementById('api-token').value.trim();
    if (!token) {
        addLogEntry('❌ Please enter your API token', 'error');
        return;
    }
    addLogEntry('🔌 Connecting to Deriv...', 'system');
    localStorage.setItem('deriv_token', token);
    connectWebSocket(token);
}

function switchAccount(type) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    addLogEntry(`🔄 Switching to ${type.toUpperCase()} account...`, 'system');
    ws.send(JSON.stringify({ switch_account: type === 'demo' ? 1 : 0, req_id: Date.now() }));
}

function updateAuthStatus(connected) {
    const authStatus = document.getElementById('auth-status');
    const tokenSection = document.getElementById('token-section');
    const accountSwitch = document.getElementById('account-switch');
    
    if (connected) {
        if (authStatus) {
            authStatus.className = 'auth-status connected';
            const statusSpan = authStatus.querySelector('span:last-child');
            if (statusSpan) statusSpan.textContent = 'Connected';
        }
        if (tokenSection) tokenSection.style.display = 'none';
        if (accountSwitch) accountSwitch.style.display = 'flex';
    } else {
        if (authStatus) {
            authStatus.className = 'auth-status';
            const statusSpan = authStatus.querySelector('span:last-child');
            if (statusSpan) statusSpan.textContent = 'Disconnected';
        }
        if (tokenSection) tokenSection.style.display = 'flex';
        if (accountSwitch) accountSwitch.style.display = 'none';
    }
}

function enableControls(enabled) {
    const inputs = [stakeInput, durationInput, offsetInput, minPayoutInput, profitTargetInput, marketSelect];
    inputs.forEach(input => { if (input) input.disabled = !enabled; });
    if (emergencyBtn) emergencyBtn.disabled = !enabled;
    if (!enabled) {
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = true;
    }
}

function onMarketChange() {
    currentSymbol = marketSelect.value;
    const marketSymbolSpan = document.getElementById('market-symbol');
    if (marketSymbolSpan) marketSymbolSpan.textContent = currentSymbol;
    
    const selectedText = marketSelect.options[marketSelect.selectedIndex]?.text;
    addLogEntry(`📊 Switched to ${selectedText} (${currentSymbol})`, 'system');
    
    // Update offset hint based on market
    const offsetHint = document.getElementById('offset-hint');
    if (offsetHint) {
        if (currentSymbol === 'R_75') {
            offsetHint.textContent = 'Recommended: 0.50-0.65 for 2.20x+ payout';
            if (offsetInput && !offsetInput.disabled) offsetInput.value = 0.55;
        } else if (currentSymbol === 'R_100') {
            offsetHint.textContent = 'Recommended: 0.60-0.80 for 2.20x+ payout';
            if (offsetInput && !offsetInput.disabled) offsetInput.value = 0.70;
        } else {
            offsetHint.textContent = 'Adjust offset to achieve 2.20x+ payout';
        }
    }
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ forget_all: 'ticks', req_id: Date.now() }));
        ws.send(JSON.stringify({ ticks: currentSymbol, subscribe: 1, req_id: Date.now() }));
    }
}

// ===== Event Listeners =====
if (connectBtn) connectBtn.addEventListener('click', connectWithToken);
if (startBtn) startBtn.addEventListener('click', startBot);
if (stopBtn) stopBtn.addEventListener('click', stopBot);
if (emergencyBtn) emergencyBtn.addEventListener('click', emergencyStop);
if (demoBtn) demoBtn.addEventListener('click', () => switchAccount('demo'));
if (realBtn) realBtn.addEventListener('click', () => switchAccount('real'));
if (marketSelect) marketSelect.addEventListener('change', onMarketChange);
if (pauseTicksBtn) pauseTicksBtn.addEventListener('click', toggleTickDisplay);
if (closeHigherBtn) closeHigherBtn.addEventListener('click', () => closeContract('higher'));
if (closeLowerBtn) closeLowerBtn.addEventListener('click', () => closeContract('lower'));
if (closeBothBtn) closeBothBtn.addEventListener('click', closeBothContracts);

// Load saved token on startup
window.addEventListener('load', () => {
    const token = localStorage.getItem('deriv_token');
    if (token) {
        const tokenInput = document.getElementById('api-token');
        if (tokenInput) tokenInput.value = token;
        connectWithToken();
    }
    addLogEntry('🛡️ Hedge Bot v2.0 Ready', 'system');
    addLogEntry('💡 Connect your API token and click Start Bot', 'system');
});
