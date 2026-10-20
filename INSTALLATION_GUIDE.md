# Installation & Deployment Guide

## Files You Need

After this update, you need these three modified files:

1. **grid.mjs** - Trading logic with wallet extraction
2. **index.html** - Dashboard with wallet display
3. **state.json** - (Optional) Contains wallet: 0 if starting fresh

Other files remain unchanged:
- `trade.mjs` ✓ No changes needed
- `index.js` ✓ No changes needed
- `package.json` ✓ No changes needed
- `test.mjs` ✓ No changes needed
- `README.md` ✓ No changes needed

---

## Installation Steps

### Option A: Fresh Installation (New Bot)

1. Download these files from outputs:
   - `grid.mjs` (modified)
   - `index.html` (modified)
   - `state.json` (modified, or create new)

2. Copy them to your bot directory:
   ```bash
   cp grid.mjs /path/to/bot/
   cp index.html /path/to/bot/
   cp state.json /path/to/bot/
   ```

3. Keep your other files unchanged:
   - `trade.mjs`
   - `index.js`
   - `package.json`
   - etc.

4. Test:
   ```bash
   node index.js
   # Should start: "SNIPER dashboard listening on..."
   ```

5. Open dashboard at `http://localhost:3000`
   - Should show: Equity, Trade Cash, Wallet (all $0 initially)

---

### Option B: Existing Installation (Migrating from Old Bot)

1. Backup your current files:
   ```bash
   cp state.json state.json.backup
   cp grid.mjs grid.mjs.backup
   cp index.html index.html.backup
   ```

2. Copy new versions:
   ```bash
   cp grid.mjs /path/to/bot/
   cp index.html /path/to/bot/
   ```

3. **Keep your current state.json** ← Important!
   - Do NOT copy the new state.json
   - Your old state.json will auto-migrate
   - `ensureFields()` will add `wallet: 0` automatically

4. Test:
   ```bash
   node index.js
   # Run first cycle: should auto-add wallet: 0
   # Check state.json: should now have "wallet": 0
   ```

5. Open dashboard
   - Your old cash/balance/rounds are preserved
   - Wallet will show $0 (starting fresh with new feature)
   - From now on, profits go to wallet

---

## Verification After Installation

### 1. Check state.json
```bash
cat state.json | grep wallet
# Should output: "wallet": 0 (or some number if it already ran)
```

### 2. Check dashboard loads
```
Open http://localhost:3000
Should see three top metrics:
  - Equity: $X
  - Trade Cash: $X
  - Wallet: $X
```

### 3. Run one cycle
```bash
# If CYCLE_SECRET is set:
curl -X POST http://localhost:3000/cycle \
  -H "X-Cycle-Secret: your-secret"

# Then check dashboard:
- If trade closed profitable: Wallet increased ✓
- If trade closed loss: Wallet unchanged ✓
```

### 4. Check state.json was updated
```bash
cat state.json | grep -E '"wallet"|"cash"'
# Should show updated values
```

---

## Configuration (No Changes Needed)

Your existing environment variables still work:

```bash
SNIPER_RANGE=0.05           # Still controls grid width
SNIPER_GRIDS=10             # Still controls slot count
SNIPER_FEE=0.0026           # Still controls trading fees
SNIPER_STOP=0.03            # Still controls stop loss
SNIPER_LOWER=0              # Still controls fixed bounds (if set)
SNIPER_UPPER=0              # Still controls fixed bounds (if set)
SNIPER_RECENTER=1           # Still controls auto-recentering
```

New variables: None. The wallet feature requires no configuration.

---

## Rollback (If Needed)

If something goes wrong:

```bash
# Restore old files
cp grid.mjs.backup grid.mjs
cp index.html.backup index.html
# Keep state.json as-is (it still works without wallet field)

node index.js
# Will work as before
# Wallet field in state.json is just ignored if not used
```

---

## Testing Checklist Before Production

After installation, verify:

- [ ] Dashboard loads at http://localhost:3000
- [ ] State.json has `"wallet": 0` (auto-added or created)
- [ ] Bot runs first cycle without errors
- [ ] Dashboard shows all three metrics: Equity, Trade Cash, Wallet
- [ ] Make a test trade (if using paper trading or if you have live market access)
  - Profit: Wallet increases, Cash resets to $10k ✓
  - Loss: Wallet unchanged, Cash decreases ✓
- [ ] Run for 5+ cycles and watch wallet only increase or stay the same
- [ ] Check logs: no new errors, no wallet-related warnings

---

## What Each File Does

### grid.mjs
- **Lines 36-44:** Initializes wallet field in new states
- **Lines 46-51:** Migrates wallet field in old states
- **Lines 83-95:** Moves profits to wallet, resets on gains, absorbs losses
- **Rest:** Unchanged, uses wallet field transparently

### index.html
- **Lines 19-21:** Display layout (Equity, Trade Cash, Wallet)
- **Lines 35-42:** Render function (includes wallet in equity calculation)
- **Rest:** Unchanged, displays wallet as a column like Cash

### state.json
- **Line 6:** `"wallet": 0` field added
- **Rest:** Unchanged, all other fields work as before

---

## Troubleshooting

### Problem: Dashboard shows "Wallet: -" instead of a number

**Cause:** JavaScript is not reading wallet from state.json
**Fix:** 
```javascript
// Check browser console (F12 > Console)
// If you see errors, state.json might be malformed
// Verify: curl http://localhost:3000/state.json
```

### Problem: Wallet shows $0 even after profitable trades

**Cause:** Trades might be closing with losses, not profits
**Fix:**
```javascript
// Check the trades list on dashboard
// Look at "Trades" section: is PNL positive (green)?
// If all trades show negative PNL, that's why wallet is $0
```

### Problem: Old state.json file won't load

**Cause:** Compatibility issue with malformed state
**Fix:**
```bash
# Backup the old one
cp state.json state.json.corrupted

# Create a fresh state
cp state.json.backup state.json
# Or use the new state.json from this package

# Bot will auto-migrate it on next cycle
node trade.mjs
```

### Problem: Cash shows a large number after a loss

**Cause:** Normal behavior! Multiple buys/sells accumulate
**Example:**
```
Start:      cash = 10,000
Buy slot 1: cash = 9,000 (spent 1,000)
Sell slot 1 (loss): cash = 9,900 (got back 900, lost 100)
Sell slot 2 (profit): cash = 10,000 (reset on profit)
```
This is correct. Wallet tracks the extracted profits.

---

## FAQ

**Q: Does the wallet get reset if I restart the bot?**
A: No. Wallet is stored in state.json. Restarts preserve it.

**Q: Can I manually set the wallet amount?**
A: Not recommended, but you can edit state.json's `"wallet"` field.
   The bot won't prevent it. Changes take effect on next cycle.

**Q: What if I have multiple bots (Scalper, Sniper, etc.) using the same state.json?**
A: Don't do this! Each bot should have its own state.json.
   The wallet feature assumes one bot per state file.
   See index.js line 127: "a state file from another bot... start a fresh grid account"

**Q: Does the wallet affect the grid size?**
A: No. Only `cash` (trading balance) affects grid size: `perSlot = cash / numSlots`
   Wallet is never used for sizing.

**Q: Can the wallet go negative?**
A: No. It only increases when profits are extracted. Losses never affect it.

**Q: Does "realized" profit change with this update?**
A: No. Realized is still the sum of all trade profits/losses.
   Wallet just shows how much of that was extracted.

**Q: If I lose all my trading cash, what happens?**
A: Trading balance drops below $10k. Next grid will be smaller.
   But wallet is still there, protecting your accumulated profits.

---

## Support

After installation:

1. Check logs: `node index.js` should run without wallet-related errors
2. Verify state.json: `cat state.json | jq` should show `"wallet": 0`
3. Open dashboard: All three metrics visible
4. Run one test cycle and check wallet/cash values

If all four pass, you're ready to deploy.

---

## Next Steps

1. Deploy these three files to your bot directory
2. Test with one cycle (can be manual via /cycle endpoint if secret is set)
3. Monitor dashboard for 1-2 hours
4. Watch wallet: should only grow, never decrease
5. If losses occur: cash decreases but wallet unchanged ✓

You're done! The wallet feature is now live.
