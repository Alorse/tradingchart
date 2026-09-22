# Roadmap

Next features to build, in priority order. Paper Trading is DONE (epic #1,
issues #5–#9, all merged to master — store + fills engine, order panel,
positions / live P&L / TP-SL, history + reset, Supabase sync). This file's job
is to say what is left.

---

## 1. Alerts hardening + webhooks — PARKED, waiting on Fredo's own analysis

Issues **#2 / #3 / #4**. Fredo wants to think through the alerts domain himself
before any of it is touched. Do not start work here unprompted.

What is true about the current behaviour, for when that analysis resumes:

Alerts today are evaluated client-side in `useAlertMonitor`, mounted
per-symbol inside the chart — an alert only fires while its symbol's chart is
open. `src/lib/alerts/` contains only `alert-eval.ts`, `sound.ts` and
`toast-store.ts`: there is NO webhook or Telegram integration anywhere yet.

- **#2 — verify and fix current behaviour first.** Confirm crossing detection,
  the 30s cooldown, sound playback and toast delivery actually fire reliably;
  add tests around `alert-eval.ts` for the cases that are missing. The current
  client-side alerts have still never been QA'd end to end. Then add outbound
  notifications: a Telegram bot integration and a generic webhook `POST` with a
  documented JSON payload (symbol, condition, trigger price, timestamp, alert
  id). Retry with backoff on delivery failure, and a delivery status per
  attempt. Alert history: a persisted log of every firing, visible in the
  alerts panel. Server-side evaluation (so alerts fire with no tab open) is the
  natural follow-on but is deliberately out of scope for this step.
- **#3 — drawing-anchored alerts.** Extend alerts beyond horizontal levels and
  trend lines: rectangle/zone fires on price entering or exiting the zone,
  fibonacci fires on a touch of any selected level in the ladder, Long/Short
  position tool fires when entry, stop or target is reached. The evaluator
  already interpolates sloped drawings to the current bar; this is mostly about
  extending `priceLevelFor` and the alert editing UI per drawing kind. (The
  `alert?: AlertConfig` field in `src/lib/drawings/types.ts` is the pre-existing
  hline/hray alert, not this feature.)
- **#4 — multi-condition alerts.** Combine up to five conditions — price
  levels, indicator values, drawing events — joined with AND, firing once when
  all of them hold simultaneously. Needs a condition-list editor in the alert
  dialog and an evaluator that tracks the satisfied set across ticks rather
  than a single crossing.

## 2. Paper positions panel — deferred follow-ups (#14)

Legacy `feedSymbol` revival, stale-marks eviction, equity selector memo, delta
resubscribe, and the confirm-dialog pattern. Small, self-contained, all flagged
during the PR #39 review.

## 3. Mobile / landscape parity (#32)

Landscaped shipped 2026-09-21: landscape phones now stay in the mobile shell
(the shell predicate is `width < 768 || (coarsePointer && height < 600)`), the
Chart tab hides the bottom nav bar so the chart keeps the height, and the dock
takes over the bottom safe-area inset. Remaining, decide with Fredo:

- Whether the ruler/axis width and font keep tuning as devices get tested.
- The ObjectTreePanel equivalent for mobile (browsing drawings by list — see
  the `TODO` in `MobileDrawingsSheet.tsx`).
- Row density in `MobileTimeframeSheet` is not yet touch-tuned pass-for-pass.

## 4. Drawing price precision at the source

Pixel → price conversion during drag/placement produces unrounded floats that
get stored into drawings. The settings dialog cleans a value once edited there
(`formatPriceInput` / `roundPriceForInput` in `src/lib/format.ts`, per
`references/price-precision.md`), but the chart path does not. Deliberately NOT
fixed for now — the round would have to land in the store's commit path (so
drawings saved to Supabase come out clean too), which Fredo chose to skip.

## 5. Palette + auth polish (from UI audit #23)

The palette migration was phased on stacked branches — `feat/tv-palette-foundation`
(#24), `feat/tv-contrast` (#25), `feat/tv-typography` — and a final polish
stage that never landed: the login rewrite and tokenizing the remaining
hardcoded hex values. Full token table plus the two lightweight-charts v5.2
bugs are in `references/lightweight-charts-pitfalls.md`.

Guest access itself shipped (PR #43): only the chart is viewable without login,
the login is a closable overlay (never a dead-end full screen), and the one
action still gated behind login is SnapshotButton's "Copy image link".

## Documentation debt

- The settings dialog has NO DOM test coverage and will not get any: the repo
  has no jsdom/RTL setup, and Fredo explicitly does not want a DOM test
  framework added just to test dialogs (decided 2026-09-21). Its logic is
  covered through the pure helpers in `src/lib/format.ts` instead.
- Keep THIS file updated as stages land — it had drifted into calling Paper
  Trading "current focus" long after it was complete.
- The README must cite the two upstream repos (KManuS88's
  `tradingview-gratis` + KisuShotto15's `tradingview`) before the repo goes
  public — the fork lineage is unlicensed.
