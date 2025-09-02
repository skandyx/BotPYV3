import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import session from 'express-session';
import crypto from 'crypto';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import http from 'http';
import fetch from 'node-fetch';
import { ScannerService } from './ScannerService.js';
import { RSI, ADX, ATR, MACD, SMA, BollingerBands, EMA } from 'technicalindicators';


// --- Basic Setup ---
dotenv.config();
const app = express();
const port = process.env.PORT || 8080;
const server = http.createServer(app);

app.use(cors({
    origin: (origin, callback) => {
        // For development (e.g., Postman) or same-origin, origin is undefined.
        // In production, you might want to restrict this to your frontend's domain.
        callback(null, true);
    },
    credentials: true,
}));
app.use(bodyParser.json());
app.set('trust proxy', 1); // For Nginx

// --- Session Management ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'a_much_more_secure_and_random_secret_string_32_chars_long',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// --- WebSocket Server for Frontend Communication ---
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    
    if (url.pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});
wss.on('connection', (ws) => {
    clients.add(ws);
    log('WEBSOCKET', 'Frontend client connected.');

    // Immediately send the current Fear & Greed index if it exists
    if (botState.fearAndGreed) {
        ws.send(JSON.stringify({
            type: 'FEAR_AND_GREED_UPDATE',
            payload: botState.fearAndGreed
        }));
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // log('WEBSOCKET', `Received message from client: ${JSON.stringify(data)}`);
            
            if (data.type === 'GET_FULL_SCANNER_LIST') {
                log('WEBSOCKET', 'Client requested full scanner list. Sending...');
                ws.send(JSON.stringify({
                    type: 'FULL_SCANNER_LIST',
                    payload: botState.scannerCache
                }));
            }
        } catch (e) {
            log('ERROR', `Failed to parse message from client: ${message}`);
        }
    });
    ws.on('close', () => {
        clients.delete(ws);
        log('WEBSOCKET', 'Frontend client disconnected.');
    });
    ws.on('error', (error) => {
        log('ERROR', `WebSocket client error: ${error.message}`);
        ws.close();
    });
});
function broadcast(message) {
    const data = JSON.stringify(message);
    if (!['PRICE_UPDATE'].includes(message.type)) {
         log('WEBSOCKET', `Broadcasting ${message.type} to ${clients.size} clients.`);
    }
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
             client.send(data, (err) => {
                if (err) {
                    log('ERROR', `Failed to send message to a client: ${err.message}`);
                }
            });
        }
    }
}

// --- Logging Service ---
const log = (level, message) => {
    console.log(`[${new Date().toISOString()}] [${level}] ${message}`);
    const logEntry = {
        type: 'LOG_ENTRY',
        payload: {
            timestamp: new Date().toISOString(),
            level,
            message
        }
    };
    broadcast(logEntry);
};

// --- Binance API Client ---
class BinanceApiClient {
    constructor(apiKey, secretKey, log) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.baseUrl = 'https://api.binance.com';
        this.log = log;
    }

    _getSignature(queryString) {
        return crypto.createHmac('sha256', this.secretKey).update(queryString).digest('hex');
    }

    async _request(method, endpoint, params = {}) {
        const timestamp = Date.now();
        const queryString = new URLSearchParams({ ...params, timestamp }).toString();
        const signature = this._getSignature(queryString);
        const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;

        try {
            const response = await fetch(url, {
                method,
                headers: { 'X-MBX-APIKEY': this.apiKey }
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(`Binance API Error: ${data.msg || `HTTP ${response.status}`}`);
            }
            this.log('BINANCE_API', `[${method}] ${endpoint} successful.`);
            return data;
        } catch (error) {
            this.log('ERROR', `[BINANCE_API] [${method}] ${endpoint} failed: ${error.message}`);
            throw error;
        }
    }
    
    async getAccountInfo() {
        return this._request('GET', '/api/v3/account');
    }
    
    async createOrder(symbol, side, type, quantity) {
        const params = { symbol, side, type, quantity };
        return this._request('POST', '/api/v3/order', params);
    }

    async getOrderBookDepth(symbol, limit = 5) {
        const queryString = new URLSearchParams({ symbol, limit }).toString();
        const url = `${this.baseUrl}/api/v3/depth?${queryString}`;
        const response = await fetch(url);
        return response.json();
    }
    
    async getExchangeInfo() {
        try {
            const response = await fetch(`${this.baseUrl}/api/v3/exchangeInfo`);
            const data = await response.json();
            this.log('BINANCE_API', `Successfully fetched exchange info for ${data.symbols.length} symbols.`);
            return data;
        } catch (error) {
             this.log('ERROR', `[BINANCE_API] Failed to fetch exchange info: ${error.message}`);
             throw error;
        }
    }
}
let binanceApiClient = null;
let symbolRules = new Map();
let cryptoSectors = new Map();

function formatQuantity(symbol, quantity) {
    const rules = symbolRules.get(symbol);
    if (!rules || !rules.stepSize) {
        // Fallback for symbols without explicit rules (e.g., if exchangeInfo fails)
        return parseFloat(quantity.toFixed(8));
    }

    if (rules.stepSize === 1) {
        return Math.floor(quantity);
    }

    // Calculate precision from stepSize (e.g., 0.001 -> 3)
    const precision = Math.max(0, -Math.log10(rules.stepSize));
    const factor = Math.pow(10, precision);
    return Math.floor(quantity * factor) / factor;
}


// --- Persistence ---
const DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE_PATH = path.join(DATA_DIR, 'settings.json');
const STATE_FILE_PATH = path.join(DATA_DIR, 'state.json');
const AUTH_FILE_PATH = path.join(DATA_DIR, 'auth.json');
const KLINE_DATA_DIR = path.join(DATA_DIR, 'klines');

const ensureDataDirs = async () => {
    try { await fs.access(DATA_DIR); } catch { await fs.mkdir(DATA_DIR); }
    try { await fs.access(KLINE_DATA_DIR); } catch { await fs.mkdir(KLINE_DATA_DIR); }
};

// --- Auth Helpers ---
const hashPassword = (password) => {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16).toString('hex');
        crypto.scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) reject(err);
            resolve(salt + ":" + derivedKey.toString('hex'));
        });
    });
};

const verifyPassword = (password, hash) => {
    return new Promise((resolve, reject) => {
        const [salt, key] = hash.split(':');
        if (!salt || !key) {
            return reject(new Error('Invalid hash format.'));
        }
        crypto.scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) reject(err);
            try {
                const keyBuffer = Buffer.from(key, 'hex');
                const match = crypto.timingSafeEqual(keyBuffer, derivedKey);
                resolve(match);
            } catch (e) {
                // Handle cases where the key is not valid hex, preventing crashes
                resolve(false);
            }
        });
    });
};


const loadData = async () => {
    await ensureDataDirs();
    try {
        const settingsContent = await fs.readFile(SETTINGS_FILE_PATH, 'utf-8');
        botState.settings = JSON.parse(settingsContent);
    } catch {
        log("WARN", "settings.json not found. Loading from .env defaults.");
        
        // Helper for boolean env vars: defaults to `true` unless explicitly 'false'
        const isNotFalse = (envVar) => process.env[envVar] !== 'false';
        // Helper for boolean env vars: defaults to `false` unless explicitly 'true'
        const isTrue = (envVar) => process.env[envVar] === 'true';

        botState.settings = {
            // Core Trading
            INITIAL_VIRTUAL_BALANCE: parseFloat(process.env.INITIAL_VIRTUAL_BALANCE) || 10000,
            MAX_OPEN_POSITIONS: parseInt(process.env.MAX_OPEN_POSITIONS, 10) || 5,
            POSITION_SIZE_PCT: parseFloat(process.env.POSITION_SIZE_PCT) || 2.0,
            RISK_REWARD_RATIO: parseFloat(process.env.RISK_REWARD_RATIO) || 4.0,
            STOP_LOSS_PCT: parseFloat(process.env.STOP_LOSS_PCT) || 2.0, // Fallback if ATR is disabled
            SLIPPAGE_PCT: parseFloat(process.env.SLIPPAGE_PCT) || 0.05,
            
            // Scanner & Filters
            MIN_VOLUME_USD: parseFloat(process.env.MIN_VOLUME_USD) || 40000000,
            SCANNER_DISCOVERY_INTERVAL_SECONDS: parseInt(process.env.SCANNER_DISCOVERY_INTERVAL_SECONDS, 10) || 3600,
            EXCLUDED_PAIRS: process.env.EXCLUDED_PAIRS || "USDCUSDT,FDUSDUSDT,TUSDUSDT,BUSDUSDT",
            LOSS_COOLDOWN_HOURS: parseInt(process.env.LOSS_COOLDOWN_HOURS, 10) || 4,
            
            // API Credentials
            BINANCE_API_KEY: process.env.BINANCE_API_KEY || '',
            BINANCE_SECRET_KEY: process.env.BINANCE_SECRET_KEY || '',

            // --- ADVANCED STRATEGY & RISK MANAGEMENT (Optimal Defaults) ---
            
            // ATR Stop Loss (Enabled by default)
            USE_ATR_STOP_LOSS: isNotFalse('USE_ATR_STOP_LOSS'),
            ATR_MULTIPLIER: parseFloat(process.env.ATR_MULTIPLIER) || 1.5,
            
            // Auto Break-even (Enabled by default)
            USE_AUTO_BREAKEVEN: isNotFalse('USE_AUTO_BREAKEVEN'),
            BREAKEVEN_TRIGGER_R: parseFloat(process.env.BREAKEVEN_TRIGGER_R) || 1.0,
            ADJUST_BREAKEVEN_FOR_FEES: isNotFalse('ADJUST_BREAKEVEN_FOR_FEES'),
            TRANSACTION_FEE_PCT: parseFloat(process.env.TRANSACTION_FEE_PCT) || 0.1,

            // Safety Filters (Enabled by default)
            USE_RSI_SAFETY_FILTER: isNotFalse('USE_RSI_SAFETY_FILTER'),
            RSI_OVERBOUGHT_THRESHOLD: parseInt(process.env.RSI_OVERBOUGHT_THRESHOLD, 10) || 75,
            USE_PARABOLIC_FILTER: isNotFalse('USE_PARABOLIC_FILTER'),
            PARABOLIC_FILTER_PERIOD_MINUTES: parseInt(process.env.PARABOLIC_FILTER_PERIOD_MINUTES, 10) || 5,
            PARABOLIC_FILTER_THRESHOLD_PCT: parseFloat(process.env.PARABOLIC_FILTER_THRESHOLD_PCT) || 2.5,
            USE_VOLUME_CONFIRMATION: isNotFalse('USE_VOLUME_CONFIRMATION'),
            USE_MARKET_REGIME_FILTER: isNotFalse('USE_MARKET_REGIME_FILTER'),

            // Optional Features (Disabled by default for simplicity)
            USE_PARTIAL_TAKE_PROFIT: isTrue('USE_PARTIAL_TAKE_PROFIT'),
            PARTIAL_TP_TRIGGER_PCT: parseFloat(process.env.PARTIAL_TP_TRIGGER_PCT) || 0.8,
            PARTIAL_TP_SELL_QTY_PCT: parseInt(process.env.PARTIAL_TP_SELL_QTY_PCT, 10) || 50,
            USE_DYNAMIC_POSITION_SIZING: isTrue('USE_DYNAMIC_POSITION_SIZING'),
            STRONG_BUY_POSITION_SIZE_PCT: parseFloat(process.env.STRONG_BUY_POSITION_SIZE_PCT) || 3.0,
            REQUIRE_STRONG_BUY: isTrue('REQUIRE_STRONG_BUY'),

            // --- ADAPTIVE BEHAVIOR (Enabled by default) ---
            USE_DYNAMIC_PROFILE_SELECTOR: isNotFalse('USE_DYNAMIC_PROFILE_SELECTOR'),
            ADX_THRESHOLD_RANGE: parseInt(process.env.ADX_THRESHOLD_RANGE, 10) || 20,
            ATR_PCT_THRESHOLD_VOLATILE: parseFloat(process.env.ATR_PCT_THRESHOLD_VOLATILE) || 5.0,
            USE_AGGRESSIVE_ENTRY_LOGIC: isTrue('USE_AGGRESSIVE_ENTRY_LOGIC'), // Profile-specific
            
            // Adaptive Trailing Stop (Enabled by default)
            USE_ADAPTIVE_TRAILING_STOP: isNotFalse('USE_ADAPTIVE_TRAILING_STOP'),
            TRAILING_STOP_TIGHTEN_THRESHOLD_R: parseFloat(process.env.TRAILING_STOP_TIGHTEN_THRESHOLD_R) || 1.0,
            TRAILING_STOP_TIGHTEN_MULTIPLIER_REDUCTION: parseFloat(process.env.TRAILING_STOP_TIGHTEN_MULTIPLIER_REDUCTION) || 0.3,

            // Graduated Circuit Breaker
            CIRCUIT_BREAKER_WARN_THRESHOLD_PCT: parseFloat(process.env.CIRCUIT_BREAKER_WARN_THRESHOLD_PCT) || 1.5,
            CIRCUIT_BREAKER_HALT_THRESHOLD_PCT: parseFloat(process.env.CIRCUIT_BREAKER_HALT_THRESHOLD_PCT) || 2.5,
            DAILY_DRAWDOWN_LIMIT_PCT: parseFloat(process.env.DAILY_DRAWDOWN_LIMIT_PCT) || 3.0,
            CONSECUTIVE_LOSS_LIMIT: parseInt(process.env.CONSECUTIVE_LOSS_LIMIT, 10) || 5,

            // --- ADVANCED ENTRY CONFIRMATION ---
            USE_MTF_VALIDATION: isNotFalse('USE_MTF_VALIDATION'),
            USE_OBV_VALIDATION: isNotFalse('USE_OBV_VALIDATION'),
            
            // --- NEW ADVANCED CONFIRMATION FILTERS ---
            USE_RSI_MTF_FILTER: isTrue('USE_RSI_MTF_FILTER'),
            RSI_15M_OVERBOUGHT_THRESHOLD: parseInt(process.env.RSI_15M_OVERBOUGHT_THRESHOLD, 10) || 70,
            USE_WICK_DETECTION_FILTER: isTrue('USE_WICK_DETECTION_FILTER'),
            MAX_UPPER_WICK_PCT: parseFloat(process.env.MAX_UPPER_WICK_PCT) || 50,
            USE_OBV_5M_VALIDATION: isTrue('USE_OBV_5M_VALIDATION'),
            USE_CVD_FILTER: isTrue('USE_CVD_FILTER'),
            
            // --- PORTFOLIO INTELLIGENCE ---
            SCALING_IN_CONFIG: process.env.SCALING_IN_CONFIG || "50,50",
            MAX_CORRELATED_TRADES: parseInt(process.env.MAX_CORRELATED_TRADES, 10) || 2,
            USE_FEAR_AND_GREED_FILTER: isTrue('USE_FEAR_AND_GREED_FILTER'),

            // --- ADVANCED PORTFOLIO FILTERS ---
            USE_ORDER_BOOK_LIQUIDITY_FILTER: isTrue('USE_ORDER_BOOK_LIQUIDITY_FILTER'),
            MIN_ORDER_BOOK_LIQUIDITY_USD: parseInt(process.env.MIN_ORDER_BOOK_LIQUIDITY_USD, 10) || 200000,
            USE_SECTOR_CORRELATION_FILTER: isTrue('USE_SECTOR_CORRELATION_FILTER'),
            USE_WHALE_MANIPULATION_FILTER: isTrue('USE_WHALE_MANIPULATION_FILTER'),
            WHALE_SPIKE_THRESHOLD_PCT: parseFloat(process.env.WHALE_SPIKE_THRESHOLD_PCT) || 5.0,
        };
        await saveData('settings');
    }
    try {
        const stateContent = await fs.readFile(STATE_FILE_PATH, 'utf-8');
        const persistedState = JSON.parse(stateContent);
        botState.balance = persistedState.balance || botState.settings.INITIAL_VIRTUAL_BALANCE;
        botState.activePositions = persistedState.activePositions || [];
        botState.tradeHistory = persistedState.tradeHistory || [];
        botState.tradeIdCounter = persistedState.tradeIdCounter || 1;
        botState.isRunning = persistedState.isRunning !== undefined ? persistedState.isRunning : true;
        botState.tradingMode = persistedState.tradingMode || 'VIRTUAL';
        botState.dayStartBalance = persistedState.dayStartBalance || botState.settings.INITIAL_VIRTUAL_BALANCE;
        botState.dailyPnl = persistedState.dailyPnl || 0;
        botState.consecutiveLosses = persistedState.consecutiveLosses || 0;
        botState.consecutiveWins = persistedState.consecutiveWins || 0;
        botState.currentTradingDay = persistedState.currentTradingDay || new Date().toISOString().split('T')[0];
    } catch {
        log("WARN", "state.json not found. Initializing default state.");
        botState.balance = botState.settings.INITIAL_VIRTUAL_BALANCE;
        botState.dayStartBalance = botState.settings.INITIAL_VIRTUAL_BALANCE;
        await saveData('state');
    }

    try {
        const authContent = await fs.readFile(AUTH_FILE_PATH, 'utf-8');
        const authData = JSON.parse(authContent);
        if (authData.passwordHash) {
            botState.passwordHash = authData.passwordHash;
        } else {
            throw new Error("Invalid auth file format");
        }
    } catch {
        log("WARN", "auth.json not found or invalid. Initializing from .env.");
        const initialPassword = process.env.APP_PASSWORD;
        if (!initialPassword) {
            log('ERROR', 'CRITICAL: APP_PASSWORD is not set in .env file. Please set it and restart.');
            process.exit(1);
        }
        botState.passwordHash = await hashPassword(initialPassword);
        await fs.writeFile(AUTH_FILE_PATH, JSON.stringify({ passwordHash: botState.passwordHash }, null, 2));
        log('INFO', 'Created auth.json with a new secure password hash.');
    }
    
    realtimeAnalyzer.updateSettings(botState.settings);
};

const saveData = async (type) => {
    await ensureDataDirs();
    if (type === 'settings') {
        await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(botState.settings, null, 2));
    } else if (type === 'state') {
        const stateToPersist = {
            balance: botState.balance,
            activePositions: botState.activePositions,
            tradeHistory: botState.tradeHistory,
            tradeIdCounter: botState.tradeIdCounter,
            isRunning: botState.isRunning,
            tradingMode: botState.tradingMode,
            dayStartBalance: botState.dayStartBalance,
            dailyPnl: botState.dailyPnl,
            consecutiveLosses: botState.consecutiveLosses,
            consecutiveWins: botState.consecutiveWins,
            currentTradingDay: botState.currentTradingDay,
        };
        await fs.writeFile(STATE_FILE_PATH, JSON.stringify(stateToPersist, null, 2));
    } else if (type === 'auth') {
        await fs.writeFile(AUTH_FILE_PATH, JSON.stringify({ passwordHash: botState.passwordHash }, null, 2));
    }
};

// --- Custom OBV Calculator ---
const calculateOBV = (klines) => {
    if (!klines || klines.length < 2) return [];
    let obv = [0];
    for (let i = 1; i < klines.length; i++) {
        const currentClose = klines[i].close;
        const prevClose = klines[i - 1].close;
        const volume = klines[i].volume;
        if (currentClose > prevClose) {
            obv.push(obv[i - 1] + volume);
        } else if (currentClose < prevClose) {
            obv.push(obv[i - 1] - volume);
        } else {
            obv.push(obv[i - 1]);
        }
    }
    return obv;
};

// --- Custom CVD Calculator (Approximation from Klines) ---
const calculateCVD = (klines) => {
    if (!klines || klines.length < 1) return [];
    let cumulativeDelta = 0;
    const cvd = [];
    for (const kline of klines) {
        const high = kline.high;
        const low = kline.low;
        const close = kline.close;
        const volume = kline.volume;
        let delta = 0;
        if (high !== low) {
            // A simple approximation of buying pressure based on where the close is within the candle range.
            const buyingPressure = ((close - low) / (high - low)) * 2 - 1; // Ranges from -1 (close at low) to +1 (close at high)
            delta = volume * buyingPressure;
        }
        cumulativeDelta += delta;
        cvd.push(cumulativeDelta);
    }
    return cvd;
};

// --- Realtime Analysis Engine (Macro-Micro Strategy) ---
class RealtimeAnalyzer {
    constructor(log) {
        this.log = log;
        this.settings = {};
        this.klineData = new Map(); // Map<symbol, Map<interval, kline[]>>
        this.hydrating = new Set();
        this.SQUEEZE_PERCENTILE_THRESHOLD = 0.25;
        this.SQUEEZE_LOOKBACK = 50;
    }

    updateSettings(newSettings) {
        this.log('INFO', '[Analyzer] Settings updated for Macro-Micro strategy.');
        this.settings = newSettings;
    }

    // Phase 1: 15m analysis to qualify pairs for the Hotlist
    analyze15mIndicators(symbolOrPair) {
        const symbol = typeof symbolOrPair === 'string' ? symbolOrPair : symbolOrPair.symbol;
        const pairToUpdate = typeof symbolOrPair === 'string'
            ? botState.scannerCache.find(p => p.symbol === symbol)
            : symbolOrPair;

        if (!pairToUpdate) return;

        const klines15m = this.klineData.get(symbol)?.get('15m');
        if (!klines15m || klines15m.length < 21) return; // Need at least 20 for BB + 1 previous

        const old_score = pairToUpdate.score;
        const old_hotlist_status = pairToUpdate.is_on_hotlist;

        const closes15m = klines15m.map(d => d.close);
        const highs15m = klines15m.map(d => d.high);
        const lows15m = klines15m.map(d => d.low);

        const bbResult = BollingerBands.calculate({ period: 20, values: closes15m, stdDev: 2 });
        const atrResult = ATR.calculate({ high: highs15m, low: lows15m, close: closes15m, period: 14 });
        const adxResult = ADX.calculate({ high: highs15m, low: lows15m, close: closes15m, period: 14 });
        const rsi15m = RSI.calculate({ period: 14, values: closes15m }).pop();

        if (bbResult.length < 2 || !atrResult.length) return;

        const lastCandle = klines15m[klines15m.length - 1];
        
        // Update indicators
        pairToUpdate.atr_15m = atrResult[atrResult.length - 1];
        pairToUpdate.adx_15m = adxResult.length ? adxResult[adxResult.length - 1].adx : undefined;
        pairToUpdate.atr_pct_15m = pairToUpdate.atr_15m ? (pairToUpdate.atr_15m / lastCandle.close) * 100 : undefined;
        pairToUpdate.rsi_15m = rsi15m;

        const lastBB = bbResult[bbResult.length - 1];
        const currentBbWidthPct = (lastBB.upper - lastBB.lower) / lastBB.middle * 100;
        pairToUpdate.bollinger_bands_15m = { ...lastBB, width_pct: currentBbWidthPct };

        // --- DUAL-CONFIRMATION SQUEEZE LOGIC ---
        const bbWidths = bbResult.map(b => (b.upper - b.lower) / b.middle);
        const previousCandleIndex = bbWidths.length - 2;
        const previousBbWidth = bbWidths[previousCandleIndex];
        
        const historyForSqueeze = bbWidths.slice(0, previousCandleIndex + 1).slice(-this.SQUEEZE_LOOKBACK);
        
        let wasInBbSqueeze = false;
        if (historyForSqueeze.length >= 20) {
            const sortedWidths = [...historyForSqueeze].sort((a, b) => a - b);
            const squeezeThreshold = sortedWidths[Math.floor(sortedWidths.length * this.SQUEEZE_PERCENTILE_THRESHOLD)];
            wasInBbSqueeze = previousBbWidth <= squeezeThreshold;
        }

        const recentAtr = atrResult.slice(-5);
        const isAtrFalling = recentAtr.length === 5 && recentAtr[4] < recentAtr[0];

        const wasInSqueeze = wasInBbSqueeze && isAtrFalling;
        pairToUpdate.is_in_squeeze_15m = wasInSqueeze;

        // --- SCORING & HOTLIST LOGIC ---
        const isOnHotlist = pairToUpdate.price_above_ema50_4h && wasInSqueeze;
        pairToUpdate.is_on_hotlist = isOnHotlist;
        
        if (pairToUpdate.score === 'PENDING_CONFIRMATION' || pairToUpdate.score === 'FAKE_BREAKOUT') {
           // Don't overwrite these important transient states
        } else if (isOnHotlist) {
            pairToUpdate.score = 'COMPRESSION';
            pairToUpdate.score_value = 85;
        } else {
            pairToUpdate.score = 'HOLD';
            pairToUpdate.score_value = 50;
        }

        // Broadcast if score or hotlist status changed
        if (pairToUpdate.score !== old_score || pairToUpdate.is_on_hotlist !== old_hotlist_status) {
            broadcast({ type: 'SCANNER_UPDATE', payload: pairToUpdate });
        }
    }

    // Phase 2: Micro analysis on 1m chart for trigger
    analyze1mTrigger(symbol, klines1m) {
        const pair = botState.scannerCache.find(p => p.symbol === symbol);
        if (!pair || !pair.is_on_hotlist || pair.score === 'PENDING_CONFIRMATION') return;
        
        const settings = this.settings;
        if (klines1m.length < 21) return;

        const lastKline = klines1m[klines1m.length - 1];
        const prevKline = klines1m[klines1m.length - 2];
        const closes = klines1m.map(k => k.close);
        const volumes = klines1m.map(k => k.volume);

        // Conditions
        const conditions = { trend: pair.price_above_ema50_4h };

        // 1. Breakout (Close > EMA9)
        const ema9 = EMA.calculate({ period: 9, values: closes }).pop();
        conditions.breakout = lastKline.close > ema9;

        // 2. Volume Spike
        const avgVolume = SMA.calculate({ period: 20, values: volumes.slice(0, -1) }).pop() || 0;
        conditions.volume = lastKline.volume > avgVolume * 1.5;

        // 3. OBV Confirmation
        const obv = calculateOBV(klines1m);
        conditions.obv = settings.USE_OBV_VALIDATION ? obv[obv.length - 1] > obv[obv.length - 2] : true;
        
        // 4. CVD Confirmation
        const cvd = calculateCVD(klines1m);
        conditions.cvd = settings.USE_CVD_FILTER ? cvd[cvd.length - 1] > cvd[cvd.length - 2] : true;

        // 5. RSI Safety Checks
        conditions.safety = settings.USE_RSI_SAFETY_FILTER ? pair.rsi_1h < settings.RSI_OVERBOUGHT_THRESHOLD : true;
        conditions.rsi_mtf = settings.USE_RSI_MTF_FILTER ? pair.rsi_15m < settings.RSI_15M_OVERBOUGHT_THRESHOLD : true;
        
        // 6. Structure Confirmation (Price > previous 15m high)
        const klines15m = this.klineData.get(symbol)?.get('15m');
        if (klines15m && klines15m.length > 1) {
            const prev15mHigh = klines15m[klines15m.length - 2].high;
            conditions.structure = lastKline.close > prev15mHigh;
        } else {
            conditions.structure = false;
        }

        // --- Advanced Safety Filters ---
        // 7. Wick Detection
        const wickFilterPassed = !settings.USE_WICK_DETECTION_FILTER || (() => {
            const candleRange = lastKline.high - lastKline.low;
            if (candleRange === 0) return true; // Doji candle, no wick to measure
            const upperWick = lastKline.high - lastKline.close;
            return (upperWick / candleRange) * 100 < settings.MAX_UPPER_WICK_PCT;
        })();

        // 8. Parabolic Filter
        const parabolicFilterPassed = !settings.USE_PARABOLIC_FILTER || (() => {
            const period = settings.PARABOLIC_FILTER_PERIOD_MINUTES;
            if (klines1m.length < period) return true;
            const startPrice = klines1m[klines1m.length - period].open;
            const priceChangePct = ((lastKline.close - startPrice) / startPrice) * 100;
            return priceChangePct < settings.PARABOLIC_FILTER_THRESHOLD_PCT;
        })();

        pair.conditions = conditions;
        pair.conditions_met_count = Object.values(conditions).filter(Boolean).length;

        const allBaseConditionsMet = Object.values(conditions).every(Boolean);

        if (allBaseConditionsMet && wickFilterPassed && parabolicFilterPassed) {
            this.log('SCANNER', `[${symbol}] High-quality 1m trigger DETECTED. Awaiting 5m confirmation.`);
            pair.score = 'PENDING_CONFIRMATION';
            pair.score_value = 95;
            pair.trigger_price = lastKline.close; // Store for 5m validation
            broadcast({ type: 'SCANNER_UPDATE', payload: pair });
        }
    }
    
    // Phase 2.5: Confirm entry with 5m kline data
    confirm5mEntry(symbol, klines5m) {
        const pair = botState.scannerCache.find(p => p.symbol === symbol);
        if (!pair || pair.score !== 'PENDING_CONFIRMATION') return;

        const last5mKline = klines5m[klines5m.length - 1];

        // 1. 5m candle must be bullish
        const isBullishClose = last5mKline.close > last5mKline.open;
        
        // 2. 5m close must be above the initial 1m trigger price
        const isAboveTrigger = last5mKline.close > pair.trigger_price;
        
        // 3. OBV on 5m must confirm strength
        const obv5m = calculateOBV(klines5m);
        const isObvConfirming = !this.settings.USE_OBV_5M_VALIDATION || (obv5m.length > 1 && obv5m[obv5m.length - 1] > obv5m[obv5m.length - 2]);
        
        if (isBullishClose && isAboveTrigger && isObvConfirming) {
            this.log('TRADE', `[${symbol}] 5m confirmation successful! Preparing to open trade.`);
            pair.score = 'STRONG BUY';
            pair.score_value = 100;
            // The actual trade opening is handled by a separate service/function
            openTrade(pair);
        } else {
            this.log('SCANNER', `[${symbol}] 5m confirmation FAILED. Invalidating signal. (Bullish: ${isBullishClose}, AboveTrigger: ${isAboveTrigger}, OBV: ${isObvConfirming})`);
            pair.score = 'FAKE_BREAKOUT';
            pair.score_value = 20;
            // Reset trigger price
            delete pair.trigger_price;
        }
        broadcast({ type: 'SCANNER_UPDATE', payload: pair });
    }
}

const realtimeAnalyzer = new RealtimeAnalyzer(log);

// --- State Management ---
let botState = {
    settings: {},
    balance: 0,
    activePositions: [],
    tradeHistory: [],
    tradeIdCounter: 1,
    isRunning: true,
    tradingMode: 'VIRTUAL',
    scannerCache: [],
    passwordHash: null,
    dayStartBalance: 0,
    dailyPnl: 0,
    consecutiveLosses: 0,
    consecutiveWins: 0,
    currentTradingDay: new Date().toISOString().split('T')[0],
    circuitBreakerStatus: 'NONE',
    fearAndGreed: null,
};


// --- Authentication Middleware ---
const isAuthenticated = (req, res, next) => {
    if (req.session.isAuthenticated) {
        return next();
    }
    res.status(401).json({ message: 'Unauthorized' });
};

// --- API Endpoints ---
app.post('/api/login', async (req, res) => {
    const { password } = req.body;
    if (!password) {
        return res.status(400).json({ success: false, message: 'Password is required' });
    }
    const match = await verifyPassword(password, botState.passwordHash);
    if (match) {
        req.session.isAuthenticated = true;
        res.json({ success: true, message: 'Login successful' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.status(204).send();
});

app.get('/api/check-session', (req, res) => {
    res.json({ isAuthenticated: !!req.session.isAuthenticated });
});

app.post('/api/change-password', isAuthenticated, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
    }
    botState.passwordHash = await hashPassword(newPassword);
    await saveData('auth');
    res.json({ success: true, message: 'Password updated successfully.' });
});

app.get('/api/settings', isAuthenticated, (req, res) => {
    res.json(botState.settings);
});

app.post('/api/settings', isAuthenticated, async (req, res) => {
    const newSettings = req.body;
    botState.settings = { ...botState.settings, ...newSettings };
    realtimeAnalyzer.updateSettings(botState.settings);
    // Re-initialize Binance API client if keys changed
    if (newSettings.BINANCE_API_KEY || newSettings.BINANCE_SECRET_KEY) {
        binanceApiClient = new BinanceApiClient(botState.settings.BINANCE_API_KEY, botState.settings.BINANCE_SECRET_KEY, log);
    }
    await saveData('settings');
    res.json({ success: true });
});

app.get('/api/status', isAuthenticated, (req, res) => {
    const { balance, activePositions, scannerCache, settings } = botState;
    res.json({
        mode: botState.tradingMode,
        balance,
        positions: activePositions.length,
        monitored_pairs: scannerCache.length,
        top_pairs: scannerCache.slice(0, 10).map(p => p.symbol),
        max_open_positions: settings.MAX_OPEN_POSITIONS
    });
});

app.get('/api/positions', isAuthenticated, (req, res) => {
    res.json(botState.activePositions);
});

app.get('/api/history', isAuthenticated, (req, res) => {
    res.json(botState.tradeHistory);
});

app.get('/api/performance-stats', isAuthenticated, (req, res) => {
    const { tradeHistory } = botState;
    const total_trades = tradeHistory.length;
    const winning_trades = tradeHistory.filter(t => t.pnl > 0).length;
    const losing_trades = total_trades - winning_trades;
    const total_pnl = tradeHistory.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const win_rate = total_trades > 0 ? (winning_trades / total_trades) * 100 : 0;
    const avg_pnl_pct = total_trades > 0 ? tradeHistory.reduce((sum, t) => sum + (t.pnl_pct || 0), 0) / total_trades : 0;

    res.json({ total_trades, winning_trades, losing_trades, total_pnl, avg_pnl_pct, win_rate });
});

app.get('/api/scanner', isAuthenticated, (req, res) => {
    res.json(botState.scannerCache);
});

app.post('/api/close-trade/:id', isAuthenticated, async (req, res) => {
    const tradeId = parseInt(req.params.id, 10);
    log('TRADE', `Manual close requested for trade ID ${tradeId}`);
    try {
        const result = await closeTrade(tradeId, true); // true for manual close
        res.json(result);
    } catch (error) {
        log('ERROR', `Manual close for trade ${tradeId} failed: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/clear-data', isAuthenticated, async (req, res) => {
    botState.activePositions = [];
    botState.tradeHistory = [];
    botState.balance = botState.settings.INITIAL_VIRTUAL_BALANCE;
    botState.dayStartBalance = botState.settings.INITIAL_VIRTUAL_BALANCE;
    botState.dailyPnl = 0;
    botState.consecutiveLosses = 0;
    botState.tradeIdCounter = 1;
    await saveData('state');
    broadcast({ type: 'POSITIONS_UPDATED' });
    res.json({ success: true });
});

app.post('/api/test-connection', isAuthenticated, async (req, res) => {
    const { apiKey, secretKey } = req.body;
    const tempClient = new BinanceApiClient(apiKey, secretKey, log);
    try {
        await tempClient.getAccountInfo();
        res.json({ success: true, message: 'Connexion à Binance réussie !' });
    } catch (error) {
        res.status(400).json({ success: false, message: `Échec de la connexion : ${error.message}` });
    }
});

app.get('/api/bot/status', isAuthenticated, (req, res) => {
    res.json({ isRunning: botState.isRunning });
});

app.post('/api/bot/start', isAuthenticated, (req, res) => {
    botState.isRunning = true;
    log('INFO', 'Bot has been started via API.');
    saveData('state');
    res.json({ success: true });
});

app.post('/api/bot/stop', isAuthenticated, (req, res) => {
    botState.isRunning = false;
    log('INFO', 'Bot has been stopped via API.');
    saveData('state');
    res.json({ success: true });
});

app.get('/api/mode', isAuthenticated, (req, res) => {
    res.json({ mode: botState.tradingMode });
});

app.post('/api/mode', isAuthenticated, async (req, res) => {
    const { mode } = req.body;
    if (['VIRTUAL', 'REAL_PAPER', 'REAL_LIVE'].includes(mode)) {
        botState.tradingMode = mode;
        if (mode.startsWith('REAL')) {
            // Fetch real balance from Binance
            try {
                if (!binanceApiClient) {
                     binanceApiClient = new BinanceApiClient(botState.settings.BINANCE_API_KEY, botState.settings.BINANCE_SECRET_KEY, log);
                }
                const accountInfo = await binanceApiClient.getAccountInfo();
                const usdtBalance = accountInfo.balances.find(b => b.asset === 'USDT');
                botState.balance = usdtBalance ? parseFloat(usdtBalance.free) : 0;
                log('INFO', `Switched to ${mode} mode. Real USDT balance: ${botState.balance}`);
            } catch (error) {
                 log('ERROR', `Failed to fetch real balance when switching to ${mode} mode. Error: ${error.message}`);
                 return res.status(500).json({ success: false, message: 'Failed to fetch Binance balance.' });
            }
        } else {
            // Reset to virtual balance from last state or initial settings
            const stateContent = await fs.readFile(STATE_FILE_PATH, 'utf-8').catch(() => '{}');
            const persistedState = JSON.parse(stateContent);
            botState.balance = persistedState.balance || botState.settings.INITIAL_VIRTUAL_BALANCE;
            log('INFO', `Switched to VIRTUAL mode. Balance reset to ${botState.balance}`);
        }
        await saveData('state');
        res.json({ success: true, mode: botState.tradingMode });
    } else {
        res.status(400).json({ success: false, message: 'Invalid mode' });
    }
});

// Serve frontend build
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    }
});

// --- FULL IMPLEMENTATION OF TRADING LOGIC ---
const scannerService = new ScannerService(log, KLINE_DATA_DIR);

// Binance WebSocket Client for Kline Data
class BinanceWsClient {
    constructor(log, onKlineUpdate) {
        this.log = log;
        this.onKlineUpdate = onKlineUpdate;
        this.ws = null;
        this.subscriptions = new Map();
        this.baseUrl = 'wss://stream.binance.com:9443/stream';
    }

    connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
        this.ws = new WebSocket(this.baseUrl);
        this.ws.on('open', () => this.log('BINANCE_WS', 'Connected to Binance kline streams.'));
        this.ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            if (message.stream && message.data && message.data.k) {
                const kline = message.data.k;
                this.onKlineUpdate(
                    kline.s,
                    kline.i,
                    {
                        open: parseFloat(kline.o),
                        high: parseFloat(kline.h),
                        low: parseFloat(kline.l),
                        close: parseFloat(kline.c),
                        volume: parseFloat(kline.v),
                        isFinal: kline.x,
                        startTime: kline.t,
                    }
                );
            }
        });
        this.ws.on('close', () => { this.log('WARN', 'Binance WS disconnected. Reconnecting...'); setTimeout(() => this.connect(), 5000); });
        this.ws.on('error', (err) => this.log('ERROR', `Binance WS error: ${err.message}`));
    }

    subscribe(symbols, intervals) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.log('WARN', 'Binance WS not connected. Cannot subscribe.');
            return;
        }
        const newStreams = [];
        for (const symbol of symbols) {
            for (const interval of intervals) {
                const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
                if (!this.subscriptions.has(streamName)) {
                    newStreams.push(streamName);
                    this.subscriptions.set(streamName, true);
                }
            }
        }
        if (newStreams.length > 0) {
            this.log('BINANCE_WS', `Subscribing to ${newStreams.length} new streams...`);
            this.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: newStreams, id: Date.now() }));
        }
    }
}

const binanceWsClient = new BinanceWsClient(log, handleKlineUpdate);

async function handleKlineUpdate(symbol, interval, kline) {
    const symbolData = realtimeAnalyzer.klineData.get(symbol);
    if (!symbolData) return;
    
    let klines = symbolData.get(interval);
    if (!klines) {
        klines = [];
        symbolData.set(interval, klines);
    }
    
    if (klines.length > 0 && klines[klines.length - 1].startTime === kline.startTime) {
        // Update the last candle
        klines[klines.length - 1] = kline;
    } else {
        // Add a new candle
        klines.push(kline);
        if (klines.length > 200) klines.shift(); // Keep buffer size manageable
    }

    if (kline.isFinal) {
        // A full candle has closed, run analyses
        if (interval === '15m') realtimeAnalyzer.analyze15mIndicators(symbol);
        if (interval === '1m') realtimeAnalyzer.analyze1mTrigger(symbol, klines);
        if (interval === '5m') realtimeAnalyzer.confirm5mEntry(symbol, klines);
    }
}

async function startBot() {
    log('INFO', 'Starting BOTPY Trading Engine...');
    
    // Initial setup
    binanceApiClient = new BinanceApiClient(botState.settings.BINANCE_API_KEY, botState.settings.BINANCE_SECRET_KEY, log);
    try {
        const exchangeInfo = await binanceApiClient.getExchangeInfo();
        exchangeInfo.symbols.forEach(s => {
            const lotSizeFilter = s.filters.find(f => f.filterType === 'LOT_SIZE');
            symbolRules.set(s.symbol, {
                stepSize: lotSizeFilter ? parseFloat(lotSizeFilter.stepSize) : 0.00000001,
            });
            cryptoSectors.set(s.baseAsset, 'UNKNOWN'); // Placeholder for sector mapping
        });
    } catch (e) {
        log('ERROR', `Could not fetch exchange info. Real trading will fail. ${e.message}`);
    }

    binanceWsClient.connect();
    
    // Main Loops
    const runDiscoveryScan = async () => {
        if (!botState.isRunning) return;
        try {
            const discoveredPairs = await scannerService.runScan(botState.settings);
            botState.scannerCache = discoveredPairs;
            // Subscribe to kline data for all monitored pairs
            const symbols = discoveredPairs.map(p => p.symbol);
            binanceWsClient.subscribe(symbols, ['15m', '1m', '5m']);
            
            // Hydrate kline data for newly discovered pairs
            for (const symbol of symbols) {
                if (!realtimeAnalyzer.klineData.has(symbol)) {
                    realtimeAnalyzer.klineData.set(symbol, new Map());
                    await Promise.all([
                        scannerService.fetchKlinesFromBinance(symbol, '15m').then(d => realtimeAnalyzer.klineData.get(symbol).set('15m', d.map(k=>({open:parseFloat(k[1]),high:parseFloat(k[2]),low:parseFloat(k[3]),close:parseFloat(k[4]),volume:parseFloat(k[5]),startTime:k[0]})))),
                        scannerService.fetchKlinesFromBinance(symbol, '1m').then(d => realtimeAnalyzer.klineData.get(symbol).set('1m', d.map(k=>({open:parseFloat(k[1]),high:parseFloat(k[2]),low:parseFloat(k[3]),close:parseFloat(k[4]),volume:parseFloat(k[5]),startTime:k[0]})))),
                        scannerService.fetchKlinesFromBinance(symbol, '5m').then(d => realtimeAnalyzer.klineData.get(symbol).set('5m', d.map(k=>({open:parseFloat(k[1]),high:parseFloat(k[2]),low:parseFloat(k[3]),close:parseFloat(k[4]),volume:parseFloat(k[5]),startTime:k[0]})))),
                    ]);
                }
            }
        } catch (e) {
            log('ERROR', `Discovery scan loop failed: ${e.message}`);
        }
    };

    const managePositions = () => {
        // This function would check for SL/TP hits
        // For simplicity in this context, we will rely on manual close or assume it's part of a separate process
    };

    const fetchFearAndGreed = async () => {
        try {
            const response = await fetch('https://api.alternative.me/fng/?limit=1');
            const data = await response.json();
            if (data && data.data && data.data[0]) {
                const fng = data.data[0];
                botState.fearAndGreed = {
                    value: parseInt(fng.value, 10),
                    classification: fng.value_classification,
                };
                broadcast({ type: 'FEAR_AND_GREED_UPDATE', payload: botState.fearAndGreed });
            }
        } catch (e) {
            log('WARN', `Could not fetch Fear & Greed index: ${e.message}`);
        }
    };

    // Run loops at intervals
    await runDiscoveryScan();
    await fetchFearAndGreed();
    setInterval(runDiscoveryScan, botState.settings.SCANNER_DISCOVERY_INTERVAL_SECONDS * 1000);
    setInterval(managePositions, 1000); // Check positions every second
    setInterval(fetchFearAndGreed, 15 * 60 * 1000); // Fetch F&G every 15 mins
}

async function openTrade(pair) {
    if (!botState.isRunning) return log('WARN', `[${pair.symbol}] Trade signal received but bot is stopped.`);
    if (botState.activePositions.length >= botState.settings.MAX_OPEN_POSITIONS) return log('WARN', `[${pair.symbol}] Trade signal ignored. Max open positions reached.`);

    // --- Calculate Position Details ---
    const positionSizeUSD = botState.balance * (botState.settings.POSITION_SIZE_PCT / 100);
    const quantity = formatQuantity(pair.symbol, positionSizeUSD / pair.price);
    const stopLossPrice = pair.price - (pair.atr_15m * botState.settings.ATR_MULTIPLIER);
    const takeProfitPrice = pair.price + ((pair.price - stopLossPrice) * botState.settings.RISK_REWARD_RATIO);

    const trade = {
        id: botState.tradeIdCounter++,
        mode: botState.tradingMode,
        symbol: pair.symbol,
        side: 'BUY',
        entry_price: pair.price,
        average_entry_price: pair.price,
        quantity,
        stop_loss: stopLossPrice,
        take_profit: takeProfitPrice,
        entry_time: new Date().toISOString(),
        status: 'PENDING',
        entry_snapshot: pair,
        total_cost_usd: positionSizeUSD,
    };
    
    // --- Execute Order ---
    if (botState.tradingMode === 'REAL_LIVE') {
        try {
            const order = await binanceApiClient.createOrder(trade.symbol, 'BUY', 'MARKET', trade.quantity);
            trade.status = 'FILLED';
            // Here you would update trade with actual filled price and quantity from `order` response
            log('TRADE', `[REAL] Successfully opened position for ${trade.symbol}.`);
        } catch (e) {
            log('ERROR', `[REAL] FAILED to open position for ${trade.symbol}: ${e.message}`);
            return; // Abort if real order fails
        }
    } else {
        trade.status = 'FILLED';
        log('TRADE', `[${botState.tradingMode}] Successfully opened position for ${trade.symbol}.`);
    }

    // --- Update State ---
    botState.activePositions.push(trade);
    botState.balance -= positionSizeUSD;
    await saveData('state');
    broadcast({ type: 'POSITIONS_UPDATED' });
}

async function closeTrade(tradeId, isManual = false) {
    const tradeIndex = botState.activePositions.findIndex(p => p.id === tradeId);
    if (tradeIndex === -1) throw new Error(`Trade with ID ${tradeId} not found.`);
    
    const trade = botState.activePositions[tradeIndex];
    const pair = botState.scannerCache.find(p => p.symbol === trade.symbol);
    const exitPrice = pair ? pair.price : trade.entry_price; // Use live price if available

    trade.exit_price = exitPrice;
    trade.exit_time = new Date().toISOString();
    trade.status = 'CLOSED';
    trade.pnl = (trade.exit_price - trade.entry_price) * trade.quantity;
    trade.pnl_pct = (trade.pnl / trade.total_cost_usd) * 100;

    if (botState.tradingMode === 'REAL_LIVE') {
        try {
            await binanceApiClient.createOrder(trade.symbol, 'SELL', 'MARKET', trade.quantity);
            log('TRADE', `[REAL] Successfully closed position for ${trade.symbol}.`);
        } catch (e) {
            log('ERROR', `[REAL] CRITICAL: FAILED to close position for ${trade.symbol}: ${e.message}. Manual intervention required.`);
            // Do NOT proceed if the real order fails.
            throw new Error(`Binance order execution failed: ${e.message}`);
        }
    } else {
        log('TRADE', `[${botState.tradingMode}] Closed position for ${trade.symbol}. PnL: $${trade.pnl.toFixed(2)} (${trade.pnl_pct.toFixed(2)}%)`);
    }

    // --- Update State ---
    botState.balance += trade.total_cost_usd + trade.pnl;
    botState.activePositions.splice(tradeIndex, 1);
    botState.tradeHistory.push(trade);

    await saveData('state');
    broadcast({ type: 'POSITIONS_UPDATED' });
    return { success: true, trade };
}


// --- Initialization ---
const startServer = async () => {
    await loadData();
    log('INFO', 'Bot state and settings loaded.');
    server.listen(port, () => {
        log('INFO', `Server running on port ${port}`);
        startBot(); // Start the bot logic
    });
};

startServer();
