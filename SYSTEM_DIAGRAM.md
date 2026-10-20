# Wallet System - Visual Architecture

## State Structure

```
state.json (file on disk)
└── {
    "v": 1,
    "kind": "grid",
    "cash": 10000,              ← Trading balance (used for buying)
    "startBalance": 10000,      ← Initial amount (for P&L calculation)
    "wallet": 0,                ← Accumulated profits (NEW)
    "realized": 1000,           ← Total profit/loss from all trades
    "grid": { ... },
    "slots": [ ... ],
    "trades": [ ... ],
    ...
}
```

### Field Meanings

| Field | Used For | Changes When |
|-------|----------|--------------|
| `cash` | Buying power | Every buy/sell, reset to 10k on profit |
| `wallet` | Profit vault | Only increases (when pnl > 0) |
| `realized` | P&L tracking | Every trade closes (buy+sell) |
| `startBalance` | Baseline | Never changes (set at init) |

---

## Trade Lifecycle

### Old System (Before This Update)

```
Buy Slot #0
  cash = 10,000 - 1,000 = 9,000

Sell Slot #0 (Profit +$100)
  cash = 9,000 + 1,100 = 10,100
  realized = 0 + 100 = 100
  
Sell Slot #1 (Loss -$100)
  cash = 10,100 + 900 = 11,000
  realized = 100 - 100 = 0
  
Problem: Cash fluctuates, hard to track pure profit extraction
```

### New System (With Wallet)

```
Buy Slot #0
  cash = 10,000 - 1,000 = 9,000
  wallet = 0

Sell Slot #0 (Profit +$100)
  pnl = +100 > 0 ✓
  wallet = 0 + 100 = 100  ← Profit extracted!
  cash = 10,000           ← Reset for next round
  realized = 0 + 100 = 100
  
Sell Slot #1 (Loss -$100)
  pnl = -100 ≤ 0
  wallet = 100            ← Unchanged! Protected!
  cash = 10,000 + 900 = 10,900  ← Loss absorbed
  realized = 100 - 100 = 0

Benefit: Wallet tracks extracted profit cleanly
```

---

## Decision Tree: Profit vs Loss

```
Trade closes (slot sells)
│
├─ Calculate: pnl = (sell_proceeds) - (buy_cost)
│
├─ Is pnl > 0?
│  │
│  ├─ YES (Profitable)
│  │  │
│  │  ├─ wallet += pnl          (extract profit)
│  │  ├─ cash = 10,000          (reset trading balance)
│  │  ├─ realized += pnl        (update total)
│  │  └─ Grid continues at full strength next round
│  │
│  └─ NO (Loss or breakeven)
│     │
│     ├─ cash += net_proceeds    (absorb loss into balance)
│     ├─ wallet unchanged        (protected!)
│     ├─ realized += pnl         (update total)
│     └─ Grid may shrink next round if cash < 10,000
```

---

## Dashboard Equity Calculation

```
                    ┌─────────────────────────┐
                    │   state.json (live)      │
                    ├─────────────────────────┤
                    │ cash: X                 │
                    │ wallet: Y               │
                    │ slots: [...]            │
                    │ price: Z                │
                    └─────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
              render() JavaScript    (on dashboard load)
                    │                   │
        ┌───────────┴───────────┐       │
        │                       │       │
    Calculate Held:        Calculate Equity:
    held_qty = sum           equity = cash +
      of all qty               (held × price) +
      in slots                 wallet
        │                       │
        └───────────┬───────────┘
                    │
          ┌─────────┴──────────┐
          │                    │
      Display:            Calculate P&L:
      Equity:           pnl = equity -
      $X.XX             startBalance


  Example:
  ────────
  cash = $10,000
  held qty = 0.25 BTC
  price = $44,000
  wallet = $2,000
  
  equity = 10,000 + (0.25 × 44,000) + 2,000
         = 10,000 + 11,000 + 2,000
         = $23,000
  
  pnl = 23,000 - 10,000 (startBalance)
      = +$13,000
```

---

## Multi-Cycle Wallet Growth

```
Cycle 1: 10 slots, all +$50
┌────────────────────────────┐
│ Before: wallet=0, cash=10k │
│ Trades: S0(+50), S1(+50)...│
│ Each profit: wallet++      │
│ After:  wallet=500, cash=10k
└────────────────────────────┘
              │
              ▼
Cycle 2: 10 slots, mixed
┌────────────────────────────────┐
│ Before: wallet=500, cash=10k   │
│ Trades: S0(+60), S1(-30),      │
│         S2(+60), S3(-20)...    │
│ Results: wallet=700, cash=9960 │
│ (profit extracted, loss absorbed)
└────────────────────────────────┘
              │
              ▼
Cycle 3: 9 slots (smaller, cash < 10k)
┌──────────────────────────────────┐
│ Before: wallet=700, cash=9960    │
│ Grid: perSlot = 9960/9 = $1,107  │
│ (smaller than the normal $1,111)  │
│ After:  wallet=850, cash=9960    │
│ (still trading, wallet growing)   │
└──────────────────────────────────┘
              │
              ▼
Cycle 4: 8 slots (smaller)
┌──────────────────────────────┐
│ Profitable round:             │
│ wallet=1,050, cash=10,000    │
│ (cash recovered to 10k!)     │
│ Next grid: back to 10 slots  │
│ perSlot = 1,000 again        │
└──────────────────────────────┘

Key: wallet = 0 → 500 → 700 → 850 → 1,050
     (always up, never down)
```

---

## Cash vs Wallet Flow Chart

```
START
  │
  ├─ cash = 10,000
  ├─ wallet = 0
  │
  ▼
CREATE GRID (10 slots)
  │
  ├─ perSlot = 10,000 / 10 = $1,000
  │
  ▼
SLOT #0
  │
  ├─ BUY: cash -= 1,000  →  cash = 9,000
  │
  ├─ SELL (profit +$150)
  │  │
  │  ├─ pnl = +150 > 0 ✓
  │  │
  │  ├─ wallet += 150  →  wallet = 150
  │  ├─ cash = 10,000  →  cash = 10,000 (reset)
  │  │
  │  └─ Dashboard: Trade Cash=$10k, Wallet=$150k
  │
  ▼
SLOT #1
  │
  ├─ BUY: cash -= 1,000  →  cash = 9,000
  │
  ├─ SELL (loss -$80)
  │  │
  │  ├─ pnl = -80 ≤ 0
  │  │
  │  ├─ wallet = 150  (UNCHANGED, protected!)
  │  ├─ cash += 920   →  cash = 9,920
  │  │
  │  └─ Dashboard: Trade Cash=$9.92k, Wallet=$150
  │
  ▼
SLOT #2
  │
  ├─ BUY: cash -= 1,000  →  cash = 8,920
  │
  ├─ SELL (profit +$200)
  │  │
  │  ├─ pnl = +200 > 0 ✓
  │  │
  │  ├─ wallet += 200  →  wallet = 350
  │  ├─ cash = 10,000  →  cash = 10,000
  │  │
  │  └─ Dashboard: Trade Cash=$10k, Wallet=$350
  │
  ▼
... continue for all slots ...
```

---

## State Transitions

```
Transaction: Sell a slot with profit

Before:                After:
┌──────────────┐      ┌──────────────┐
│ cash: 9,000  │      │ cash: 10,000 │
│ wallet: 500  │  →   │ wallet: 550  │
│ realized: 50 │      │ realized: 100│
└──────────────┘      └──────────────┘

Action:
  if (pnl > 0) {
    wallet += 50;
    cash = 10,000;
  }

Transaction: Sell a slot with loss

Before:                After:
┌──────────────┐      ┌──────────────┐
│ cash: 10,000 │      │ cash: 9,850  │
│ wallet: 550  │  →   │ wallet: 550  │
│ realized: 100│      │ realized: 50 │
└──────────────┘      └──────────────┘

Action:
  else {
    cash += 9,850;  // proceeds = 9,850
  }
```

---

## Protection Guarantee

```
Loss Protection Proof

Claim: Wallet never decreases on losses
Proof: sellSlot() has no code path that decreases wallet

Code paths:
  1. if (pnl > 0):
     wallet += pnl
     ↑ Increases wallet only
  
  2. else (pnl ≤ 0):
     st.cash += net
     ↑ No mention of wallet
     ↑ Wallet unchanged
  
  ∴ Wallet only increases (pnl > 0) or stays same (pnl ≤ 0)
  ∴ No code path can decrease wallet
  ∴ Protection is guaranteed ✓

Edge cases:
  - pnl = 0 (breakeven): else branch, wallet unchanged ✓
  - pnl = -1e-8 (rounding): else branch, wallet unchanged ✓
  - Very small profit (1e-8): if branch, wallet += tiny amount ✓
```

---

## Equity Ledger (Double-Entry Accounting)

```
Equity components track where value lives:

Initial: Equity = 10,000 (all in cash for trading)
         ├─ Trading Cash: 10,000
         ├─ Held coins: 0
         └─ Wallet: 0

After Cycle 1 (profit):
Equity = 10,000 (no change in total)
         ├─ Trading Cash: 10,000 (reset)
         ├─ Held coins: 0
         └─ Wallet: +500 (profit extracted)

After Cycle 2 (loss):
Equity = 9,900 (total decreased)
         ├─ Trading Cash: 9,900 (absorbs loss)
         ├─ Held coins: 0
         └─ Wallet: +500 (untouched)

After Cycle 3 (profit recovery):
Equity = 10,200 (total recovered + gain)
         ├─ Trading Cash: 10,000 (reset on profit)
         ├─ Held coins: 0
         └─ Wallet: +700 (accumulated profits)

Key insight: Total Equity = sum of three components
             Losses hit cash, profits extracted to wallet
             Wallet = pure profit accumulation
```

---

## Rule Verification

```
Rule 1: Wallet never used for trading
  ✓ Verified: No "cash -= wallet" or "perSlot = wallet"
  ✓ Grid sizing: perSlot = cash / numSlots (cash only)
  ✓ Buys: cash -= spend (cash only)

Rule 2: Wallet never decreases
  ✓ Verified: Only line is "st.wallet += pnl" (pnl > 0 only)
  ✓ No "wallet -= X" anywhere in code
  ✓ else branch: wallet unchanged

Rule 3: Trading balance resets to 10,000 on profits
  ✓ Verified: "st.cash = cfg.START" (10,000 by default)
  ✓ Only happens when pnl > 0
  ✓ If pnl ≤ 0: no reset, cash = cash + proceeds

Rule 4: Losses absorbed by trading balance
  ✓ Verified: "st.cash += net" in else branch
  ✓ net < cost when loss occurs
  ✓ Result: cash decreases

Rule 5: Wallet displayed on dashboard
  ✓ Verified: HTML has <span id="wallet">
  ✓ JavaScript: $('wallet').textContent=f(wallet)
  ✓ Calculation: wallet=s.wallet||0

All rules enforced by code ✓
```
