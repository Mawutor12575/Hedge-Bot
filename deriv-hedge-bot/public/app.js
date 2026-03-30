// ============================================
// SIMPLE HEDGE BOT - PLACES BOTH HIGHER & LOWER
// ============================================

// State
let ws = null;
let isBotRunning = false;
let isConnected = false;
let currentPrice = null;
let currentSymbol = 'R_75';
let currentPositions = { higher: null, lower: null };
let pendingProposals = { higher: false, lower: false };
let sessionStats = { cycles: 0, wins: 0, totalProfit: 0 };

// DOM Elements
const connectBtn = document.getElementById('connect-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const emergencyBtn = document.getElementById('emergency-btn');
const demoSwitch = document.getElementById('demo-switch');
const realSwitch = document.getElementById('real-switch');
const marketSelect = document.getElementById('market');
const stakeInput = document.getElementById('stake');
const durationInput = document.getElementById('duration');
const offsetInput = document.getElementById('offset');
const closeHigherBtn = document.getElementById('close-higher');
const closeLowerBtn = document.getElementById('close-lower');
const closeBothBtn = document.getElementById('close-both');
const logDiv = document.getElementById('log');

// Helper: Add log entry
function addLog(msg, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logDiv.insertBefore(entry, logDiv.firstChild);
    while (logDiv.children.length > 100) logDiv.removeChild(logDiv.lastChild);
}

// Update displays
function updateBalance(balance) {
    document.getElementById('balance-display').innerHTML = `Balance: $${parseFloat(balance).toFixed(2)}`;
}

function updatePrice(price) {
    document.getElementById('price-display').innerHTML = `Price: $${price.toFixed(2)}`;
    currentPrice = price;
}

function updateStats() {
    const winRate = sessionStats.cycles > 0 ? (sessionStats.wins / sessionStats.cycles * 100).toFixed(1) : 0;
    document.getElementById('cycle-count').innerHTML = sessionStats.cycles;
    document.getElementById('win-count').innerHTML = `${sessionStats.wins} (${winRate}%)`;
    document.getElementById('total-profit').innerHTML = `$${sessionStats.totalProfit.toFixed(2)}`;
}

function updateNetProfit() {
    const higherProfit = currentPositions.higher?.profit || 0;
    const lowerProfit = currentPositions.lower?.profit || 0;
    const net = higherProfit + lowerProfit;
    document.getElementById('net-profit').innerHTML = `$${net.toFixed(2)}`;
    document.getElementById('net-profit').style.color = net >= 0 ? '#00ff88' : '#ff4444';
    return net;
}

function updatePositionUI(direction, position) {
    document.getElementById(`${direction}-barrier`).innerHTML = position.barrier || '-';
    document.getElementById(`${direction}-entry`).innerHTML = position.entryPrice ? `$${position.entryPrice.toFixed(2)}` : '-';
    document.getElementById(`${direction}-current`).innerHTML = position.currentValue ? `$${position.currentValue.toFixed(2)}` : '-';
    const pnlSpan = document.getElementById(`${direction}-pnl`);
    pnlSpan.innerHTML = position.profit ? `${position.profit >= 0 ? '+' : ''}$${position.profit.toFixed(2)}` : '-';
    pnlSpan.style.color = position.profit >= 0 ? '#00ff88' : '#ff4444';
}

function resetPositionUI(direction) {
    document.getElementById(`${direction}-barrier`).innerHTML = '-';
    document.getElementById(`${direction}-entry`).innerHTML = '-';
    document.getElementById(`${direction}-current`).innerHTML = '-';
    document.getElementById(`${direction}-pnl`).innerHTML = '-';
}

// WebSocket connection
function connect(token) {
    if (ws) ws.close();
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
            console.error(err);
        }
    };
    
    ws.onerror = () => addLog('WebSocket error', 'error');
    
    ws.onclose = () => {
        addLog('Disconnected', 'error');
        isConnected = false;
        document.getElementById('connection-status').classList.remove('connected');
        enableControls(false);
    };
}

function handleMessage(data) {
    if (data.error) {
        addLog(`Error: ${data.error.message}`, 'error');
        if (data.error.code === 'InvalidToken') {
            localStorage.removeItem('deriv_token');
            isConnected = false;
            document.getElementById('connection-status').classList.remove('connected');
        }
        return;
    }
    
    // Auth response
    if (data.authorize) {
        isConnected = true;
        document.getElementById('connection-status').classList.add('connected');
        document.getElementById('connection-status').querySelector('span:last-child').innerHTML = 'Connected';
        updateBalance(data.authorize.balance);
        addLog(`✅ Authorized: ${data.authorize.email || data.authorize.loginid}`, 'success');
        
        // Show account buttons
        document.getElementById('account-buttons').style.display = 'flex';
        const isDemo = data.authorize.loginid?.startsWith('VRTC');
        if (isDemo) {
            demoSwitch.classList.add('active');
            realSwitch.classList.remove('active');
        } else {
            realSwitch.classList.add('active');
            demoSwitch.classList.remove('active');
        }
        
        enableControls(true);
        startBtn.disabled = false;
        
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
    
    // Contract update
    if (data.proposal_open_contract) {
        handleContractUpdate(data.proposal_open_contract);
    }
    
    // Sell response
    if (data.sell) {
        addLog(`Contract sold for $${data.sell.sold_for.toFixed(2)}`, 'success');
    }
}

// Place both trades
function placeBothTrades() {
    if (!isBotRunning) return;
    if (currentPositions.higher || currentPositions.lower) {
        addLog('Positions already active, waiting...');
        return;
    }
    if (!currentPrice) {
        addLog('Waiting for price...');
        setTimeout(placeBothTrades, 1000);
        return;
    }
    
    const stake = parseFloat(stakeInput.value);
    const duration = parseInt(durationInput.value);
    const offset = parseFloat(offsetInput.value);
    const higherBarrier = `+${offset.toFixed(4)}`;
    const lowerBarrier = `-${offset.toFixed(4)}`;
    
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    addLog(`🎯 Placing BOTH trades at ${currentPrice.toFixed(2)}`);
    addLog(`📈 HIGHER (CALL) - Barrier: ${higherBarrier}`);
    addLog(`📉 LOWER (PUT) - Barrier: ${lowerBarrier}`);
    addLog(`⏱️ Duration: ${duration} ticks | 💰 Stake: $${stake} each`);
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    pendingProposals = { higher: true, lower: true };
    
    // Send HIGHER proposal
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
    
    // Send LOWER proposal after 1 second
    setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN && isBotRunning) {
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
    }, 1000);
}

function handleProposal(proposal) {
    const direction = proposal.contract_type === 'CALL' ? 'higher' : 'lower';
    const stake = parseFloat(stakeInput.value);
    const payout = parseFloat(proposal.payout);
    const netProfit = payout - stake;
    
    addLog(`📝 ${direction.toUpperCase()} proposal: Payout $${payout.toFixed(2)} | Net $${netProfit.toFixed(2)}`);
    
    // Accept any proposal with positive net profit (anything > 1x)
    if (netProfit > 0) {
        addLog(`✅ ${direction.toUpperCase()} accepted - buying...`, 'success');
        ws.send(JSON.stringify({
            buy: proposal.id,
            price: proposal.ask_price,
            req_id: Date.now()
        }));
    } else {
        addLog(`❌ ${direction.toUpperCase()} rejected: Net profit too low`, 'error');
        if (direction === 'higher') pendingProposals.higher = false;
        else pendingProposals.lower = false;
        
        // If both failed, retry
        if (!pendingProposals.higher && !pendingProposals.lower && isBotRunning) {
            addLog('Both proposals failed, retrying...');
            setTimeout(() => placeBothTrades(), 3000);
        }
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
    updatePositionUI(direction, currentPositions[direction]);
    document.getElementById(`${direction}-card`).style.borderLeftColor = '#00ff88';
    
    // Subscribe to contract updates
    ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: buy.contract_id,
        req_id: Date.now()
    }));
    
    // Enable buttons if both positions exist
    if (currentPositions.higher && currentPositions.lower) {
        closeHigherBtn.disabled = false;
        closeLowerBtn.disabled = false;
        closeBothBtn.disabled = false;
        addLog(`🎯 BOTH POSITIONS ACTIVE! Monitoring...`, 'success');
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
    
    const pos = currentPositions[direction];
    const currentValue = contract.sell_price || contract.current_spot || contract.buy_price || 0;
    const profit = currentValue - pos.entryPrice;
    
    pos.currentValue = currentValue;
    pos.profit = profit;
    
    // Calculate ticks left
    let ticksLeft = 0;
    if (contract.date_expiry) {
        ticksLeft = Math.max(0, contract.date_expiry - Math.floor(Date.now() / 1000));
    }
    const ticksElapsed = pos.duration - ticksLeft;
    
    // Update UI
    updatePositionUI(direction, pos);
    
    // Show glow effect
    const card = document.getElementById(`${direction}-card`);
    if (profit > (pos.prevProfit || 0)) {
        card.style.borderLeftColor = '#00ff88';
        card.style.transition = 'border-left-color 0.2s';
    } else if (profit < (pos.prevProfit || 0)) {
        card.style.borderLeftColor = '#ff4444';
    }
    pos.prevProfit = profit;
    
    // Update net profit
    updateNetProfit();
    
    // Check if contract closed
    if (contract.is_sold) {
        addLog(`📊 ${direction.toUpperCase()} CLOSED: ${profit >= 0 ? 'WIN' : 'LOSS'} $${profit.toFixed(2)}`, profit >= 0 ? 'success' : 'error');
        
        currentPositions[direction] = null;
        resetPositionUI(direction);
        document.getElementById(`${direction}-card`).style.borderLeftColor = '#444';
        
        // If both closed, complete cycle
        if (!currentPositions.higher && !currentPositions.lower) {
            const netProfit = updateNetProfit();
            sessionStats.cycles++;
            if (netProfit > 0) sessionStats.wins++;
            sessionStats.totalProfit += netProfit;
            updateStats();
            
            addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            addLog(`🏁 CYCLE COMPLETE | Net: ${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}`, netProfit >= 0 ? 'success' : 'error');
            addLog(`📈 Total Profit: $${sessionStats.totalProfit.toFixed(2)}`, 'success');
            addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            
            closeHigherBtn.disabled = true;
            closeLowerBtn.disabled = true;
            closeBothBtn.disabled = true;
            
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
    if (!pos) {
        addLog(`No active ${direction.toUpperCase()} contract`, 'error');
        return;
    }
    addLog(`Closing ${direction.toUpperCase()} contract...`);
    ws.send(JSON.stringify({ sell: pos.id, price: 0, req_id: Date.now() }));
}

function closeBoth() {
    addLog(`Closing BOTH contracts...`);
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
        addLog('Waiting for price feed...');
        setTimeout(startBot, 1000);
        return;
    }
    
    isBotRunning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    emergencyBtn.disabled = false;
    
    addLog(`🚀 HEDGE BOT STARTED on ${marketSelect.value}`, 'success');
    addLog(`💡 Settings: $${stakeInput.value} each | ${durationInput.value} ticks | offset ${offsetInput.value}`);
    
    placeBothTrades();
}

function stopBot() {
    isBotRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    addLog(`🛑 Bot stopped`, 'error');
}

function emergencyStop() {
    addLog(`⚠️ EMERGENCY STOP - Closing all positions`, 'error');
    isBotRunning = false;
    if (currentPositions.higher) closeContract('higher');
    if (currentPositions.lower) closeContract('lower');
    startBtn.disabled = false;
    stopBtn.disabled = true;
}

// Account switching
function switchAccount(type) {
    if (!ws) return;
    addLog(`Switching to ${type} account...`);
    ws.send(JSON.stringify({ switch_account: type === 'demo' ? 1 : 0, req_id: Date.now() }));
}

function enableControls(enabled) {
    marketSelect.disabled = !enabled;
    stakeInput.disabled = !enabled;
    durationInput.disabled = !enabled;
    offsetInput.disabled = !enabled;
    if (!enabled) {
        startBtn.disabled = true;
        stopBtn.disabled = true;
        emergencyBtn.disabled = true;
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

// Event listeners
connectBtn.onclick = () => {
    const token = document.getElementById('token').value.trim();
    if (!token) {
        addLog('Enter your API token', 'error');
        return;
    }
    localStorage.setItem('deriv_token', token);
    connect(token);
};

startBtn.onclick = startBot;
stopBtn.onclick = stopBot;
emergencyBtn.onclick = emergencyStop;
demoSwitch.onclick = () => switchAccount('demo');
realSwitch.onclick = () => switchAccount('real');
marketSelect.onchange = onMarketChange;
closeHigherBtn.onclick = () => closeContract('higher');
closeLowerBtn.onclick = () => closeContract('lower');
closeBothBtn.onclick = closeBoth;

// Load saved token
window.onload = () => {
    const saved = localStorage.getItem('deriv_token');
    if (saved) {
        document.getElementById('token').value = saved;
        connect(saved);
    }
    addLog('Hedge Bot v2.0 Ready - Connect your token');
};
