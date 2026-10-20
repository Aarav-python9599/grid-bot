// Forex and gold paper grids: EURUSD and XAUUSD. Prices come from biquote.io (MetaTrader 5 feed).
// Same grid logic as BTC (grid.mjs). Each pool has its own cash, starting at the same amount as BTC,
// and its own range and stop. The BTC settings are not changed here.
import { GCFG, blankState, liveStep } from './grid.mjs';

const API = 'https://biquote.io/api';

export const FOREX_POOLS = [
  { key: 'EURUSD', symbol: 'EURUSD', cfg: { ...GCFG, RANGE: 0.01, STOP: 0.01 } },   // +/-1% range, stop 1% below it
  { key: 'XAUUSD', symbol: 'XAUUSD', cfg: { ...GCFG, RANGE: 0.03, STOP: 0.02 } },   // +/-3% range, stop 2% below it
  { key: 'AUDUSD', symbol: 'AUDUSD', cfg: { ...GCFG, RANGE: 0.01, STOP: 0.01 } },   // +/-1% range, stop 1% below it
  { key: 'USDJPY', symbol: 'USDJPY', cfg: { ...GCFG, RANGE: 0.012, STOP: 0.01 } },  // +/-1.2% range, stop 1% below it
];

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('biquote HTTP ' + r.status);
  return r.json();
}

// biquote reports marketState "open" or "closed" on every reply. Forex is closed from Friday night to Sunday night.
async function isOpen(symbol) {
  const tick = await getJson(`${API}/${symbol}`);
  return tick.marketState === 'open';
}

// One-minute bars, oldest first. The newest bar may still be open; the grid logic handles that.
async function bars(symbol) {
  const j = await getJson(`${API}/${symbol}/ohlc?interval=1m&limit=1000`);
  return (j.bars || [])
    .map(b => ({ t: Date.parse(b.openTime), o: +b.open, h: +b.high, l: +b.low, c: +b.close }))
    .filter(b => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) && b.o > 0 && b.h >= b.l)
    .sort((a, b) => a.t - b.t);
}

// Chart history: 5-minute bars, up to 1000 (about 3.5 days), refreshed once a minute.
const SERIES_MS = 60000;
const seriesCache = {};
const r7 = v => Number(v.toPrecision(7));

async function chartBars(symbol) {
  const j = await getJson(`${API}/${symbol}/ohlc?interval=5m&limit=1000`);
  return (j.bars || [])
    .map(b => ({ t: Date.parse(b.openTime), o: +b.open, h: +b.high, l: +b.low, c: +b.close }))
    .filter(b => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) && b.o > 0 && b.h >= b.l)
    .sort((a, b) => a.t - b.t)
    .map(q => ({ t: q.t, o: r7(q.o), h: r7(q.h), l: r7(q.l), c: r7(q.c) }));
}

async function updateSeries(p, pool, now) {
  const c = seriesCache[p.key] || (seriesCache[p.key] = { at: 0, rows: null });
  if (!c.rows || now - c.at >= SERIES_MS) {
    const job = async () => {
      const rows = await chartBars(p.symbol);
      if (rows.length >= 20) Object.assign(c, { at: Date.now(), rows });
    };
    if (c.rows) job().catch(() => {});   // history refreshes in the background
    else { try { await job(); } catch (e) { /* no history yet */ } }
  }
  if (c.rows) pool.series = c.rows;
}

// One forex pair, one step: called by the daemon on its own timer, and by runForex.
export async function runForexPair(st, p, now) {
  if (!st.forex) st.forex = {};
  if (!st.forex[p.key]) st.forex[p.key] = blankState(p.cfg);
  const pool = st.forex[p.key];
  if (!(await isOpen(p.symbol))) { pool.lastError = null; return; }
  liveStep(pool, await bars(p.symbol), now, p.cfg);
  await updateSeries(p, pool, now);
  pool.lastError = null;
}

// Runs every forex pair once (used by the one-shot mode).
export async function runForex(st, now) {
  if (!st.forex) st.forex = {};
  for (const p of FOREX_POOLS) if (!st.forex[p.key]) st.forex[p.key] = blankState(p.cfg);
  await Promise.all(FOREX_POOLS.map(async p => {
    try { await runForexPair(st, p, now); }
    catch (e) { st.forex[p.key].lastError = e.message; }
  }));
}
