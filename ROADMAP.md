# Roadmap

Next features to build, in priority order. These are classic TradingView
capabilities the platform does not have yet.

---

## 1. Paper Trading — 🎯 current focus

Simulated trading against live Binance prices. No real funds, no API keys: a
risk-free way to practice the same order flow the live trading panels already
expose.

**Scope**

- Virtual USDT balance, seeded on first use and resettable at any time.
- Market and limit orders, long and short, with configurable leverage.
- Open positions with live unrealized P&L and ROI, driven off the existing
  WebSocket last-price tick.
- TP / SL brackets, reusing the sizing and risk math in
  `src/lib/trading/sizing.ts`.
- Closed-trade history: entry, exit, fees, realized P&L, duration.
- "Reset account" wipes balance, positions and history back to the seed.

**Data model**

Start entirely client-side: a `paper-trading-store.ts` Zustand store,
`persist`ed to localStorage, holding `{ balance, positions, orders, history,
settings }`. Fills are evaluated locally against the live tick — a limit order
fills when the tick crosses its price, a market order fills at the current
quote. Move to a Supabase table (`user_paper_accounts`, one row per user, state
in `JSONB`) once the model settles, so the account follows the user across
devices the way drawings and chart settings already do.

**UI surfaces**

- A Paper / Live toggle at the top of the right sidebar's Trade tab. Paper mode
  swaps the credential-backed order form for the simulated one; the layout stays
  identical so the muscle memory carries over.
- Order panel, positions/orders tables and the chart's order lines reuse the
  existing components, reading from the paper store instead of `trading-store`.
- Balance and equity curve in the account panel.
- A clear visual marker (badge / accent color) whenever paper mode is active, so
  a simulated position is never mistaken for a real one.

---

## 2. Alerts hardening + webhooks

Alerts today are evaluated client-side in `useAlertMonitor`, which is mounted
per-symbol inside the chart — an alert only fires while its symbol's chart is
open.

- **First, verify and fix the current behaviour.** Confirm crossing detection,
  the 30s cooldown, sound playback and toast delivery actually fire reliably;
  add tests around `alert-eval.ts` for the cases that are missing.
- Then add outbound notifications: a Telegram bot integration and a generic
  webhook `POST` with a documented JSON payload (symbol, condition, trigger
  price, timestamp, alert id).
- Retry with backoff on delivery failure, and a delivery status per attempt.
- Alert history: a persisted log of every firing, visible in the alerts panel.

Server-side evaluation (so alerts fire with no tab open) is the natural follow-on
but is deliberately out of scope for this step.

## 3. Drawing-anchored alerts

Extend alerts beyond horizontal levels and trend lines to the rest of the
drawing set:

- Rectangle / zone: fire on price **entering** or **exiting** the zone.
- Fibonacci: fire on a touch of any selected level in the ladder.
- Long / Short position tool: fire when entry, stop or target is reached.

The evaluator already interpolates sloped drawings to the current bar; this is
mostly about extending `priceLevelFor` and the alert editing UI per drawing kind.

## 4. Multi-condition alerts

Combine up to five conditions — price levels, indicator values, drawing events —
joined with AND, firing once when all of them hold simultaneously. Needs a
condition-list editor in the alert dialog and an evaluator that tracks the
satisfied set across ticks rather than a single crossing.
