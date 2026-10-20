// Bot-Hosting entrypoint for SNIPER.
// Serves the dashboard (index.html + state.json) over HTTP and runs the
// paper-trading cycle in trade.mjs once at boot, then every 10 seconds.
// SECURITY: restricted file serving, /cycle requires secret, rate limit on trades.
import express from 'express';
const app = express();
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, extname, sep } from 'path';
import { timingSafeEqual } from 'crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 3000);
const CYCLE_SECRET = process.env.CYCLE_SECRET || ''; // empty = manual /cycle disabled

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Allowlist of safe files to serve (not entire directory).
const SAFE_FILES = new Set(['/index.html', '/state.json']);


// Live price for the dashboard's forming candle. Cached for 2 s so many open
// browsers do not multiply calls to the exchange. Trading is not affected.
const LIVE_TTL = 2000;
let liveCache = { at: 0, price: null, error: null };
async function getLivePrice() {
  if (Date.now() - liveCache.at < LIVE_TTL) return liveCache;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD', { signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error('kraken HTTP ' + r.status);
    const body = await r.json();
    if (body.error && body.error.length) throw new Error(body.error.join(', '));
    const ticker = Object.values(body.result)[0];
    liveCache = { at: Date.now(), price: Number(ticker.c[0]), error: null };
  } catch (err) {
    liveCache = { at: Date.now(), price: liveCache.price, error: err.message };
  }
  return liveCache;
}

// Bot prices for ETH, BNB and XRP come from state.json, read at most once every 2 seconds.
let botStateCache = { at: 0, st: null };
async function getBotState() {
  if (botStateCache.st && Date.now() - botStateCache.at < 2000) return botStateCache.st;
  const file = join(dirname(fileURLToPath(import.meta.url)), 'state.json');
  const st = JSON.parse(await readFile(file, 'utf8'));
  botStateCache = { at: Date.now(), st };
  return st;
}

const server = createServer(async (req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('bad request');
  }

  // Manual trigger for a cycle, requires secret and POST only.
  if (path === '/cycle') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain' });
      return res.end('method not allowed');
    }
    const given = Buffer.from(String(req.headers['x-cycle-secret'] || ''));
    const want = Buffer.from(CYCLE_SECRET);
    if (!CYCLE_SECRET || given.length !== want.length || !timingSafeEqual(given, want)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      return res.end('forbidden');
    }
    res.writeHead(409, { 'content-type': 'text/plain' });
    return res.end('manual cycles are disabled: the trading daemon runs continuously');
  }

  if (path === '/live') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'content-type': 'text/plain' });
      return res.end('method not allowed');
    }
    const sym = (new URL(req.url, 'http://localhost').searchParams.get('sym') || 'BTC').toUpperCase();
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    if (sym === 'BTC') {
      const live = await getLivePrice();
      return res.end(JSON.stringify({ price: live.price, at: live.at, error: live.error }));
    }
    if (!['ETH', 'BNB', 'XRP'].includes(sym)) {
      return res.end(JSON.stringify({ price: null, at: null, error: 'unknown coin' }));
    }
    try {
      const st = await getBotState();
      const pool = st.coins && st.coins[sym];
      if (!pool || pool.price == null) {
        return res.end(JSON.stringify({ price: null, at: null, error: sym + ' not running yet' }));
      }
      return res.end(JSON.stringify({ price: pool.price, at: st.lastRun || null, error: null }));
    } catch (err) {
      return res.end(JSON.stringify({ price: null, at: null, error: err.message }));
    }
  }

  if (path === '/') path = '/index.html';

  // Only serve whitelisted files.
  if (!SAFE_FILES.has(path)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }

  const full = join(ROOT, path);
  // Double-check path traversal: resolved path must be in ROOT.
  if (!full.startsWith(ROOT + sep) && full !== ROOT) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('forbidden');
  }

  try {
    const body = await readFile(full);
    res.writeHead(200, {
      'content-type': TYPES[extname(full)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});
console.log('About to start server on', PORT);
app.get('/', (req, res) => {
  res.json({ status: 'ok', dashboard: 'running' });
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('SERVER STARTED on 0.0.0.0:' + PORT);
});

// Start the trading daemon once. If it ever stops, restart it after 5 seconds.
let daemon = null;
let daemonStartedAt = 0;
function startDaemonProcess() {
  const child = spawn(process.execPath, ['--max-old-space-size=256', 'trade.mjs', '--daemon'], { cwd: ROOT, stdio: 'inherit' });
  daemon = child;
  daemonStartedAt = Date.now();
  child.on('exit', code => {
    if (daemon === child) daemon = null;
    console.log(`[daemon] trade.mjs stopped (code ${code}); restarting in 5 s`);
    setTimeout(startDaemonProcess, 5000);
  });
  child.on('error', err => console.error('[daemon] could not start trade.mjs:', err.message));
}
startDaemonProcess();

// Watchdog: if the bot's data is older than 45 seconds, the daemon is stuck; restart it.
// It waits a minute after each start, so a fresh process is never restarted by mistake.
setInterval(async () => {
  if (!daemon || Date.now() - daemonStartedAt < 60000) return;
  try {
    const st = JSON.parse(await readFile(new URL('./state.json', import.meta.url), 'utf8'));
    const age = Date.now() - Date.parse(st.lastRun || 0);
    if (age > 45000) {
      console.log(`[watchdog] bot data is ${Math.round(age / 1000)} s old; restarting the trading daemon`);
      daemon.kill('SIGKILL');
    }
  } catch (e) {
    console.log('[watchdog] could not read state.json: ' + e.message);
  }
}, 15000);
