// SNIPER GRID - one live cycle (or backtest). Data: Kraken 1-minute candles,
// fallbacks: Binance market-data mirror, then Coinbase. Paper trading only.
//   node trade.mjs                 -> one cycle, updates state.json
//   node trade.mjs --backtest 30   -> backtest last 30 days of 1-minute candles
import { readFile, writeFile, rename, copyFile, access } from 'fs/promises';
import { GCFG, IV_MS, blankState, liveStep, backtest, heldCount } from './grid.mjs';
import { runForex, runForexPair, FOREX_POOLS } from './forex.mjs';

const STATE_PATH = new URL('./state.json', import.meta.url);
const TMP_PATH = new URL('./state.json.tmp', import.meta.url);
const BACKUP_PATH = new URL('./state.previous-backup.json', import.meta.url);
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; sniper-grid/1.0)' };
const BINANCE = ['https://data-api.binance.vision', 'https://api.binance.com'];

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + new URL(url).host);
  return res.json();
}

async function fromKraken() {
  const j = await getJson('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1');
  if (j.error && j.error.length) throw new Error('kraken: ' + j.error.join(', '));
  const key = Object.keys(j.result).find(k => k !== 'last');
  return j.result[key].map(r => ({ t: r[0] * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
}

// ---- chart history (display only; trading still uses the 1-minute candles above) ----
// ---- chart config ----
// BTC chart: Binance 5-min, 1,500 candles (~5 days). Fallback: Kraken 5-min.
// Other coins: Bybit 5-min, 1,000 candles (~3.5 days). Fallback: Binance 5-min.
const BTC_CHART_CANDLES = 1500;
const CHART_REFRESH_MS = 60000;
const r2 = v => Number(v.toPrecision(7));   // chart prices: keep 7 significant digits (XRP needs more than 2 decimals)
let chartCache = { at: 0, rows: null };

// ---- per-coin config table (ETH, BNB, XRP) ----
const COINS = [
  { key: 'ETH', symbol: 'ETHUSDT', chartCandles: 1000, krakenPair: 'ETHUSD' },
  { key: 'BNB', symbol: 'BNBUSDT', chartCandles: 1000, krakenPair: null },
  { key: 'XRP', symbol: 'XRPUSDT', chartCandles: 1000, krakenPair: 'XRPUSD' },
];
const coinChartCache = {};  // { ETH:{at,rows}, BNB:{at,rows}, XRP:{at,rows} }

// ---- generic Bybit helpers ----
async function bybitKline(symbol, interval, limit) {
  const r = await getJson(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (r.retCode !== 0) throw new Error('bybit: ' + r.retMsg);
  return r.result.list.reverse().map(r => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
}
async function binanceKline(symbol, interval, limit) {
  for (const host of BINANCE) {
    try {
      const rows = await getJson(`${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      return rows.map(r => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
    } catch (e) { /* try next host */ }
  }
  throw new Error(`binance ${symbol} ${interval} unavailable`);
}

// BTC 5-min chart: Binance primary, Kraken fallback.
async function btcChartFromBinance() { return binanceKline('BTCUSDT', '5m', BTC_CHART_CANDLES); }
async function btcChartFromKraken() {
  const j = await getJson('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=5');
  if (j.error && j.error.length) throw new Error('kraken: ' + j.error.join(', '));
  const key = Object.keys(j.result).find(k => k !== 'last');
  return j.result[key].map(r => ({ t: r[0] * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
}

// BTC 5-min chart series (stored in st.series).
// Slow history downloads run in the background once a copy exists, so they never hold up a trading cycle.
const inFlight = {};
function refreshInBackground(key, job) {
  if (inFlight[key]) return;
  inFlight[key] = job().catch(e => console.log(key + ': ' + e.message)).finally(() => { inFlight[key] = null; });
}

async function updateChartSeries(st, now) {
  if (!chartCache.rows || now - chartCache.at >= CHART_REFRESH_MS) {
    const job = async () => {
      let rows;
      try { rows = clean(await btcChartFromBinance()); }
      catch (e) { console.log('btc chart binance: ' + e.message); rows = clean(await btcChartFromKraken()); }
      rows = rows.slice(-BTC_CHART_CANDLES);
      if (rows.length >= 20) chartCache = { at: Date.now(), rows };
    };
    if (chartCache.rows) refreshInBackground('btc-chart', job);
    else { try { await job(); } catch (e) { console.log('btc chart history: ' + e.message); } }
  }
  if (!chartCache.rows) return;
  const rows = chartCache.rows.map(q => ({ ...q })), last = rows[rows.length - 1], p = st.price;
  if (p && last.t + 5 * 60000 > now) { last.c = p; last.h = Math.max(last.h, p); last.l = Math.min(last.l, p); }
  st.series = rows.map(q => ({ t: q.t, o: r2(q.o), h: r2(q.h), l: r2(q.l), c: r2(q.c) }));
}

// 1-min trading candles for a coin (Bybit primary, Kraken fallback if krakenPair set).
// Trading candles come from one source only (Bybit). No fallback while trading: a late answer is marked delayed instead.
async function fetchCoinCandles(coin) {
  return bybitKline(coin.symbol, '1', 1000);
}

// 5-min chart series for a coin (Bybit primary, Binance fallback).
async function updateCoinChartSeries(coin, pool, now) {
  const cache = coinChartCache[coin.key] || (coinChartCache[coin.key] = { at: 0, rows: null });
  if (!cache.rows || now - cache.at >= CHART_REFRESH_MS) {
    const job = async () => {
      let rows;
      try { rows = clean(await bybitKline(coin.symbol, '5', coin.chartCandles)); }
      catch (e) { console.log(`${coin.key} chart bybit: ${e.message}`); rows = clean(await binanceKline(coin.symbol, '5m', coin.chartCandles)); }
      rows = rows.slice(-coin.chartCandles);
      if (rows.length >= 20) Object.assign(cache, { at: Date.now(), rows });
    };
    if (cache.rows) refreshInBackground('coin-chart-' + coin.key, job);
    else { try { await job(); } catch (e) { console.log(`${coin.key} chart: ${e.message}`); } }
  }
  if (!cache.rows) return;
  const rows = cache.rows.map(q => ({ ...q })), last = rows[rows.length - 1], p = pool.price;
  if (p && last.t + 5 * 60000 > now) { last.c = p; last.h = Math.max(last.h, p); last.l = Math.min(last.l, p); }
  pool.series = rows.map(q => ({ t: q.t, o: r2(q.o), h: r2(q.h), l: r2(q.l), c: r2(q.c) }));
}

// Each coin runs its own grid with its own cash pool (stored in st.coins[key]).
// Also migrates an old st.eth pool into st.coins.ETH on first load.
async function runCoins(st, now) {
  if (!st.coins) st.coins = {};
  if (st.eth) { st.coins.ETH = st.eth; delete st.eth; }  // one-time migration
  for (const coin of COINS) if (!st.coins[coin.key]) st.coins[coin.key] = blankState();
  // Each coin has its own pool, so the coins are fetched at the same time.
  await Promise.all(COINS.map(async coin => {
    const pool = st.coins[coin.key];
    try {
      const candles = clean(await fetchCoinCandles(coin));
      liveStep(pool, candles, now);
      await updateCoinChartSeries(coin, pool, now);
      pool.lastError = null;
    } catch (e) { pool.lastError = e.message; }
  }));
}

async function binancePage(limit, startTime) {
  let lastErr;
  for (const host of BINANCE) {
    try {
      let u = host + '/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=' + limit;
      if (startTime) u += '&startTime=' + startTime;
      const rows = await getJson(u);
      return rows.map(r => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Coinbase candles: [time_sec, low, high, open, close, volume], newest first.
async function fromCoinbase(startMs, endMs) {
  let u = 'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60';
  if (startMs) u += '&start=' + new Date(startMs).toISOString() + '&end=' + new Date(endMs).toISOString();
  const rows = await getJson(u);
  return rows.map(r => ({ t: r[0] * 1000, l: +r[1], h: +r[2], o: +r[3], c: +r[4] }));
}

function clean(rows) {
  const seen = new Map();
  for (const b of rows) {
    if ([b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) && b.o > 0 && b.h >= b.l) seen.set(b.t, b);
  }
  return [...seen.values()].sort((a, b) => a.t - b.t);
}

// Raw rows -> safe candle list whose LAST item is the still-forming minute.
function prepareLive(rows, now) {
  const c = clean(rows);
  if (c.length < 20) throw new Error('only ' + c.length + ' candles');
  const last = c[c.length - 1];
  if (now - last.t > 6 * IV_MS) throw new Error('stale, last candle ' + Math.round((now - last.t) / 60000) + ' min old');
  if (last.t + IV_MS <= now) {
    // feed has no row for the current minute yet (no trade so far, or it lists only finished candles)
    if (now - (last.t + IV_MS) > 3 * IV_MS) throw new Error('feed has no current candle');
    c.push({ t: Math.floor(now / IV_MS) * IV_MS, o: last.c, h: last.c, l: last.c, c: last.c });
  }
  return c;
}

async function getLive(now) {
  const sources = [
    ['kraken', fromKraken],
    ['binance (fallback)', () => binancePage(500)],
    ['coinbase (fallback)', () => fromCoinbase()]
  ];
  const errs = [];
  for (const [name, fn] of sources) {
    try { return { candles: prepareLive(await fn(), now), source: name }; }
    catch (e) { errs.push(name.split(' ')[0] + ': ' + e.message); }
  }
  throw new Error('all feeds failed (' + errs.join(' | ') + ')');
}

async function histBinance(days, now) {
  let from = now - days * 86400000, out = [];
  for (let k = 0; k < 120; k++) {
    const page = await binancePage(1000, from);
    if (!page.length) break;
    out = out.concat(page);
    from = page[page.length - 1].t + IV_MS;
    if (page.length < 1000 || from >= now) break;
  }
  return out;
}

async function histCoinbase(days, now) {
  const step = 299 * IV_MS; // stay under the 300-candle limit per request
  let out = [];
  for (let from = now - days * 86400000, k = 0; from < now && k < 200; from += step, k++) {
    out = out.concat(await fromCoinbase(from, Math.min(from + step, now)));
    await new Promise(r => setTimeout(r, 150));
  }
  return out;
}

async function getHistory(days, now) {
  const tries = [
    ['binance', () => histBinance(days, now)],
    ['coinbase', () => histCoinbase(days, now)],
    ['kraken (only the last ~12 hours exist)', () => fromKraken()]
  ];
  for (const [name, fn] of tries) {
    try {
      const c = clean(await fn());
      while (c.length && c[c.length - 1].t + IV_MS > now) c.pop(); // drop still-forming minute
      if (c.length >= 300) return { candles: c, source: name };
      console.log(name + ': too few candles (' + c.length + ')');
    } catch (e) { console.log(name + ' failed: ' + e.message); }
  }
  throw new Error('no history source worked');
}


// One-time repair: trade cash was reset to the starting amount after each profitable sell,
// which counted the money in open slots twice. Trade cash = start + realized profit - coins still held - wallet.
function repairCash(pool) {
  if (!pool || pool.cashFixed) return;
  const held = (pool.slots || []).reduce((a, x) => a + (x ? x.cost : 0), 0);
  pool.cash = GCFG.START + (pool.realized || 0) - held - (pool.wallet || 0);
  pool.cashFixed = true;
}

async function loadState() {
  let s;
  try { s = JSON.parse(await readFile(STATE_PATH, 'utf8')); } catch { return blankState(); }
  if (s && s.kind === 'grid') { repairCash(s); for(const p of Object.values(s.coins||{})) repairCash(p); return s; }
  // a state file from another bot (for example the scalper): keep a copy, start a fresh grid account
  try { await access(BACKUP_PATH); } catch { try { await copyFile(STATE_PATH, BACKUP_PATH); } catch {} }
  return blankState();
}

async function saveState(st) {
  await writeFile(TMP_PATH, JSON.stringify(st, null, 1));
  await rename(TMP_PATH, STATE_PATH); // atomic: dashboard never reads a half-written file
}

async function runCycle() {
  const st = await loadState();
  const now = Date.now();
  const before = st.trades.length ? st.trades[st.trades.length - 1].time + st.trades.length : '';
  const hadGrid = !!st.grid;
  try {
    // BTC, the other coins and forex use separate data, so they are fetched at the same time.
    const cycleStart = Date.now();
    const btc = (async () => {
      const { candles, source } = await getLive(now);
      liveStep(st, candles, now);
      await updateChartSeries(st, now);
      st.feedSource = source;
    })();
    const [btcResult] = await Promise.allSettled([btc, runCoins(st, now), runForex(st, now)]);
    if (btcResult.status === 'rejected') throw btcResult.reason;
    if (Date.now() - cycleStart > 15000) console.log('[slow cycle] ' + (Date.now() - cycleStart) + ' ms');
    st.lastError = null;
    st.cycles++;
  } catch (e) {
    st.lastError = e.message;
    console.log('CYCLE ERROR:', e.message);
  }
  st.lastRun = new Date(now).toISOString();
  await saveState(st);
  // Cycles run every few seconds: print only on events, plus a heartbeat every 10 minutes.
  const after = st.trades.length ? st.trades[st.trades.length - 1].time + st.trades.length : '';
  const event = after !== before || (!hadGrid && !!st.grid);
  if (event || st.lastError || st.cycles % 60 === 0) {
    const held = st.grid ? heldCount(st) : 0;
    const qty = st.slots.reduce((a, s) => a + (s ? s.qty : 0), 0);
    console.log(new Date(now).toISOString().slice(11, 19) + ' cycle ' + st.cycles + ' | ' + (st.feedSource || '-') + ' | price ' + (st.price || 0).toFixed(0) +
      ' | holding ' + held + '/' + (st.grid ? st.grid.n : 0) + ' slots | rounds ' + st.rounds + ' | equity ' + (st.cash + qty * (st.price || 0)).toFixed(2) + (event ? ' | EVENT' : ''));
  }
}

async function runBacktest(days) {
  const { candles, source } = await getHistory(days, Date.now());
  const r = backtest(candles, GCFG);
  const f = (v, d = 2) => (v == null ? 'n/a' : v.toFixed(d));
  const sg = v => (v >= 0 ? '+' : '') + f(v);
  console.log('=== SNIPER GRID BACKTEST (stop loss ' + (GCFG.STOP > 0 ? GCFG.STOP * 100 + '% below range' : 'off') + ') ===');
  console.log('data          : ' + source + ', ' + candles.length + ' one-minute candles, ' + f(r.days, 1) + ' days');
  console.log('grid          : ' + r.slots + ' slots, step ' + f(r.step) + '% each, last range ' + f(r.st.grid.lower, 0) + ' to ' + f(r.st.grid.upper, 0) + (r.recenters ? ' (moved up ' + r.recenters + ' times)' : '') + (r.restarts ? ' (re-built ' + r.restarts + ' times after stops)' : ''));
  console.log('round trips   : ' + r.rounds + '  (about $' + f(r.avgRound) + ' each, total realized $' + f(r.realized) + ')');
  console.log('open at end   : ' + r.holding + ' of ' + r.slots + ' slots, open P&L $' + f(r.unrealized));
  if (GCFG.STOP > 0) {
    console.log('stop loss     : ' + GCFG.STOP * 100 + '% below the range (last stop price ' + f(r.stopPrice, 0) + '); hit ' + r.stops + ' times, lost $' + f(-r.stopLoss) + ' in total (a new grid starts right after each stop)');
  }
  console.log('time out of range: above ' + f(r.abovePct, 0) + '%, below ' + f(r.belowPct, 0) + '%     avg invested: ' + f(r.avgInvestedPct, 0) + '%');
  console.log('max drawdown  : ' + f(r.maxDDPct) + '%  (counts open losses)');
  console.log('net result    : ' + sg(r.retPct) + '%     buy&hold: ' + sg(r.holdPct) + '%');
  if (GCFG.STOP > 0) {
    const ns = backtest(candles, { ...GCFG, STOP: 0 });
    console.log('  same run WITHOUT the stop loss: ' + sg(ns.retPct) + '%, max drawdown ' + f(ns.maxDDPct) + '%');
  }
  if (r.rounds < 20) console.log('WARNING       : only ' + r.rounds + ' round trips. Too few to trust. Try more days.');
  console.log('WARNING       : a grid wins in a sideways market and bleeds in a long fall. The stop loss caps that,');
  console.log('                but it locks in the loss and can miss the rebound that follows.');
  console.log('                Test several periods (30, 45, 60 days) and read max drawdown and open P&L.');
}

// ---------------- daemon: one long-running process; each market has its own timer, spread across the cycle ----------------
const CYCLE_MS = 10000;

function ensurePools(st) {
  if (!st.coins) st.coins = {};
  if (st.eth) { st.coins.ETH = st.eth; delete st.eth; }
  for (const coin of COINS) if (!st.coins[coin.key]) st.coins[coin.key] = blankState();
  if (!st.forex) st.forex = {};
  for (const p of FOREX_POOLS) if (!st.forex[p.key]) st.forex[p.key] = blankState(p.cfg);
}

async function startDaemon() {
  const st = await loadState();
  ensurePools(st);
  st.timing = {};

  // Saves are serialized and at most once per second, so several markets never write the file at the same time.
  let saving = Promise.resolve();
  let savePending = false;
  const save = () => {
    if (savePending) return;
    savePending = true;
    setTimeout(() => {
      savePending = false;
      saving = saving.then(() => saveState(st)).catch(e => console.log('save failed: ' + e.message));
    }, 1000);
  };

  const markets = [
    { name: 'BTC', pool: st, run: async now => {
        const candles = prepareLive(await fromKraken(), now);
        liveStep(st, candles, now);
        await updateChartSeries(st, now);
        st.feedSource = 'kraken';
        st.cycles++;
        st.lastRun = new Date(now).toISOString();
        if (st.cycles % 60 === 0) console.log(`cycle ${st.cycles} | price ${(st.price || 0).toFixed(0)} | holding ${st.grid ? heldCount(st) : 0} slots`);
    } },
    ...COINS.map(coin => ({ name: coin.key, pool: st.coins[coin.key], run: async now => {
        const candles = clean(await fetchCoinCandles(coin));
        liveStep(st.coins[coin.key], candles, now);
        await updateCoinChartSeries(coin, st.coins[coin.key], now);
    } })),
    ...FOREX_POOLS.map(p => ({ name: p.key, pool: st.forex[p.key], run: now => runForexPair(st, p, now) })),
  ];

  const stagger = Math.floor(CYCLE_MS / markets.length);
  markets.forEach((m, i) => {
    let due = Date.now() + i * stagger;
    let lastLogged = '';
    const tick = async () => {
      const t0 = Date.now();
      try { await m.run(t0); m.pool.lastError = null; m.pool.delayed = false; lastLogged = ''; }
      catch (e) {
        m.pool.lastError = e.message; m.pool.delayed = true;
        if (e.message !== lastLogged) { console.log(`[${m.name}] ${e.message}`); lastLogged = e.message; }
      }
      const ms = Date.now() - t0;
      st.timing[m.name] = { ms, ok: !m.pool.lastError, at: new Date(t0).toISOString() };
      if (ms > 3000) console.log(`[slow] ${m.name} took ${ms} ms${m.pool.lastError ? ': ' + m.pool.lastError : ''}`);
      save();
      due += CYCLE_MS;
      setTimeout(tick, Math.max(0, due - Date.now()));
    };
    setTimeout(tick, Math.max(0, due - Date.now()));
  });
}

const argv = process.argv.slice(2);
const bi = argv.indexOf('--backtest');
if (argv.includes('--daemon')) {
  startDaemon().catch(e => { console.error('ERROR: ' + (e && e.message ? e.message : e)); process.exit(1); });
} else {
  const job = bi >= 0 ? runBacktest(Math.min(60, Math.max(2, Number(argv[bi + 1]) || 30))) : runCycle();
  job.catch(e => { console.error('ERROR: ' + (e && e.message ? e.message : e)); process.exit(1); });
}
