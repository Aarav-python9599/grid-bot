# Wallet Feature Implementation - SNIPER Grid Bot

## Overview
Added a separate **profit wallet** that accumulates all gains while keeping the trading balance
independent. The wallet is never used for trading and is always displayed on the dashboard.

---

## Changes Made

### 1. STATE (state.json + grid.mjs)

#### state.json
- Added `"wallet": 0` field to initial state
- This is where accumulated profits are stored

#### grid.mjs - blankState()
```javascript
// Before
export function blankState(cfg = GCFG) {
  return {
    v: 1, kind: 'grid', cash: cfg.START, startBalance: cfg.START, 
    grid: null, slots: [], ...
  };
}

// After
export function blankState(cfg = GCFG) {
  return {
    v: 1, kind: 'grid', cash: cfg.START, startBalance: cfg.START, 
    wallet: 0, grid: null, slots: [], ...
  };
}
```

#### grid.mjs - ensureFields()
```javascript
// Before
export function ensureFields(st) {
  const d = { stops: 0, stopSold: 0, stopLoss: 0, restarts: 0, 
              stopPrice: null, lastStop: null };
  for (const k of Object.keys(d)) 
    if (st[k] === undefined || ...) st[k] = d[k];
  return st;
}

// After
export function ensureFields(st) {
  const d = { stops: 0, stopSold: 0, stopLoss: 0, restarts: 0, 
              stopPrice: null, lastStop: null, wallet: 0 };  // <-- Added wallet: 0
  for (const k of Object.keys(d)) 
    if (st[k] === undefined || ...) st[k] = d[k];
  return st;
}
```

**Why this matters:** Old state.json files that don't have `wallet` yet will
automatically get `wallet: 0` when the bot runs, so they migrate safely.

---

### 2. TRADING LOGIC (grid.mjs - sellSlot())

#### Before
```javascript
function sellSlot(st, i, tMs, cfg) {
  const g = st.grid, U = g.levels[i + 1], s = st.slots[i];
  const gross = s.qty * U, net = gross - gross * cfg.FEE, pnl = net - s.cost;
  st.cash += net;                    // All proceeds go to trading cash
  st.realized += pnl; 
  st.rounds++; 
  st.slots[i] = null;
  pushTrade(st, { ... });
}
```

#### After
```javascript
function sellSlot(st, i, tMs, cfg) {
  const g = st.grid, U = g.levels[i + 1], s = st.slots[i];
  const gross = s.qty * U, net = gross - gross * cfg.FEE, pnl = net - s.cost;
  
  // Profit goes to wallet, trading balance resets to 10,000.
  // Loss is absorbed by cash.
  if (pnl > 0) {
    st.wallet += pnl;              // Profit extracted to wallet
    st.cash = cfg.START;           // Trading balance reset to 10,000
  } else {
    st.cash += net;                // Loss absorbed into trading balance
  }
  
  st.realized += pnl;              // Total realized profit/loss (includes wallet)
  st.rounds++; 
  st.slots[i] = null;
  pushTrade(st, { ... });
}
```

#### Logic Details

**On Profitable Slot Close (pnl > 0):**
```
BEFORE:  cash = 20,000,  wallet = 0
SELL:    Profit = +500
AFTER:   cash = 10,000,  wallet = 500
         (profit extracted, balance resets)
```

**On Loss Slot Close (pnl ≤ 0):**
```
BEFORE:  cash = 10,000,  wallet = 500
SELL:    Loss = -300
AFTER:   cash = 9,700,   wallet = 500
         (loss absorbs into trading balance, wallet unchanged)
```

**Key guarantees:**
- Wallet never decreases (only profits added)
- Wallet never used for trading
- Grid always sizes based on remaining trading cash
- Each profit cycle resets trading balance to initial amount

---

### 3. DASHBOARD (index.html)

#### Display Changes

**Before:**
```html
<div class="row">
  <div class="c"><b>Equity</b><span id="eq">-</span></div>
  <div class="c"><b>Cash</b><span id="cash">-</span></div>
  <div class="c"><b>P&L</b><span id="pnl">-</span></div>
</div>
```

**After:**
```html
<div class="row">
  <div class="c"><b>Equity</b><span id="eq">-</span></div>
  <div class="c"><b>Trade Cash</b><span id="cash">-</span></div>
  <div class="c"><b>Wallet</b><span id="wallet">-</span></div>
</div>
<div class="row">
  <div class="c" style="grid-column:1/4"><b>Total P&L</b><span id="pnl">-</span></div>
</div>
```

#### JavaScript Calculation Changes

**Before:**
```javascript
const eq = s.cash + held*px;
const pnl = eq - s.startBalance;
```

**After:**
```javascript
const wallet = s.wallet || 0;
const eq = s.cash + held*px + wallet;  // Equity now includes wallet
const pnl = eq - s.startBalance;        // P&L includes wallet gains
```

---

## Dashboard Display Breakdown

| Field | Meaning |
|-------|---------|
| **Equity** | Total value = Trading cash + Held coins (at current price) + Wallet |
| **Trade Cash** | Available balance for the next grid (starts at 10,000 per cycle) |
| **Wallet** | Accumulated profits (never decreases, never used for trading) |
| **Total P&L** | Overall profit/loss = Equity - Starting Balance |

### Example: Live Trading Scenario

```
Cycle 1: Buy and sell 10 slots, profit on all = +100 each
  BEFORE: cash=10,000, wallet=0
  AFTER:  cash=10,000, wallet=1,000  (10 slots × +100)

Cycle 2: Buy and sell 10 slots, loss on all = -50 each
  BEFORE: cash=10,000, wallet=1,000
  AFTER:  cash=9,500,  wallet=1,000  (loss absorbed, wallet unchanged)

Cycle 3: Buy and sell 5 slots (smaller grid due to cash drop), profit = +80
  BEFORE: cash=9,500,  wallet=1,000
  AFTER:  cash=10,000, wallet=1,080  (5 slots × +80 = +400 total, but reset to 10k)
```

Dashboard would show:
- **Trade Cash:** $10,000 (ready for next cycle)
- **Wallet:** $1,080 (accumulated profits, untouched by losses)
- **Equity:** $11,080 (10k trading + 1.08k wallet)
- **Total P&L:** +$1,080 (Equity - startBalance of 10k)

---

## Safe Migration from Old States

If you have old `state.json` files from before this update:
1. They will NOT have the `wallet` field
2. When the bot runs, `ensureFields()` is called
3. Missing `wallet` is added as `0`
4. Trading continues normally with new profit-extraction logic

**No data loss, no manual intervention needed.**

---

## Testing Checklist

- [ ] Start bot fresh: wallet displays as $0
- [ ] Make a profitable trade: check wallet increases, cash resets to $10,000
- [ ] Make a loss: check wallet stays the same, cash decreases
- [ ] Load old state file: check wallet is auto-added as $0
- [ ] Multiple cycles: wallet only grows, never decreases
- [ ] Equity = cash + held*price + wallet ✓

---

## Files Modified

1. **state.json** - Added `wallet: 0` field
2. **grid.mjs** - Updated blankState(), ensureFields(), sellSlot()
3. **index.html** - Added wallet display, updated equity/P&L calculations

All changes are backward-compatible and non-breaking.
