# Testing Examples & Scenarios

## Scenario 1: Starting Fresh (New State File)

```
Initial state.json:
{
  "v": 1,
  "kind": "grid",
  "cash": 10000,
  "startBalance": 10000,
  "wallet": 0,        <-- Starts at zero
  "grid": null,
  "slots": [],
  "rounds": 0,
  "realized": 0,
  ...
}

Dashboard display:
[Equity: $10,000] [Trade Cash: $10,000] [Wallet: $0]
[Total P&L: $0]
```

---

## Scenario 2: First Profitable Trade (10-slot Grid, All Profitable)

```
Initial:
  Trading Cash = $10,000
  Wallet = $0
  Each slot gets $1,000 (10k / 10 slots)

Grid created: 10 slots at levels 40,000 to 50,000 BTC price range

Trade sequence:
  Slot 0: Buy at 40,000, Sell at 40,500 → PNL: +$500
    After: wallet=+500, cash=10,000 (reset)
  
  Slot 1: Buy at 40,500, Sell at 41,000 → PNL: +$500
    After: wallet=+1,000, cash=10,000 (reset)
  
  Slot 2: Buy at 41,000, Sell at 41,500 → PNL: +$500
    After: wallet=+1,500, cash=10,000 (reset)
  
  ... (continue for all 10 slots)
  
  Slot 9: Buy at 44,500, Sell at 45,000 → PNL: +$500
    After: wallet=+5,000, cash=10,000 (reset)

Final Dashboard:
[Equity: $15,000]         (10k trade + 5k wallet)
[Trade Cash: $10,000]     (reset after last profit)
[Wallet: $5,000]          (accumulated)
[Total P&L: +$5,000]      (equity - startBalance: 15k - 10k)

Realized: +$5,000
Rounds: 10
```

---

## Scenario 3: Mixed Profitable & Loss Trades (5-slot Grid)

```
Initial:
  Trading Cash = $10,000
  Wallet = $0
  Each slot gets $2,000 (10k / 5 slots)

Trade sequence:
  Slot 0: Buy at 40,000 for $2,000, Sell at 40,500
    Gross: $2,500, Net: $2,500 (0% fee for simplicity)
    PNL: +$500
    After: wallet=+500, cash=10,000 (reset)
  
  Slot 1: Buy at 40,500 for $2,000, Sell at 40,200 (PRICE DOWN!)
    Gross: $2,020 (price dropped), Net: $2,020
    PNL: -$980 (lost money)
    After: wallet=+500 (UNCHANGED), cash=10,000+2,020=$12,020
    └─ Loss absorbed in trading cash
  
  Slot 2: Buy at 40,200 for $2,000, Sell at 40,700
    Gross: $2,512.5, Net: $2,512.5
    PNL: +$512.5
    After: wallet=+1,012.5, cash=10,000 (reset)
  
  Slot 3: Buy at 40,700 for $2,000, Sell at 40,100 (ANOTHER LOSS!)
    Gross: $2,010, Net: $2,010
    PNL: -$990
    After: wallet=+1,012.5 (UNCHANGED), cash=10,000+2,010=$12,010
    └─ Loss absorbed in trading cash
  
  Slot 4: Buy at 40,100 for $2,000, Sell at 40,600
    Gross: $2,512.5, Net: $2,512.5
    PNL: +$512.5
    After: wallet=+1,525, cash=10,000 (reset)

Final Dashboard:
[Equity: $11,525]         (10k trade + 1.525k wallet)
[Trade Cash: $10,000]     (reset after last profit)
[Wallet: $1,525]          (only gained from profits, not affected by losses)
[Total P&L: +$1,525]      (11,525 - 10,000)

Realized: +1,525 (net of all trades: 3×(+500/+512.5) + 2×(-980/-990) = +1,525)
Rounds: 5
Trades: 3 wins, 2 losses
Wallet growing: YES ✓
Wallet shrinking: NO ✓
```

**Key observation:** Even with 2 losing trades, wallet only grew from profits.
No loss affected the wallet.

---

## Scenario 4: Consecutive Losses (Grid Shrinking)

```
Starting:
  Trading Cash = $10,000
  Wallet = $5,000 (from earlier profits)
  New grid: 10 slots × $1,000 each

Trade sequence:
  Slot 0: Loss of -$300
    After: wallet=5,000 (unchanged), cash=$10,000+$1,000-$300=$10,700
    └─ Loss reduced available cash
  
  Slot 1: Loss of -$250
    After: wallet=5,000 (unchanged), cash=$10,700+$1,000-$250=$11,450
  
  Slot 2: Loss of -$400
    After: wallet=5,000 (unchanged), cash=$11,450+$1,000-$400=$12,050
  
  ... continue for all 10 slots, each with small loss
  
  Total losses: -$3,000 (10 slots × -$300 average)
  
Final after this round:
  Trading Cash = $10,000 + $10,000 - $3,000 = $17,000
  Wallet = $5,000 (completely protected)
  
Dashboard:
[Equity: $22,000]         (17k trade + 5k wallet)
[Trade Cash: $17,000]     (increased due to losses being smaller than perSlot)
[Wallet: $5,000]          (protected from losses!)
[Total P&L: +$12,000]     (22k - 10k start)

Observation:
If losses exceed perSlot, cash can drop below $10,000 on next grid.
Next grid will be smaller (cash/10 per slot).
Wallet still protected. ✓
```

---

## Scenario 5: Old State File Migration

```
Old state.json (doesn't have wallet field):
{
  "v": 1,
  "kind": "grid",
  "cash": 8500,
  "startBalance": 10000,
  ❌ No "wallet" field!
  "rounds": 12,
  "realized": 1200,
  ...
}

Bot runs first cycle →
ensureFields(st) is called in liveStep() →
Detects missing "wallet" →
Adds: st.wallet = 0 ✓

New state.json after first cycle:
{
  "v": 1,
  "kind": "grid",
  "cash": 8500,
  "startBalance": 10000,
  "wallet": 0,           ✓ Auto-added!
  "rounds": 12,
  "realized": 1200,
  ...
}

Dashboard safe:
[Equity: $8,500]         (8.5k trade + 0 wallet)
[Trade Cash: $8,500]     (old remaining balance)
[Wallet: $0]             (safe default)

From now on:
- Any profits made go to wallet
- Cash can drop further on losses
- No data lost! ✓
```

---

## Scenario 6: Tracking Across Multiple Cycles

### Cycle 1 (Profitable)
```
Start:   cash=10,000, wallet=0
Trades:  5 slots, all +$150 profit each = +$750
End:     cash=10,000, wallet=750
```

### Cycle 2 (Mixed)
```
Start:   cash=10,000, wallet=750
Trades:  3 wins (+$100 each) = +$300 profit
         2 losses (-$80 each) = -$160 loss
         Net: +$140
End:     cash=10,000, wallet=890
         (lost cash stayed in wallet, losses came from temp balance increase)
```

### Cycle 3 (Heavy Losses)
```
Start:   cash=10,000, wallet=890
Trades:  10 slots, all -$200 loss each = -$2,000
End:     cash=10,000-2,000=8,000, wallet=890
         (wallet completely protected despite $2,000 in losses)
```

### Cycle 4 (Recovery)
```
Start:   cash=8,000, wallet=890
Trades:  8 slots (smaller grid now), all +$150 profit each = +$1,200
End:     cash=10,000 (reset after profit), wallet=2,090
         (cash recovered to 10k, wallet accumulated the recovery)

Dashboard:
[Equity: $12,090]        (10k + 2.09k)
[Trade Cash: $10,000]    (ready for next grid)
[Wallet: $2,090]         (net from all 4 cycles)
[Total P&L: +$2,090]     (all profits preserved!)
```

---

## Edge Case: Zero or Negative Trading Balance

**Scenario:** After many losses, trading cash drops to near zero

```
After losses: cash = $200, wallet = $5,000

Grid attempt:
  Requested 10 slots → $200/10 = $20 per slot (too small)
  
  OR if enough for 1-2 slots:
  Buy slot 1 at price 40,000 → costs $20
  qty = $20 / 40,000 = 0.0005 BTC
  
If this sells profitably:
  Profit = (0.0005 × 40,100) - $20 = $0.05 profit
  
  After: wallet = 5,000.05, cash = 10,000 (reset)
  └─ Even tiny profits reset trading balance!

Safety guaranteed: No division by zero, no negative amounts.
```

---

## How to Verify in Dashboard

| Metric | What to Look For |
|--------|-----------------|
| **Wallet increases** | After profitable trades |
| **Wallet unchanged** | After losing trades |
| **Cash resets to 10k** | After every profitable slot |
| **Cash drops** | After losing slots |
| **Equity = Cash + Held*Price + Wallet** | Should always be true |
| **P&L = Equity - StartBalance** | Should equal wallet + realized from held |
| **Realized = Total of all trade profits** | Should match individual PNL values |

---

## Test Checklist

- [ ] Fresh bot start: wallet = $0
- [ ] First profitable trade: wallet increases, cash resets to $10,000
- [ ] First loss: wallet unchanged, cash decreases
- [ ] Old state file load: wallet auto-added as $0, no errors
- [ ] Multiple cycles: wallet never decreases
- [ ] Large loss: wallet unaffected
- [ ] Grid shrinks on losses: wallet still grows on profits
- [ ] Dashboard equity = cash + held + wallet: Always true
- [ ] Run bot for 1 hour: wallet should only increase or stay same

---

## Expected Dashboard Values Over Time

```
Time:      Cash    Wallet   Held Value   Equity    P&L
Start:     10k     0        0            10k       0
+10min:    10k     500      0            10.5k     +500
+20min:    9.8k    500      200          10k       0
+30min:    10k     950      0            10.95k    +950
+40min:    9.5k    950      400          10.85k    +850
+50min:    10k     1,200    0            11.2k     +1.2k
+60min:    10k     1,500    100          11.6k     +1.6k

Observations:
- Wallet: 0 → 500 → 500 → 950 → 950 → 1,200 → 1,500
  (only increases or stays same) ✓
- Equity: includes wallet, reflects total value ✓
- P&L: always ≥ wallet value ✓
```
