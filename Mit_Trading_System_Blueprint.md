# Mit — Two‑Feed Trading System Blueprint (Final Export)
*Generated: 2025-10-23 06:32:26*

This single document captures your streamlined daily workflow, rules, formulas, and dashboard spec for reproducing the assistant you designed (Naked Trader LITE + Quant). Use it with any app, VA, or low‑code tool.

---

## 1) System Overview
- **Capital Base:** ₹200,000  
- **Two Feeds:** (A) **Naked Trader LITE** (fundamentals + light momentum) and (B) **Quant pick** (predictive rules, 3‑month swing).  
- **Frequency:** Weekdays (Mon–Fri), morning run aligned to **08:45 IST**.  
- **Allocation:** **3–5% per position** (default 5% ≈ ₹10,000 per trade).  
- **Risk Guard:** **Hard stop at −6%** from entry (per‑trade).  
- **Constraints:** No sector bans; blended style; **max horizon ≈ 3 months**; swing mgmt via trailing stops near target.

---

## 2) Data Sources & Screening (Naked Trader LITE checklist)
Free sources: **Screener.in**, **Morningstar India**, **Moneycontrol (news)**, exchange filings.

**Checklist:**
1. Rising revenue and EPS over **3–5 years**.  
2. Strong & consistent **free cash flow (FCF)**.  
3. **ROCE > 15%** (or **ROE > 15%** if ROCE unavailable).  
4. Manageable leverage: **Debt/Equity < 0.5** or **Interest Coverage > 3**.  
5. **Improving operating margins (OPM)**.  
6. **Positive/Stable promoter** holding trends; **zero/low pledging**.  
7. **Clean auditor remarks** (no qualifications/red flags).  
8. **Valuation sanity**: **PEG ≤ 1.2** or **P/E below peer median**.

---

## 3) Sentiment & News Overlay
- Cross‑check fresh news: results, large orders, governance updates, broker notes.  
- **Market tone rule:** *risk‑off* ⇒ bias defensives & **narrow buy zones**; *risk‑on* ⇒ allow **momentum breakouts** with **tighter stops**.  
- Avoid new entries if major governance red flags emerge (auditor resignation, promoter pledge surge, SEBI actions).

---

## 4) Output Format (Per Pick)
**Capture the following fields for each idea:**

| Field | What to Log |
|---|---|
| **Ticker** | NSE/BSE code + name |
| **Thesis (2–3 bullets)** | One‑liner reasons tied to checklist |
| **Key Metrics** | ROCE/ROE, EPS growth, OPM, D/E, FCF trend (last 3–5 yrs) |
| **Valuation** | P/E vs peers; PEG if growth data available |
| **Momentum Context** | Price vs 50/200‑DMA, RSI regime (oversold/neutral/overbought) |
| **Risks / Red Flags** | Sector, input costs, governance, demand, policy |
| **Buy Zone** | Price band to accumulate (support or breakout retest) |
| **Initial Stop‑Loss** | 6% below entry or below key support |
| **First Target** | Conservative objective; trail for extensions |
| **Invalidation** | Conditions that cancel the setup |

---

## 5) Simple Scoring Model (Optional 0–100)
- **Quality (40):** ROCE/ROE (15), FCF trend (10), OPM trend (10), D/E or Interest Cover (5).  
- **Growth (20):** 3–5 yr Revenue/EPS CAGR.  
- **Valuation (15):** PEG ≤ 1.2 (10), P/E vs peer median (5).  
- **Momentum (15):** Price > 50 & 200 DMA (10), RSI 45–65 (5).  
- **Governance/Insider (10):** Promoter ↑ or stable; no pledging; clean audit.

---

## 6) Position Sizing & Risk
- **Default size:** **3–5%** of capital per position (use **5% = ₹10,000** unless capital is constrained).  
- **Hard stop:** **−6%** from entry (respect at EOD close or on trigger rule).  
- **Pause rule:** If **cash < 3%** of capital (**₹6,000** at ₹200k), **pause new suggestions**.  
- Max concurrent exposure: keep **deployed ≤ 95%** when volatility rises.

---

## 7) Execution Logic (Buy Zone, Stop, Target, Trailing)
- **Buy Zone:** prefer **pullbacks to rising 50‑DMA** or a **breakout‑retest**; avoid chasing **>15% above 50‑DMA**.  
- **Initial Stop:** **6% below entry** (or **below nearest structural support**, whichever is tighter).  
- **First Target:** typically **12–25%** depending on volatility; once price reaches **75–90% of target** or **RSI > 70**, tighten a **trailing stop** to protect gains.  
- **Invalidation:** two weak quarters (revenue or margin), negative FCF shock, promoter sell‑down, or adverse audit notes.

---

## 8) P&L & Ledger (Auto‑Estimate + Confirm)
**Core formulas:**
- **Allocated Amount** = capital × allocation% (e.g., 0.05).  
- **Units** = floor( allocated_amount / entry_price ).  
- **Unrealized P&L** = units × (CMP − entry_price).  
- **Realized P&L** = Σ (sell_units × (sell_price − entry_price)) − fees.  
- **Trade Drawdown** = (entry_price − min_price_since_entry) / entry_price.  
- **Portfolio Max DD** = max peak‑to‑trough % across equity curve.

**Daily routine:**
1. Auto‑estimate P&L with live CMP; **lock** after you confirm fills or partial sells.  
2. **SELL indicator** when price within 2–3% of target or momentum rolls over; ask for confirmation; update cash.  
3. **Pause suggestions** if cash < 3% threshold; resume after sells free cash.

---

## 9) Mobile Dashboard Spec (One‑Click)
- Single screen; **card UI** with depth & contrasting chips.  
- **Top bar:** Cash %, Deployed %, Equity, Cum. P&L, Max DD, Win‑rate, Avg R:R.  
- **Watchlist:** 2 daily ideas + 1–2 avoid names; each card shows **Buy‑Zone, Stop, Target**; **momentum label** (Above 50/200‑DMA / RSI regime).  
- **Holdings:** symbol • entry • CMP • P&L • bar/arrow (Target hit / Stop hit / Open).  
- **Color chips:** green = gain, red = loss; amber = flat; blue = defensive.

---

## 10) Reporting — Weekly & Monthly
- **Weekly single‑pick post‑mortem:** entry vs stop/target, realized R:R, 6% guard check, factor that worked (fundamental vs momentum), tweak for next week, tiny checklist.  
- **Monthly:** open vs closed positions, cash vs ₹200,000, cumulative P&L, win rate, average R:R realized, max drawdown, **style comparison (NT vs Quant)**.  
- Pause notice if **cash < 3%** allocation threshold; **ask to confirm** any pending sells.

---

## 11) Quant Feed (Ernest P. Chan — Simplified 3‑Month Swing)
**Signal generation (daily):**
- **Universe:** NSE/BSE liquid stocks.  
- **Filters:** same fundamentals as NT LITE to ensure quality base.  
- **Entry rule:** top decile of short‑term momentum (e.g., 20‑day return z‑score) **AND** medium‑term trend (price > 100‑DMA), with a **pullback < 5%** in last 5 sessions.  
- **Risk rule:** 6% stop; **1.5–2.5R** first target; **time exit at 3 months** or if momentum decays (price < 50‑DMA with rising ATR).  
- **Position size:** **3–5%** of capital; cap simultaneous positions to keep deployed ≤ 95%.

---

## 12) Manual Inputs & Memory
- Record confirmed entries (price, date) and sells (qty, price, date).  
- Confirm **P&L locks** daily after close or when authorized.  
- Editable settings: capital, allocation %, guard %, pause threshold %, holding horizon, news sources.

---

## 13) Minimal CSV Schemas (If Export Needed Later)
```
holdings.csv: symbol,feed,entry_price,entry_date,qty,stop,target,status
watchlist.csv: symbol,ticker,thesis,roce,roe,eps_cagr,opm_trend,de_ratio,fcf_trend,pe,peg,buy_zone_low,buy_zone_high,risks
trades.csv: symbol,side,qty,price,date,fees
settings.json: {{ "capital":200000, "alloc_pct":0.05, "stop_pct":0.06, "pause_cash_pct":0.03 }}
```

---

## 14) Final Notes
- This document is **static**; no automations are active.  
- Reuse this blueprint with any assistant or spreadsheet by replicating sections **2–11**.  
- Always verify latest filings, insider changes, and governance before acting.
