// SNIPER GRID - spot grid bot (BTC, 1-minute candles, long only, paper).
// A ladder of price levels between LOWER and UPPER. Each slot = one level pair:
//   slot i BUYS when price falls to levels[i], SELLS when price rises to levels[i+1].
// Every finished round trip earns about one grid step. No stop loss.
// Pure logic only (no network, no files) so it can be tested offline.

const num = (k, d) => {
  const raw = process.env[k];
  if (raw === undefined || raw === '') return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};

export const GCFG = {
  RANGE: num('SNIPER_RANGE', 0.05),                         // auto grid: +/-5% around start price
  GRIDS: Math.max(2, Math.floor(num('SNIPER_GRIDS', 10))),  // number of slots
  LOWER: num('SNIPER_LOWER', 0),                            // optional fixed bounds (both needed)
  UPPER: num('SNIPER_UPPER', 0),
  RECENTER: num('SNIPER_RECENTER', 1) === 1,                // when flat and price is above the grid
  STOP: num('SNIPER_STOP', 0.03),                           // stop price = lower bound * (1 - STOP). 0 = no stop loss
  START: 10000
};
export const IV_MS = 60000;
const r2 = v => Math.round(v * 100) / 100;
const rp = v => Number(v.toPrecision(7));   // prices: keep 7 significant digits

function cfgSummary(cfg = GCFG) {
  return { range: cfg.RANGE, grids: cfg.GRIDS, recenter: cfg.RECENTER, fixed: cfg.LOWER > 0 && cfg.UPPER > cfg.LOWER, stop: cfg.STOP };
}

// Price at which the stop loss fires (null = no stop loss).
function stopPriceOf(st, cfg = GCFG) {
  return st.grid && cfg.STOP > 0 ? st.grid.lower * (1 - cfg.STOP) : null;
}

export function blankState(cfg = GCFG) {
  return {
    v: 1, kind: 'grid', cash: cfg.START, startBalance: cfg.START, wallet: 0, grid: null, slots: [],
    buys: 0, rounds: 0, realized: 0, recenters: 0, trades: [],
    stops: 0, stopSold: 0, stopLoss: 0, restarts: 0, stopPrice: null, lastStop: null,
    lastT: 0, lastC: null, price: null, series: [], gap: null,
    lastRun: null, cycles: 0, lastError: null, feedSource: null, cfg: cfgSummary(cfg)
  };
}

// Older state files lack some fields: add them (never lose old data).
function ensureFields(st) {
  const d = { stops: 0, stopSold: 0, stopLoss: 0, restarts: 0, stopPrice: null, lastStop: null, wallet: 0 };
  for (const k of Object.keys(d)) if (st[k] === undefined || (typeof d[k] === 'number' && !Number.isFinite(st[k]))) st[k] = d[k];
  return st;
}

function makeLevels(lower, upper, n) {
  const levels = [];
  for (let k = 0; k <= n; k++) levels.push(lower * Math.pow(upper / lower, k / n)); // equal % steps
  levels[0] = lower; levels[n] = upper;
  return levels;
}

// (Re)build the grid around a price. All unused cash is split equally across slots.
function initGrid(st, price, tMs, cfg = GCFG) {
  const fixed = cfg.LOWER > 0 && cfg.UPPER > cfg.LOWER;
  const lower = fixed ? cfg.LOWER : price * (1 - cfg.RANGE);
  const upper = fixed ? cfg.UPPER : price * (1 + cfg.RANGE);
  const n = cfg.GRIDS;
  st.grid = { lower, upper, n, levels: makeLevels(lower, upper, n), perSlot: st.cash / n, createdAt: new Date(tMs).toISOString(), createdPrice: price, fixed };
  st.slots = new Array(n).fill(null);
}

function pushTrade(st, rec) {
  st.trades.push(rec);
  if (st.trades.length > 30) st.trades.shift();
}

function buySlot(st, i, tMs, cfg) {
  const g = st.grid, L = g.levels[i], spend = g.perSlot;
  if (st.cash < spend - 1e-9) return;
  const qty = spend / L;
  st.cash -= spend; st.slots[i] = { qty, cost: spend, t: tMs }; st.buys++;
  pushTrade(st, { time: new Date(tMs).toISOString(), side: 'BUY', slot: i, price: rp(L), usd: r2(spend) });
}

function sellSlot(st, i, tMs, cfg) {
  const g = st.grid, U = g.levels[i + 1], s = st.slots[i];
  const net = s.qty * U, pnl = net - s.cost;
  // Profit goes to wallet, trading balance resets to 10,000. Loss is absorbed by cash.
  if (pnl > 0) {
    st.wallet += pnl;        // profit leaves trading and goes to the wallet
    st.cash += net - pnl;    // only the cost of the coins sold comes back to trade cash
  } else {
    st.cash += net;          // loss stays in trade cash
  }
  st.realized += pnl; st.rounds++; st.slots[i] = null;
  pushTrade(st, { time: new Date(tMs).toISOString(), side: 'SELL', slot: i, price: rp(U), usd: r2(net), pnl: r2(pnl) });
}

// Sell every held slot at once (stop loss). The caller then builds a new grid.
function stopOut(st, fill, tMs, cfg) {
  ensureFields(st);
  let net = 0, pnl = 0, k = 0;
  for (let i = 0; i < st.slots.length; i++) {
    const sl = st.slots[i];
    if (!sl) continue;
    const n = sl.qty * fill;
    net += n; pnl += n - sl.cost; k++; st.slots[i] = null;
  }
  st.cash += net; st.realized += pnl; st.stopLoss += pnl; st.stopSold += k; st.stops++;
  st.lastStop = { at: new Date(tMs).toISOString(), price: fill, pnl, slots: k };
  pushTrade(st, { time: new Date(tMs).toISOString(), side: 'STOP', slot: -1, slots: k, price: rp(fill), usd: r2(net), pnl: r2(pnl) });
}

// Price moves in a straight line from a to b: fill every level it crosses, in order.
// Returns true if the stop loss fired (the rest of the candle is then ignored).
// isGap = the jump from the previous close to this candle's open: a stop fills at the open (worse than the stop price).
function seg(st, a, b, tMs, cfg, isGap) {
  const g = st.grid;
  if (b < a) {
    for (let i = g.n - 1; i >= 0; i--) {
      const L = g.levels[i];
      if (L <= a && L >= b && !st.slots[i]) buySlot(st, i, tMs, cfg);
    }
    const sp = stopPriceOf(st, cfg);
    if (sp != null && b <= sp && heldCount(st) > 0) {
      stopOut(st, isGap ? b : Math.min(a, sp), tMs, cfg);
      return true;
    }
  } else if (b > a) {
    for (let i = 0; i < g.n; i++) {
      const U = g.levels[i + 1];
      if (U >= a && U <= b && st.slots[i]) sellSlot(st, i, tMs, cfg);
    }
  }
  return false;
}

// Intra-candle path is unknown. Standard assumption:
//   up candle   : open -> low -> high -> close
//   down candle : open -> high -> low -> close
function walkCandle(st, b, cfg = GCFG) {
  const a0 = st.lastC == null ? b.o : st.lastC;
  const pts = b.c >= b.o ? [a0, b.o, b.l, b.h, b.c] : [a0, b.o, b.h, b.l, b.c];
  let stopped = false;
  for (let k = 0; k < pts.length - 1 && !stopped; k++) stopped = seg(st, pts[k], pts[k + 1], b.t, cfg, k === 0);
  st.lastC = b.c; st.lastT = b.t;
  if (stopped) {                       // no pause: new grid right away, around this candle's close
    initGrid(st, b.c, b.t, cfg);
    st.restarts = (st.restarts || 0) + 1;
  }
}

export const heldCount = st => st.slots.reduce((a, s) => a + (s ? 1 : 0), 0);
const heldQty = st => st.slots.reduce((a, s) => a + (s ? s.qty : 0), 0);

// Only when NOTHING is held and price has run above the grid: move the grid up to price.
function maybeRecenter(st, price, tMs, cfg = GCFG) {
  if (!cfg.RECENTER || st.grid.fixed || heldCount(st) > 0 || price <= st.grid.upper) return false;
  initGrid(st, price, tMs, cfg);
  st.recenters++;
  return true;
}

// One live cycle. candles = full list, the LAST one is the still-forming minute.
export function liveStep(st, candles, nowMs, cfg = GCFG) {
  ensureFields(st);
  const legacyPause = !!st.halt;     // state saved by the older version that paused after a stop
  delete st.halt;
  if (candles.length < 3) throw new Error('not enough candles: ' + candles.length);
  const forming = candles[candles.length - 1];
  const closed = candles.slice(0, -1);
  const last = closed[closed.length - 1];
  if (!st.grid) {
    initGrid(st, forming.c, nowMs, cfg);       // start from NOW, never from old candles
    st.lastT = last.t; st.lastC = last.c;
  } else {
    if (legacyPause) { initGrid(st, forming.c, nowMs, cfg); st.restarts = (st.restarts || 0) + 1; }
    const fresh = closed.filter(b => b.t > st.lastT);
    // data missing between the last processed minute and the first new one (bot or feed was down)
    if (st.lastT > 0 && fresh.length && fresh[0].t - st.lastT > 10 * IV_MS) {
      st.gap = { at: new Date(nowMs).toISOString(), minutes: Math.round((fresh[0].t - st.lastT) / 60000) };
    }
    for (const b of fresh) walkCandle(st, b, cfg);
    maybeRecenter(st, forming.c, nowMs, cfg);
  }
  st.price = forming.c;
  st.stopPrice = stopPriceOf(st, cfg);
  st.cfg = cfgSummary(cfg);
  st.series = toCandles5m(closed, forming);
}

// Group 1-minute candles into 5-minute candles for the chart (last 144 = 12 h).
function toCandles5m(closed, forming) {
  const B = 5 * 60000, map = new Map();
  for (const b of [...closed, forming]) {
    const k = Math.floor(b.t / B) * B;
    const m = map.get(k);
    if (!m) map.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c });
    else { m.h = Math.max(m.h, b.h); m.l = Math.min(m.l, b.l); m.c = b.c; }
  }
  return [...map.values()].slice(-144).map(q => ({ t: q.t, o: rp(q.o), h: rp(q.h), l: rp(q.l), c: rp(q.c) }));
}

// Walk-forward backtest over closed candles.
export function backtest(candles, cfg = GCFG) {
  const st = blankState(cfg);
  initGrid(st, candles[0].o, candles[0].t, cfg);
  let peak = cfg.START, maxDD = 0, invSum = 0, above = 0, below = 0;
  for (const b of candles) {
    walkCandle(st, b, cfg);
    maybeRecenter(st, b.c, b.t, cfg);
    const val = heldQty(st) * b.c, eq = st.cash + val;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
    invSum += val / eq;
    if (b.c > st.grid.upper) above++; else if (b.c < st.grid.lower) below++;
  }
  const last = candles[candles.length - 1];
  const held = heldQty(st) * last.c, equity = st.cash + held;
  const cost = st.slots.reduce((a, s) => a + (s ? s.cost : 0), 0);
  return {
    st, n: candles.length, days: candles.length / 1440,
    equity, retPct: (equity / cfg.START - 1) * 100, holdPct: (last.c / candles[0].o - 1) * 100,
    rounds: st.rounds, realized: st.realized, avgRound: st.rounds ? st.realized / st.rounds : 0,
    unrealized: held - cost, holding: heldCount(st), slots: cfg.GRIDS,
    maxDDPct: maxDD * 100, avgInvestedPct: invSum / candles.length * 100,
    stops: st.stops, stopLoss: st.stopLoss, restarts: st.restarts,
    stopPrice: stopPriceOf(st, cfg), recenters: st.recenters, abovePct: above / candles.length * 100, belowPct: below / candles.length * 100,
    step: (Math.pow(st.grid.upper / st.grid.lower, 1 / st.grid.n) - 1) * 100
  };
}
