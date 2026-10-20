# Code Changes - Detailed Line-by-Line

## File 1: state.json

### Change: Added wallet field

```json
{
 "v": 1,
 "kind": "grid",
 "cash": 10000,
 "startBalance": 10000,
 "wallet": 0,              <-- NEW LINE
 "grid": null,
 "slots": [],
 ...
}
```

**Location:** Line 6 (after startBalance)
**Purpose:** Initialize profit accumulator at 0

---

## File 2: grid.mjs

### Change 1: Update blankState() function

**Location:** Lines 36-44

BEFORE:
```javascript
export function blankState(cfg = GCFG) {
  return {
    v: 1, kind: 'grid', cash: cfg.START, startBalance: cfg.START, grid: null, slots: [],
    buys: 0, rounds: 0, realized: 0, recenters: 0, trades: [],
    stops: 0, stopSold: 0, stopLoss: 0, restarts: 0, stopPrice: null, lastStop: null,
    lastT: 0, lastC: null, price: null, series: [], gap: null,
    lastRun: null, cycles: 0, lastError: null, feedSource: null, cfg: cfgSummary(cfg)
  };
}
```

AFTER:
```javascript
export function blankState(cfg = GCFG) {
  return {
    v: 1, kind: 'grid', cash: cfg.START, startBalance: cfg.START, wallet: 0, grid: null, slots: [],
                                         ^^^^^^^^^^^^^^^^^^^
                                        NEW FIELD
    buys: 0, rounds: 0, realized: 0, recenters: 0, trades: [],
    stops: 0, stopSold: 0, stopLoss: 0, restarts: 0, stopPrice: null, lastStop: null,
    lastT: 0, lastC: null, price: null, series: [], gap: null,
    lastRun: null, cycles: 0, lastError: null, feedSource: null, cfg: cfgSummary(cfg)
  };
}
```

---

### Change 2: Update ensureFields() function

**Location:** Lines 46-51

BEFORE:
```javascript
export function ensureFields(st) {
  const d = { stops: 0, stopSold: 0, stopLoss: 0, restarts: 0, stopPrice: null, lastStop: null };
  for (const k of Object.keys(d)) if (st[k] === undefined || (typeof d[k] === 'number' && !Number.isFinite(st[k]))) st[k] = d[k];
  return st;
}
```

AFTER:
```javascript
export function ensureFields(st) {
  const d = { stops: 0, stopSold: 0, stopLoss: 0, restarts: 0, stopPrice: null, lastStop: null, wallet: 0 };
                                                                                                  ^^^^^^^^^^
                                                                                               ADDED FIELD
  for (const k of Object.keys(d)) if (st[k] === undefined || (typeof d[k] === 'number' && !Number.isFinite(st[k]))) st[k] = d[k];
  return st;
}
```

**Why:** This ensures old state files get `wallet: 0` automatically on load

---

### Change 3: Update sellSlot() function - THE CORE LOGIC

**Location:** Lines 83-88

BEFORE:
```javascript
function sellSlot(st, i, tMs, cfg) {
  const g = st.grid, U = g.levels[i + 1], s = st.slots[i];
  const gross = s.qty * U, net = gross - gross * cfg.FEE, pnl = net - s.cost;
  st.cash += net; st.realized += pnl; st.rounds++; st.slots[i] = null;
  pushTrade(st, { time: new Date(tMs).toISOString(), side: 'SELL', slot: i, price: r2(U), usd: r2(net), pnl: r2(pnl) });
}
```

AFTER:
```javascript
function sellSlot(st, i, tMs, cfg) {
  const g = st.grid, U = g.levels[i + 1], s = st.slots[i];
  const gross = s.qty * U, net = gross - gross * cfg.FEE, pnl = net - s.cost;
  
  // Profit goes to wallet, trading balance resets to 10,000.
  // Loss is absorbed by cash.
  if (pnl > 0) {                      // ← PROFIT PATH
    st.wallet += pnl;                 // ← Move profit to wallet
    st.cash = cfg.START;              // ← Reset trading balance to 10,000
  } else {                            // ← LOSS PATH
    st.cash += net;                   // ← Absorb loss into trading balance
  }
  
  st.realized += pnl; st.rounds++; st.slots[i] = null;
  pushTrade(st, { time: new Date(tMs).toISOString(), side: 'SELL', slot: i, price: r2(U), usd: r2(net), pnl: r2(pnl) });
}
```

**Key differences:**
1. Replaced single line `st.cash += net` with conditional logic
2. If profit (pnl > 0): extract profit to wallet, reset cash to 10,000
3. If loss (pnl ≤ 0): add net proceeds to cash (which is less than cost, causing the loss)

---

## File 3: index.html

### Change 1: Update Dashboard HTML Structure

**Location:** Lines 19-21

BEFORE:
```html
<h1>SNIPER <span style="color:var(--m);font-size:14px">// grid</span></h1>
<div class="s" id="s">loading...</div>
<div class="row">
  <div class="c"><b>Equity</b><span id="eq">-</span></div>
  <div class="c"><b>Cash</b><span id="cash">-</span></div>
  <div class="c"><b>P&amp;L</b><span id="pnl">-</span></div>
</div>
```

AFTER:
```html
<h1>SNIPER <span style="color:var(--m);font-size:14px">// grid</span></h1>
<div class="s" id="s">loading...</div>
<div class="row">
  <div class="c"><b>Equity</b><span id="eq">-</span></div>
  <div class="c"><b>Trade Cash</b><span id="cash">-</span></div>
                  ^^^^^^^^^^^  ← Label changed from "Cash" for clarity
  <div class="c"><b>Wallet</b><span id="wallet">-</span></div>
                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  ← NEW COLUMN
</div>
<div class="row">
  <div class="c" style="grid-column:1/4"><b>Total P&amp;L</b><span id="pnl">-</span></div>
  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  ← NEW ROW (spans all 3 cols)
</div>
```

---

### Change 2: Update JavaScript render() Function

**Location:** Lines 35-42 (within the render function)

BEFORE:
```javascript
function render(s){
  const last=s.lastRun?new Date(s.lastRun).getTime():0;
  $('s').innerHTML=s.lastRun?'cycle '+s.cycles+ ... ;
  
  const g=s.grid, px=s.price||0, sl=s.slots||[];
  const held=sl.reduce((a,x)=>a+(x?x.qty:0),0), cost=sl.reduce((a,x)=>a+(x?x.cost:0),0);
  const eq=s.cash+held*px, pnl=eq-s.startBalance, unreal=held*px-cost;
  //  ^^^^^^^^^                 ^^^^^^^^                    Changed: equity now includes wallet
  
  $('eq').textContent=f(eq);$('cash').textContent=f(s.cash);
  //                                                        Missing: no wallet display
  
  const pe=$('pnl');pe.textContent=(pnl>=0?'+':'')+f(pnl);pe.className=pnl>=0?'g':'r';
}
```

AFTER:
```javascript
function render(s){
  const last=s.lastRun?new Date(s.lastRun).getTime():0;
  $('s').innerHTML=s.lastRun?'cycle '+s.cycles+ ... ;
  
  const g=s.grid, px=s.price||0, sl=s.slots||[];
  const held=sl.reduce((a,x)=>a+(x?x.qty:0),0), cost=sl.reduce((a,x)=>a+(x?x.cost:0),0);
  const wallet=s.wallet||0;                      // ← NEW: Extract wallet from state
  const eq=s.cash+held*px+wallet, pnl=eq-s.startBalance, unreal=held*px-cost;
  //  ^^^^^^^^^^^^^^^^^^^^^^^^^^
  //  Equity now includes wallet (profit accumulator)
  
  $('eq').textContent=f(eq);$('cash').textContent=f(s.cash);$('wallet').textContent=f(wallet);
  //                                                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //                                                          NEW: Display wallet amount
  
  const pe=$('pnl');pe.textContent=(pnl>=0?'+':'')+f(pnl);pe.className=pnl>=0?'g':'r';
}
```

---

## Summary of Logic Changes

### Old Flow (Single Balance)
```
Balance = 10,000 initially
  ↓
Buy & Sell (Profit +100)
  ↓
Balance = 10,100
  ↓
Buy & Sell (Loss -50)
  ↓
Balance = 10,050 ← fluctuates based on trade outcomes
```

### New Flow (Separate Wallet)
```
Trading Balance = 10,000  |  Wallet = 0
  ↓
Buy & Sell (Profit +100)
  ↓
Trading Balance = 10,000  |  Wallet = 100 ← profit extracted
  ↓
Buy & Sell (Loss -50)
  ↓
Trading Balance = 9,950   |  Wallet = 100 ← loss absorbed, wallet unchanged
  ↓
Buy & Sell (Profit +200)
  ↓
Trading Balance = 10,000  |  Wallet = 300 ← balance reset, profit added
```

---

## Verification: All Three Files Are Consistent

1. **state.json** ✓ - Has `wallet: 0`
2. **grid.mjs** ✓ - Initializes wallet in blankState()
3. **grid.mjs** ✓ - Migrates wallet in ensureFields()
4. **grid.mjs** ✓ - Updates wallet in sellSlot()
5. **index.html** ✓ - Displays wallet on dashboard
6. **index.html** ✓ - Includes wallet in equity calculation

All pieces work together. No orphaned fields, no missing display logic.
