# File Manifest - Wallet Feature Package

## Contents (13 Files)

### ✓ REPLACE THESE (3 Files - Your Current Bot)

```
grid.mjs              [9.8 KB]  ← CORE TRADING LOGIC
├─ Line 36-44: blankState() - init wallet: 0
├─ Line 46-51: ensureFields() - migrate wallet from old states  
├─ Line 83-95: sellSlot() - profit extraction to wallet
└─ rest: unchanged

index.html            [9.9 KB]  ← DASHBOARD UI
├─ Line 19-21: HTML layout (Equity, Trade Cash, Wallet, P&L)
├─ Line 40-42: render() function (include wallet in calculations)
└─ rest: unchanged

state.json            [433 B]   ← INITIAL STATE
├─ Line 6: "wallet": 0
└─ rest: unchanged
```

### ✓ REFERENCE (5 Files - Documentation)

```
README.md             [8.4 KB]  ← START HERE
├─ What was added
├─ Quick start
├─ How it works
└─ FAQ

WALLET_CHANGES.md     [6.3 KB]  ← TECHNICAL OVERVIEW
├─ What changed in state/logic
├─ How profit extraction works
├─ Safe migration explanation

CODE_CHANGES_DETAILED.md [7.9 KB] ← LINE-BY-LINE COMPARISON
├─ Before/after for each file
├─ Detailed logic explanation
└─ Verification checklist

TESTING_EXAMPLES.md   [8.3 KB]  ← REAL SCENARIOS
├─ Scenario 1: Fresh start
├─ Scenario 2: All profitable trades
├─ Scenario 3: Mixed wins/losses
├─ Scenario 4: Recovery from losses
├─ Scenario 5: Old state migration
├─ Scenario 6: Multi-cycle tracking

SYSTEM_DIAGRAM.md     [11 KB]   ← VISUAL ARCHITECTURE
├─ State flow diagrams
├─ Decision trees
├─ Ledger accounting examples
└─ Rule verification

INSTALLATION_GUIDE.md [7.9 KB]  ← DEPLOYMENT STEPS
├─ Fresh install vs existing bot
├─ Configuration (no changes needed)
├─ Rollback procedure
├─ Troubleshooting

QUICK_REFERENCE.txt   [5.5 KB]  ← ONE-PAGE CHEAT SHEET
├─ Exact line numbers for changes
├─ Before/after code snippets
├─ Expected results checklist
└─ Rollback instructions

FILE_MANIFEST.md      [this]    ← YOU ARE HERE
└─ What each file contains and how to use it
```

### ✓ REFERENCE (5 Files - Complete Bot)

```
trade.mjs             [9.6 KB]  ← NO CHANGES
├─ Included for completeness
└─ Use your current version (will work as-is)

index.js              [4.9 KB]  ← NO CHANGES
├─ Included for completeness
└─ Use your current version (will work as-is)

package.json          [392 B]   ← NO CHANGES
├─ Included for completeness
└─ Use your current version (will work as-is)
```

---

## How to Use This Package

### Step 1: Read README.md
**Time: 5 minutes**
- Get overview of wallet feature
- Understand the three key rules
- See how it works with examples

### Step 2: Choose Your Path

#### Path A: I want to install immediately
1. Read QUICK_REFERENCE.txt (cheat sheet)
2. Replace three files: grid.mjs, index.html, state.json
3. Follow INSTALLATION_GUIDE.md "Option A"
4. Test using checklist at end of QUICK_REFERENCE.txt

#### Path B: I want to understand first
1. Read WALLET_CHANGES.md (what changed)
2. Read CODE_CHANGES_DETAILED.md (line-by-line)
3. Read SYSTEM_DIAGRAM.md (visual architecture)
4. Then follow Path A for installation

#### Path C: I'm upgrading existing bot
1. Read INSTALLATION_GUIDE.md "Option B" (migration)
2. Read TESTING_EXAMPLES.md "Scenario 5" (old state migration)
3. Follow the upgrade steps carefully
4. Run tests to verify

#### Path D: I want real examples
1. Read TESTING_EXAMPLES.md
2. Follow the scenarios with numbers
3. Understand expected behavior in each case
4. Then install

### Step 3: Install
Using one of the guides above, replace your three files:
- Copy new `grid.mjs` to your bot directory
- Copy new `index.html` to your bot directory
- Copy new `state.json` (or let bot auto-migrate old one)

### Step 4: Test
```bash
node index.js
# Open http://localhost:3000
# Run one cycle and verify:
#   - Profitable trade: wallet increases, cash resets to 10k
#   - Loss trade: wallet unchanged, cash decreases
```

### Step 5: Monitor
Run for 1-2 hours and verify:
- [ ] Wallet monotonically increases (never decreases)
- [ ] Dashboard shows all three metrics
- [ ] No errors in logs
- [ ] State.json updates properly

---

## Document Guide

### For Different Readers

#### "I just want to install it"
→ Read: QUICK_REFERENCE.txt + INSTALLATION_GUIDE.md

#### "I want to understand what changed"
→ Read: WALLET_CHANGES.md + CODE_CHANGES_DETAILED.md

#### "I'm a visual learner"
→ Read: SYSTEM_DIAGRAM.md + TESTING_EXAMPLES.md

#### "I'm upgrading from old bot"
→ Read: INSTALLATION_GUIDE.md (Option B) + TESTING_EXAMPLES.md (Scenario 5)

#### "I need troubleshooting"
→ Read: INSTALLATION_GUIDE.md (Troubleshooting) + README.md (FAQ)

#### "I want everything"
→ Read in order: README → WALLET_CHANGES → CODE_CHANGES → SYSTEM_DIAGRAM → TESTING_EXAMPLES → INSTALLATION_GUIDE

---

## File Comparison Matrix

| File | Modified? | Replace? | Read? | Understand? |
|------|-----------|----------|-------|-------------|
| grid.mjs | YES | YES | Installation guide | Code_changes_detailed |
| index.html | YES | YES | Installation guide | Code_changes_detailed |
| state.json | YES | NO* | Installation guide | Wallet_changes |
| trade.mjs | NO | NO | Completeness only | N/A |
| index.js | NO | NO | Completeness only | N/A |
| package.json | NO | NO | Completeness only | N/A |

*state.json: Use yours if upgrading; use new one if fresh install; bot will auto-migrate old ones

---

## Size Summary

| Category | Size | Count |
|----------|------|-------|
| Code files | 29.3 KB | 3 |
| Documentation | 64.3 KB | 7 |
| Reference files | 14.8 KB | 3 |
| **Total** | **108.4 KB** | **13** |

---

## Verification Checklist

After extracting this package:

- [ ] README.md exists and explains wallet feature
- [ ] QUICK_REFERENCE.txt has exact line numbers
- [ ] grid.mjs is 9.8 KB (modified)
- [ ] index.html is 9.9 KB (modified)
- [ ] state.json has `"wallet": 0`
- [ ] trade.mjs, index.js, package.json unchanged
- [ ] All documentation files present (7 .md + 1 .txt)
- [ ] No missing files

---

## Quick File Lookup

**Q: Where are the code changes?**
A: grid.mjs (3 locations), index.html (2 locations), state.json (1 location)

**Q: How do I install?**
A: INSTALLATION_GUIDE.md or QUICK_REFERENCE.txt

**Q: What if something breaks?**
A: INSTALLATION_GUIDE.md troubleshooting section

**Q: Show me the logic?**
A: CODE_CHANGES_DETAILED.md or SYSTEM_DIAGRAM.md

**Q: Real examples?**
A: TESTING_EXAMPLES.md

**Q: Quick overview?**
A: README.md (5 min read)

**Q: Step-by-step?**
A: QUICK_REFERENCE.txt (1 page)

**Q: Deep dive?**
A: WALLET_CHANGES.md + CODE_CHANGES_DETAILED.md + SYSTEM_DIAGRAM.md

---

## Installation Summary

```
Your current bot:
  grid.mjs  ← Replace
  index.html ← Replace
  state.json ← Keep (auto-migrates) OR replace if fresh
  trade.mjs ← Keep
  index.js ← Keep
  package.json ← Keep

After installation:
  Dashboard shows: Equity | Trade Cash | Wallet | Total P&L
  Wallet behavior: only increases, never decreases
  Profits: extracted to wallet, trading balance reset
  Losses: absorbed by trading balance, wallet unchanged
```

---

## Document Dependency Graph

```
README.md (start here)
  ├─ Want code details?
  │  └─ CODE_CHANGES_DETAILED.md
  │     ├─ Want visuals?
  │     │  └─ SYSTEM_DIAGRAM.md
  │     └─ Want to install?
  │        └─ INSTALLATION_GUIDE.md
  │
  ├─ Want examples?
  │  └─ TESTING_EXAMPLES.md
  │     └─ Want to install?
  │        └─ INSTALLATION_GUIDE.md
  │
  ├─ Ready to install?
  │  ├─ Fresh bot?
  │  │  └─ INSTALLATION_GUIDE.md (Option A)
  │  │     └─ QUICK_REFERENCE.txt (cheat sheet)
  │  │
  │  └─ Upgrading?
  │     └─ INSTALLATION_GUIDE.md (Option B)
  │        └─ TESTING_EXAMPLES.md (Scenario 5)
  │
  └─ Something broke?
     └─ INSTALLATION_GUIDE.md (Troubleshooting)
```

---

## Using These Files

### Option 1: Keep in Git Repository
```bash
git clone <this>
git add *.mjs *.html *.json
git add *.md *.txt
git commit -m "Add wallet feature"
```

### Option 2: Deploy Directly
```bash
cp grid.mjs /prod/bot/
cp index.html /prod/bot/
# state.json auto-migrates, don't copy
```

### Option 3: Read Documentation First
1. Download/extract all files
2. Read README.md, WALLET_CHANGES.md
3. Decide on timeline for deployment
4. Plan installation using INSTALLATION_GUIDE.md
5. Execute deployment

### Option 4: Test in Staging
```bash
# Set up staging bot with new files
cp *.mjs *.html *.json /staging/bot/
cd /staging/bot
node index.js
# Test for 1 hour
# Verify wallet behavior
# If good, deploy to production
```

---

## Final Checklist Before Deployment

- [ ] Downloaded all 13 files
- [ ] Read README.md
- [ ] Chose installation path (A, B, C, or D)
- [ ] Backed up current grid.mjs
- [ ] Backed up current index.html
- [ ] Backed up current state.json
- [ ] Copied new grid.mjs to bot
- [ ] Copied new index.html to bot
- [ ] (Optionally) copied new state.json to bot
- [ ] Started bot: `node index.js`
- [ ] Opened dashboard: http://localhost:3000
- [ ] Ran first cycle manually or waited
- [ ] Verified wallet shows as $0 or higher
- [ ] Ran for 30+ minutes
- [ ] Checked wallet only increased (never decreased)
- [ ] No errors in logs

Ready to deploy! ✓

---

**Package Version:** 1.0
**Last Updated:** October 5, 2026
**Status:** Ready for production
