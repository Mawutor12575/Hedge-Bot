// ================================
// DERIV HEDGE BOT - PROFESSIONAL
// ================================

// ---------- CONFIG ----------
const APP_ID = 84911;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

const CONFIG = {
    defaultStake: 1,
    defaultDuration: 5,
    barrierOffset: 14.9962,
    minProfitAccept: 2.3
};

// ---------- STATE ----------
let ws = null;
let isConnected = false;
let isBotRunning = false;
let currentPrice = null;

let tradingLock = false;

let currentPositions = {
    higher: null,
    lower: null
};

let proposalMap = new Map();

let sessionStats = {
    totalTrades: 0,
    wins: 0,
    pnl: 0
};

// ---------- DOM ----------
const apiTokenInput = document.getElementById("api-token");
const connectBtn = document.getElementById("connect-token-btn");

const startBtn = document.getElementById("start-bot");
const stopBtn = document.getElementById("stop-bot");

const closeHigherBtn = document.getElementById("close-higher");
const closeLowerBtn = document.getElementById("close-lower");
const closeBothBtn = document.getElementById("close-both");

const stakeInput = document.getElementById("stake");
const durationInput = document.getElementById("duration");
const offsetInput = document.getElementById("offset");

const priceEl = document.getElementById("current-price");

const higherValueEl = document.getElementById("higher-value");
const lowerValueEl = document.getElementById("lower-value");

const higherPnlEl = document.getElementById("higher-pnl");
const lowerPnlEl = document.getElementById("lower-pnl");

const combinedValueEl = document.getElementById("combined-value");
const netProfitEl = document.getElementById("net-profit");


// ---------- INIT ----------
window.addEventListener("load", () => {

    stakeInput.value = CONFIG.defaultStake;
    durationInput.value = CONFIG.defaultDuration;
    offsetInput.value = CONFIG.barrierOffset;

});


// ---------- LOG ----------
function log(msg){
    console.log(`[BOT] ${msg}`);
}


// ---------- CONNECT ----------
function connect(){

    const token = apiTokenInput.value.trim();

    if(!token){
        alert("Enter API Token");
        return;
    }

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {

        log("WebSocket connected");

        ws.send(JSON.stringify({
            authorize: token
        }));

    };

    ws.onmessage = (msg)=>{
        const data = JSON.parse(msg.data);
        handleMessage(data);
    };

    ws.onerror = ()=>{
        log("WebSocket error");
    };

    ws.onclose = ()=>{
        isConnected = false;
        log("Disconnected");
    };

}


// ---------- HANDLE MESSAGE ----------
function handleMessage(data){

    if(data.error){
        log("Error: " + data.error.message);
        return;
    }

    if(data.authorize){

        isConnected = true;

        log("Authorized");

        subscribeTicks();

    }

    if(data.tick){
        handleTick(data.tick);
    }

    if(data.proposal){
        handleProposal(data);
    }

    if(data.buy){
        handleBuy(data.buy);
    }

    if(data.proposal_open_contract){
        updateContract(data.proposal_open_contract);
    }

    if(data.sell){
        log("Contract sold");
    }

}


// ---------- TICKS ----------
function subscribeTicks(){

    ws.send(JSON.stringify({
        ticks: "R_75",
        subscribe: 1
    }));

}

function handleTick(tick){

    currentPrice = tick.quote;

    priceEl.textContent = "$" + currentPrice.toFixed(2);

}


// ---------- START BOT ----------
async function startBot(){

    if(!isConnected){
        alert("Connect first");
        return;
    }

    if(!currentPrice){
        alert("Waiting price feed");
        return;
    }

    isBotRunning = true;

    startBtn.disabled = true;
    stopBtn.disabled = false;

    log("Bot started");

    placeHedge();

}


// ---------- STOP ----------
function stopBot(){

    isBotRunning = false;

    startBtn.disabled = false;
    stopBtn.disabled = true;

    tradingLock = false;

    log("Bot stopped");

}


// ---------- PLACE HEDGE ----------
function placeHedge(){

    if(!isBotRunning) return;

    if(tradingLock) return;

    tradingLock = true;

    const stake = parseFloat(stakeInput.value);
    const duration = parseInt(durationInput.value);
    const offset = parseFloat(offsetInput.value);

    const higherBarrier = "+" + offset.toFixed(4);
    const lowerBarrier = "-" + offset.toFixed(4);

    const higherReq = Date.now();

    proposalMap.set(higherReq,"higher");

    ws.send(JSON.stringify({

        proposal:1,
        amount:stake,
        basis:"stake",
        contract_type:"CALL",
        currency:"USD",
        duration:duration,
        duration_unit:"t",
        symbol:"R_75",
        barrier:higherBarrier,
        req_id:higherReq

    }));


    setTimeout(()=>{

        const lowerReq = Date.now();

        proposalMap.set(lowerReq,"lower");

        ws.send(JSON.stringify({

            proposal:1,
            amount:stake,
            basis:"stake",
            contract_type:"PUT",
            currency:"USD",
            duration:duration,
            duration_unit:"t",
            symbol:"R_75",
            barrier:lowerBarrier,
            req_id:lowerReq

        }));

    },400);

}


// ---------- HANDLE PROPOSAL ----------
function handleProposal(data){

    const proposal = data.proposal;

    const direction = proposalMap.get(data.req_id);

    if(!direction) return;

    const stake = parseFloat(stakeInput.value);

    const payout = proposal.payout;

    const profit = payout - stake;

    if(profit < CONFIG.minProfitAccept){

        log("Rejected low payout");

        tradingLock = false;

        setTimeout(placeHedge,1000);

        return;

    }

    ws.send(JSON.stringify({

        buy:proposal.id,
        price:proposal.ask_price

    }));

}


// ---------- HANDLE BUY ----------
function handleBuy(buy){

    const direction = buy.contract_type === "CALL" ? "higher" : "lower";

    currentPositions[direction] = {

        id: buy.contract_id,
        entry: buy.buy_price,
        value: buy.buy_price,
        profit:0

    };

    if(direction==="higher") closeHigherBtn.disabled=false;
    if(direction==="lower") closeLowerBtn.disabled=false;

    ws.send(JSON.stringify({

        proposal_open_contract:1,
        contract_id:buy.contract_id,
        subscribe:1

    }));

}


// ---------- CONTRACT UPDATE ----------
function updateContract(contract){

    const id = contract.contract_id;

    let direction = null;

    if(currentPositions.higher && currentPositions.higher.id === id)
        direction="higher";

    if(currentPositions.lower && currentPositions.lower.id === id)
        direction="lower";

    if(!direction) return;

    const bid = contract.bid_price || 0;
    const buy = contract.buy_price || 0;

    const profit = bid - buy;

    currentPositions[direction].value = bid;
    currentPositions[direction].profit = profit;

    updateUI();

    if(contract.is_sold){

        sessionStats.totalTrades++;
        sessionStats.pnl += contract.profit;

        if(contract.profit>0)
            sessionStats.wins++;

        if(direction==="higher"){
            currentPositions.higher=null;
            closeHigherBtn.disabled=true;
        }

        if(direction==="lower"){
            currentPositions.lower=null;
            closeLowerBtn.disabled=true;
        }

        if(!currentPositions.higher && !currentPositions.lower){

            tradingLock=false;

            if(isBotRunning)
                setTimeout(placeHedge,2000);

        }

    }

}


// ---------- UI UPDATE ----------
function updateUI(){

    const higherProfit = currentPositions.higher?.profit || 0;
    const lowerProfit = currentPositions.lower?.profit || 0;

    const higherValue = currentPositions.higher?.value || 0;
    const lowerValue = currentPositions.lower?.value || 0;

    higherValueEl.textContent = "$"+higherValue.toFixed(2);
    lowerValueEl.textContent = "$"+lowerValue.toFixed(2);

    higherPnlEl.textContent = higherProfit.toFixed(2);
    lowerPnlEl.textContent = lowerProfit.toFixed(2);

    const combined = higherValue + lowerValue;

    const net = higherProfit + lowerProfit;

    combinedValueEl.textContent="$"+combined.toFixed(2);

    netProfitEl.textContent=(net>=0?"+":"")+"$"+net.toFixed(2);

}


// ---------- CLOSE CONTRACT ----------
function closeContract(direction){

    const pos = currentPositions[direction];

    if(!pos) return;

    ws.send(JSON.stringify({

        sell:pos.id,
        price:0

    }));

}


// ---------- CLOSE BOTH ----------
function closeBoth(){

    closeContract("higher");
    closeContract("lower");

}


// ---------- EVENTS ----------
connectBtn.addEventListener("click",connect);

startBtn.addEventListener("click",startBot);

stopBtn.addEventListener("click",stopBot);

closeHigherBtn.addEventListener("click",()=>closeContract("higher"));

closeLowerBtn.addEventListener("click",()=>closeContract("lower"));

closeBothBtn.addEventListener("click",closeBoth);
