# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Next.js dev server (http://localhost:3000)
npm run build    # Production build (also runs the full TypeScript type-check)
npm run start    # Serve the production build
npm run lint     # ESLint (eslint.config.mjs, flat config)
npm test         # Unit tests (see below)
npm run test:watch
```

**Tests** run on Node's built-in runner (`node --test`) with **no extra dependencies** — the sandbox has no npm registry access, so Vitest/Jest can't be installed. Node 24 strips TypeScript natively; `test/register.mjs` (loaded via `--import`) registers a resolve hook for the `@/*` alias + extensionless imports and polyfills `localStorage` for Zustand `persist` stores. Assertions use a tiny Jest-style shim at [src/test-utils/expect.ts](src/test-utils/expect.ts) over `node:assert`. Tests live next to the code as `*.test.ts` and cover **pure logic only** (stores, indicators, drawing/alert math, sizing, formatting, symbol/exchange resolution) — no DOM/component rendering. Add a test: create `foo.test.ts` importing from `node:test` + `@/test-utils/expect`.

The `npm test` script bakes in the `src/**/*.test.ts` glob, so to scope a run, invoke node directly:

```bash
# One file
node --import ./test/register.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --test --test-isolation=none src/lib/trading/sizing.test.ts

# One test/suite by name, across the suite
node --import ./test/register.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --test --test-isolation=none --test-name-pattern="slInputToPrice" "src/**/*.test.ts"
```

`--test-isolation=none` is required (Zustand `persist` needs the shared polyfilled `localStorage`).

`next build` runs the full TypeScript type-check (`paths` alias `@/*` → `src/*`). Note **Next 16 removed ESLint from the build** — lint runs only via `npm run lint`, never blocks `next build`. The repo carries pre-existing `react-hooks` lint errors unrelated to most changes; don't treat a red `npm run lint` as a regression without checking whether your files are involved.

Requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` (see `.env.example`). Without them, middleware auth and cloud sync fail. Market data needs no keys; private trading uses per-user keys entered in the UI.

**Note:** The `README.md` predates auth, drawings, and trading — treat this file and the code as the source of truth, not the README.

## Language

- All application UI strings are in **English**.
- Code comments and identifiers in English (consistent with UI).
- Commit messages and PR descriptions in **English** (Conventional Commits).
- README and developer-facing docs are in English too (they were translated from Spanish).

## Architecture

Next.js 16 App Router, React 19, TypeScript, Tailwind 4 + shadcn/ui (Base UI primitives), Zustand for state, Supabase for auth + persistence, `lightweight-charts` v5 for rendering. **Everything client-side** except thin API routes.

### Symbol identity (read this before touching anything symbol-related)

A ticker string carries up to three pieces of meaning, and several bugs have come from conflating them:

- `BTCUSDT` — bare exchange symbol.
- `.P` suffix (`BTCUSDT.P`) — USDT-M **perpetual** rather than spot. `isPerp()`.
- `BYBIT:` prefix (`BYBIT:SOLUSDT.P`) — TradingView-style **exchange qualifier**, so a ticker listed on both venues can be charted from either. [src/lib/symbols/prefix.ts](src/lib/symbols/prefix.ts) is a dependency-free leaf module (imported by both low-level Binance helpers and the resolver, so it must not import them back).

`cleanSym()` in [src/lib/binance/rest.ts](src/lib/binance/rest.ts) strips **both** decorations to get the raw exchange symbol — that's what every exchange API call and every position/order match must use. `resolveSource()` decides which *data provider* serves the chart.

Consequence worth remembering: two different chart symbols (`SOLUSDT.P` and `BYBIT:SOLUSDT.P`) reduce to the same `cleanSym`, so matching an account position by symbol alone is not enough — see "Exchange gating" below.

### Data providers (multi-source)

`resolveSource(symbol)` in [src/lib/symbols/source.ts](src/lib/symbols/source.ts) classifies a ticker, and `fetchCandles()` in [src/lib/data/fetch.ts](src/lib/data/fetch.ts) dispatches on `src.kind`:

- **binance** — spot, or USDT-M perps, via `src/lib/binance/rest.ts` + live WebSocket (`ws.ts`).
- **bybit** — linear USDT perps via `src/lib/bybit/public.ts` (REST klines/tickers/instruments) + `src/lib/bybit/ws.ts` (live klines + tickers). Public data only; no credentials.
- **synthetic** — arithmetic expressions over symbols (spreads/dominance) via `src/lib/binance/synthetic.ts`.
- **yahoo / fred / coingecko** — stocks, indices, macro, market caps, proxied through `src/app/api/{yahoo,fred,coingecko}/route.ts` (these providers block CORS / need keys).

The symbol **catalog** ([src/lib/symbols/catalog.ts](src/lib/symbols/catalog.ts)) has a static half (curated stocks/indices/macro) and a **dynamic registry** populated at runtime: `useBybitSymbols` fetches Bybit's whole perp universe on app load and calls `registerDynamicEntries()` so those tickers resolve and appear in search. `resolveSource` also honours an explicit `BYBIT:` prefix *before* consulting the catalog, so a persisted Bybit symbol charts correctly right after a reload, before the registry has loaded.

When adding a data source: extend `ResolvedSource`, `SourceKind`, and the `switch` in both `resolveSource` and `fetchCandles`. Also give it a mark in `ExchangeLogo`'s `MARKS` map, or its search results fall back to Binance's badge.

Search results (`SymbolSelector.tsx`) render a `SymbolIcon` — the asset's coin icon with the venue's mark pinned to its corner — plus a long-form subtitle. Every `SearchRow` therefore carries a non-optional `description`: catalog entries use theirs, Binance rows get one composed from base/quote/contract type, and the string is matched by the search box too (typing "APPLE" finds AAPL). `CoinIcon`'s `remote` prop must be `false` for anything that isn't a coin — otherwise every stock/macro row fires a 404 at the crypto icon CDN before falling back to its letter avatar.

### Live data

Binance uses one multiplexed WebSocket (`src/lib/binance/ws.ts`) carrying `@kline_<interval>`, `@miniTicker` and `@bookTicker`. Bybit has its own (`src/lib/bybit/ws.ts`) exposing a deliberately **matching `subscribeKline` / `subscribeMiniTickers` shape**, so consumers pick a socket by source kind and otherwise treat them alike. Bybit requires a 20s heartbeat ping and sends ticker *deltas* (only changed fields), so its client retains last price/percent per topic, shared across every subscriber to that symbol. Both reconnect with exponential backoff. Non-crypto sources are REST-poll only.

`BybitWS.tickerSubs` fans a topic out to a **Set of listeners**, not a single callback — Bybit has no separate book-ticker stream, so `BuySellOverlay` reuses `subscribeMiniTickers` for its bid/ask quote on the currently-charted symbol, on top of whatever the watchlist already subscribed for that same symbol (Binance doesn't hit this: its `BuySellOverlay` quote uses `subscribeBookTicker`, a disjoint map). A single-entry map here silently drops whichever subscriber loses the race and orphans the topic when the other one unmounts — the watchlist row for the charted symbol goes stale until something forces a full resubscribe. Keep this fan-out shape if you touch this file; don't collapse it back to one listener per topic.

Bybit's public ticker stream pushes on every trade with no cap, unlike Binance's `@miniTicker`, which the exchange itself throttles to ~once/second — so a volatile Bybit row can emit several ticks a second. `Watchlist.tsx` and `WatchlistScreen.tsx` don't apply raw ticks straight to state; both route through `useBatchedTicks` ([src/hooks/useBatchedTicks.ts](src/hooks/useBatchedTicks.ts)), which coalesces same-symbol ticks arriving within a 150ms window into one `setRows`/`setFlash` flush. This is what keeps the price/flash animation from feeling "violent" compared to Binance rows — the feed itself isn't throttled, only the render rate is, the same trick TradingView's own UI uses. Any new live-tick consumer that renders a list (not a single quote) should go through this hook rather than calling `setState` straight from the WS callback.

### Indicators

Pure TypeScript, computed client-side over the candle array on every update (`src/lib/indicators/`). `index.ts` has the primitives (`sma`, `ema` seeded with SMA, Wilder `rsi`, `macd`, `obv`) plus the Pine-equivalent classics (`bollingerBands`, anchored `vwap`, `stochRsi`, `williamsR`, `atr`, `cci`, `mfi`), all built on the NaN-padded rolling helpers in `helpers.ts` rather than re-slicing the candle array per bar; dedicated files hold the heavier custom studies (`adx.ts`, `squeeze.ts`, `vumanchu.ts`, `keylevels.ts`, `volume-profile.ts`). Add a study: implement the calc, add its key to `IndicatorKey` + `IndicatorConfig`/`DEFAULT_CONFIG` in `chart-store.ts`, wire the toggle/settings dialog, and render its pane/overlay in `PriceChart.tsx`.

**Sub-pane vs overlay.** `SUB_PANE_KEYS` in `chart-store.ts` is the single ordered list of indicators that get their own pane below the price pane; `isSubPaneKey()` goes with it. Three separate places used to hardcode that list (the pane-index walk, the render-time index map, the "collapse all sub-panes" visibility check) and they had already drifted — OBV was in one and missing from the other two, which is why it never got a legend pill. New sub-pane indicators are appended to the *end* of that list on purpose: an existing indicator's pane index only shifts when something earlier in the order is toggled, so the narrow-dep effects for RSI/MACD/ADX/Squeeze/VuManChu stay correct.

**Spec-driven panes.** Stoch RSI, Williams %R, ATR, CCI and MFI are declared as data in [src/lib/indicators/pane-specs.ts](src/lib/indicators/pane-specs.ts) (`SIMPLE_OSCILLATORS`) — lines, colours, guide levels, maths, pill formatter — and one effect in `PriceChart` creates, tears down and updates all of them. Anything that is *N lines over time plus some horizontal guides* belongs there, not in a sixth hand-written copy of the same effect. Indicators needing bespoke rendering (histograms, markers, area fills, an SVG overlay) stay as their own effects.

**Bands.** Bollinger and VWAP draw three `LineSeries` on the main pane, but lightweight-charts has no band series, so the translucent fill between the rails is [BandFillOverlay.tsx](src/components/chart/BandFillOverlay.tsx) — one SVG polygon sampled through `priceToCoordinate`, which is also the only approach that stays correct under a log or inverted price scale. The rails are mirrored into React state (`bbPts`/`vwapPts`) because the overlay needs the raw prices, not just the series.

**Volume Profile (VRVP).** [src/lib/indicators/volume-profile.ts](src/lib/indicators/volume-profile.ts) is pure and tested; [VolumeProfileOverlay.tsx](src/components/chart/VolumeProfileOverlay.tsx) draws it. Two things are easy to get wrong here: a candle's volume is spread across **every** row its high-low range covers, in proportion to the overlap (dumping the whole bar into the row holding its close visibly distorts the profile on high timeframes), and the value area expands from the POC by comparing the *two* rows above against the *two* below, per the Market Profile definition — a greedy single-row walk gives a different band on a twin-peaked profile. Settings mirror TradingView's own panel (`VolumeProfileConfig`): rows layout (count vs ticks-per-row, which needs the symbol's `tickSize`), Up/Down · Total · Delta, value-area %, placement, extended POC, developing POC, width %, opacity. The overlay recomputes off the visible range, and its memo keys on the **last bar's volume** as well as `renderTick` — WS ticks mutate the candle array in place, so neither its identity nor its length changes while the live bar fills.

### State (Zustand stores, `src/lib/store/`)

- `chart-store.ts` — symbol, timeframe, indicators + config, colors/visual settings, watchlists, chart type, right-sidebar tab/width. `persist`ed to localStorage.
- `drawings-store.ts` — all chart drawings (see below).
- `trading-store.ts` — exchange choice, API credentials, orders, positions, balance, order form.
- `alerts-store.ts` — standalone price/RSI/MACD alerts (see "Alerts" below). `persist`ed to localStorage only — unlike drawing-attached alerts, these do **not** sync to Supabase.
- `mobile-store.ts` — mobile sheet/screen navigation.

Watchlist flags live on the item (`flagColor`), and the palette is a dependency-free leaf module ([src/lib/watchlist/flags.ts](src/lib/watchlist/flags.ts)) precisely because `chart-store` needs `DEFAULT_FLAG_COLOR` to seed `lastFlagColor` while both watchlist components need the full list — the store must not import from a component. On desktop the flag is the row's **left** edge: a click toggles it using `lastFlagColor`, a right-click opens the colour picker (and updates `lastFlagColor`). The mark itself is `FlagPennant`, an inline SVG ribbon tag (rounded block, notch bitten out of the right side) rather than lucide's `Flag`, because a stroke-only glyph vanishes in a column barely wider than a scrollbar.
- `replay/replay-store.ts` — bar-replay cursor/playback (session-only, not persisted).

Note `trading-store` keeps **two** position lists: `positions` (scoped to the chart's current symbol, drives the chart overlay and order panel) and `allPositions` (every open position on the account, refreshed regardless of which symbol is charted — used by the watchlist to badge any row, and by the bottom "Trading Account" panel so it isn't blank just because a different symbol is on the chart). `allPositions` is the one actually fetched over the network (`fetchAllPositions`, unscoped `/api/trade/positions`); `positions` is derived from it client-side via `syncPositionsFromAll(symbol)` — no second request. `fetchPositions(symbol)` (a real, scoped fetch) still exists for one-off post-action refreshes (after placing/closing/modifying), just not inside the polling loop.

Cross-cutting hooks are mounted once in [src/components/providers.tsx](src/components/providers.tsx): `useCloudSync`, `useDrawingsSync`, `useKeyboardShortcuts`, `useTradingSync`, `useBybitSymbols`. `useTradingSync` polls `/api/trade/*` every 2s **while the tab is visible** — every route it hits is a real Node.js Vercel Function (Fluid compute bills these), so it pauses entirely on `visibilitychange`/`document.hidden` and resumes with an immediate refresh on foreground, rather than polling a backgrounded tab all day.

**`useTradingSync` is the only account poll in the app — keep it that way.** `PositionsPanel`, `TradeScreen` and `OrderPanel` all read `balance`/`orders`/`allPositions` straight off the store and render whatever the global poll last wrote. Each of those components used to run its *own* 5s interval over the same three endpoints, which silently multiplied the billed invocations (and, unlike `useTradingSync`, kept firing in a backgrounded tab). A panel needing fresher data is not a reason to add an interval — trigger a one-shot `syncAccount(symbol)` after a user action the way `placeOrder`/`closePosition` do.

Every refresh — the poll and the post-action ones alike — goes through **`syncAccount(symbol)`**, one request to `/api/trade/sync` that returns balance + orders + positions together, instead of three requests to the per-resource routes. On Vercel each of those three would also drag the auth middleware along, so the batched route is a 6→2 cut in invocations per tick. The route returns `{ balance, orders, positions }` where each key is `{ data, error }`: the client applies only the slots that succeeded, so one failing read doesn't blank the panels fed by the other two. The single-resource routes still exist (`fetchBalance`/`fetchOrders`/`fetchPositions`) and share their implementation with the batched route via [src/lib/exchanges/account.ts](src/lib/exchanges/account.ts) — don't reimplement exchange logic in a route handler, add it there.

The poll interval is **adaptive**: `POLL_FAST_MS` (2s) whenever the account holds an open position or a working order, `POLL_IDLE_MS` (15s) when it's flat, since nothing can change then without the user acting. It's a self-rescheduling `setTimeout`, not `setInterval`, so the delay is re-evaluated after each tick; a store subscription also re-arms it early when activity appears between ticks.

### Undo/redo (unified history)

`src/lib/history/index.ts` defines a single `UnifiedHistoryStack` (`unifiedHistory`) recording three op kinds: `drawing`, `chartState` (indicator/config/visual changes), and `viewport`. Mutations that should be undoable go through it. Guard against re-recording during replay with `withoutHistory()` / `isApplyingHistory`. Note `src/lib/drawings/history.ts` also exists (drawing-specific); `src/lib/history/` is the newer unified layer.

### Drawing tools

All chart drawings (trendlines, fibs, rays, channels, long/short positions, horizontal/vertical lines, price/date ranges, rectangles, brush) live in `src/lib/drawings/` and `src/components/chart/drawings/`. They are:

- Rendered as an **SVG overlay** on top of lightweight-charts (`DrawingsLayer.tsx`), **not** via the Primitive API.
- Stored in `src/lib/store/drawings-store.ts`.
- Persisted to Supabase table `user_drawings` (one row per drawing, `data JSONB`, `kind` discriminator).
- Mutated only through actions that push to the undo/redo history.

The data model is a **discriminated union** by `kind`. All operations (render, hit-test, drag, serialize) `switch (drawing.kind)`. Coordinate ↔ price/time conversion helpers live in `src/lib/chart/coords.ts` and `snap.ts`; shared drag logic in `use-drag-point.ts` / `use-drag-shape.ts`.

**Magnet.** The snap is two modules on purpose. [src/lib/chart/snap.ts](src/lib/chart/snap.ts) is pure and tested: `snapToOHLC` (nearest candle level) plus `drawingPriceLevels`/`snapToLevels`, which also expose what *other* drawings offer at a given time — fib ladders expanded to prices, a channel's two rails, a trend line interpolated to that bar, a long/short's entry/stop/target. [src/lib/chart/magnet.ts](src/lib/chart/magnet.ts) is the thin store-aware wrapper every UI path actually calls (`magnetSnap`, or `magnetSnapDragging` from a drag handler). Two rules when touching it: filter the store's drawings to the charted symbol (`drawings-store` holds every symbol's), and pass the dragged drawing's id as `excludeId` — a shape that can snap to its own levels sticks to where it started and never moves. New snap call sites go through `magnet.ts`, never `snapToOHLC` directly.

**Style defaults vs templates.** `toolDefaults[kind]` is the single "last style used", applied silently to new drawings; `drawingTemplates[kind]` are named presets applied on demand. Editing a style from `FloatingContextToolbar` merges the touched field into `toolDefaults` as a side effect, which only ever captures that one field — the toolbar's pin button (`SaveAsDefaultButton`) copies the drawing's whole style at once via `styleOf()`, and `clearToolDefault(kind)` (in the templates menu) drops it. `styleOf`'s `STYLE_FIELDS` list is the single definition of "what counts as style"; fib `levels` are in it deliberately, since carrying a customised ladder to the next fib is the point.

### Alerts

Two independent mechanisms feed one evaluator:

- **Drawing-attached alerts** — the `.alert` field on `hline`/`hray`/`trendline`/`ray` drawings, synced to Supabase along with the rest of the drawing (see above).
- **Standalone alerts** (price / RSI / MACD) — `alerts-store.ts`, localStorage-only.

Both are evaluated together in [src/hooks/useAlertMonitor.ts](src/hooks/useAlertMonitor.ts), mounted **per-symbol inside `PriceChart`** (not globally in `providers.tsx`) and driven off the live last-price tick, so an alert only fires while its symbol's chart is open. Crossing detection (`conditionHit`/`priceLevelFor` in `src/lib/alerts/alert-eval.ts`) compares the previous vs current tick; sloped drawings (trend line / ray) are interpolated to the current bar's time so a moving price can cross a projected line. A 30s per-alert cooldown avoids duplicate toasts on a chattering price. Firing pushes to `alerts/toast-store.ts` (rendered by `AlertsToast.tsx`, mounted once in `providers.tsx`) and optionally plays a sound (`alerts/sound.ts`).

### Trading (live Binance + Bybit orders)

The user picks an exchange and enters API key/secret in the UI (`trading-store.ts`, persisted). Everything private goes through `src/app/api/trade/*`, which signs server-side and forwards to the venue. Credentials are passed per-request in the body/query — they are **not** stored server-side.

Each route takes an `exchange` param and dispatches: Binance is signed inline (HMAC-SHA256 over the query string), while Bybit lives in [src/lib/exchanges/bybit.ts](src/lib/exchanges/bybit.ts) (V5 scheme: `HMAC(timestamp + apiKey + recvWindow + payload)` with `X-BAPI-*` headers). That module also holds **pure mappers** normalizing Bybit responses to the shared `Order` / `Position` / `AssetBalance` shapes, which is where its tests live. Adding an exchange means extending `Exchange`, the per-route dispatch, and a mapper module.

Two venue differences leak into the shared model and are easy to get wrong:

- **TP/SL attachment.** Binance always expresses them as separate `reduceOnly` orders. Bybit stores them *on the position* (`takeProfit`/`stopLoss`): `placeOrder()` attaches them directly to a brand-new entry order's `/v5/order/create` call (`bybitPlaceOrder`'s `takeProfit`/`stopLoss` args) so the position gets its native TP/SL from the moment it opens, while editing an *already-open* position's TP/SL goes through the Bybit-only `/api/trade/trading-stop` route (`bybitSetTradingStop`) instead — two different Bybit endpoints for what looks like the same UI action, depending on whether a position exists yet. `Position` carries optional fields for both, and UI prefers the position's own values, falling back to matching reduceOnly orders (always for Binance; for Bybit only orders placed before this native-attach path existed). A position's stop can therefore surface twice (as a position field *and* an order) — the chart overlay deliberately skips orders a position already draws.
- **Hedge mode.** Bybit rejects orders whose `positionIdx` doesn't match the account's position mode (0 one-way, 1 hedge-long, 2 hedge-short). `Position.positionIdx` is plumbed through so TP/SL edits, closes, and new orders send the right index. Inferring hedge mode from *currently open* positions goes blind while flat (no positions ⇒ nothing to inspect) — `bybitIsHedgeMode()` (`/api/trade/position-mode`) queries `/v5/position/list` directly instead, since Bybit keeps returning a hedge-mode symbol's two dormant size-0 rows even with no position open.

A TP/SL's displayed P&L is signed by direction, via `pnlAtExit()` in [src/lib/trading/sizing.ts](src/lib/trading/sizing.ts) — never `Math.abs` plus a fixed sign per bracket kind. A stop trailed past the entry (above it on a long, below on a short) locks in a gain rather than capping a loss, and the number has to say so; the same holds for a target dragged to the wrong side. It takes the **position's** side, not the reduceOnly order's — that one points the other way and inverts every sign.

`Position.percentage` is the true **ROI** (`unrealizedPnl / initialMargin`), not a naive price-delta × leverage estimate — those diverge, and even flip sign, once margin is added or the account is on cross. The chart's entry line intentionally shows *price movement* instead, matching TradingView; the positions table shows the ROI.

**Exchange gating:** account data always comes from the single connected exchange, but the chart may be showing a different venue's symbol. UI that overlays account state (chart order lines, watchlist position badges) must check `resolveSource(symbol).kind === tradingExchange` before rendering, or a Bybit position leaks onto a Binance chart of the same ticker.

Order sizing/risk math is pure and tested in [src/lib/trading/sizing.ts](src/lib/trading/sizing.ts). Canonical state is `qty` (base asset); every other display value is derived. Two distinct concepts share the word "risk" and must not be conflated: `SizingMode.RISK_USD`/`RISK_PCT` size the position *from* a risk budget and the stop distance, whereas `SlMode` only expresses *where* the stop sits (`PRICE` / `PCT_PRICE`). Risk is deliberately not an `SlMode`, since risk-on-both-sides is circular.

Per-symbol tick/lot precision (`pricePrecision`, `stepSize`, `minNotional`, …) comes from `useSymbolInfo()` ([src/lib/trading/symbol-info.ts](src/lib/trading/symbol-info.ts)), a client-cached wrapper around `/api/trade/exchange-info`. Anywhere a price gets rounded — a typed input, a bid/ask click, or a chart-line drag — must use this precision rather than a fixed decimal count: a hardcoded `.toFixed(2)` silently breaks sub-$1 symbols that need more decimals just to move the price at all.

Chart-side trading UI is in `src/components/trading/`. `OrderLinesLayer.tsx` draws entry/TP/SL/liquidation as an SVG overlay **plus** native lightweight-charts price lines — the native ones give the colored price-scale label and span the full pane (so a line continues past the SVG chip toolbar), and they're kept in sync with any in-progress drag so a dragged level doesn't leave a duplicate behind. Position TP/SL edits are two-step: drag → `pending` → explicit Confirm/Discard on the entry line before anything is sent. Right-clicking a position's TP/SL line opens a small menu ("Modify order…" / "Remove") instead — Modify calls `trading-store`'s `openPositionEdit()`, which stashes the position in `editingPosition` and switches the right sidebar / mobile shell to the Trade tab; `OrderPanel` renders `PositionEditPanel` (a typed price + ticks form) in place of the normal order form whenever that's set, so a price can be typed instead of dragged.

A working order's price/quantity can be edited either from the chart (drag its line) or from the Orders table ([src/components/layout/PositionsPanel.tsx](src/components/layout/PositionsPanel.tsx)'s edit popover) — both go through `modifyOrder()`, which cancels and re-posts with the given overrides since neither exchange supports an in-place amend. Leverage lives on the symbol/account, not the order, so editing it from that same popover calls `setLeverage()` separately and affects any future fill on that symbol, not just the order being edited.

### Bar close countdown

The chip counting down to the current bar's close sits on the price axis, under the last-price label — lightweight-charts has no API for annotating the price scale, so `BarCountdown.tsx` is an absolutely-positioned overlay that derives its own geometry the way every other overlay here does: `timeScale().width()` for where the plot ends and the axis begins, `priceToCoordinate(lastPrice)` for the label's y. It reads the last bar off the shared `candlesRef` (WS ticks mutate that array in place, so a 1s re-read always sees the live bar) and is gated on `showBarCountdown`, so the interval isn't paid for when the chip is off.

The close time itself is [src/lib/chart/countdown.ts](src/lib/chart/countdown.ts). `barCloseTime` special-cases `"1M"` with real UTC calendar arithmetic: `timeframeToSeconds("1M")` is a 30-day approximation that's fine for pixel math but would drift the clock by up to a day and a half.

### Chart snapshots

`chart.takeScreenshot()` only paints lightweight-charts' own canvas, so it would
drop every annotation — drawings and order lines are SVG overlays stacked on
top. `composeChartPng()` ([src/lib/chart/snapshot.ts](src/lib/chart/snapshot.ts))
composites the two, scaling the CSS-pixel overlays up to the canvas's
device-pixel size and inlining `var(--token)` colours (serialized SVG leaves the
document, so those would otherwise resolve to black). PriceChart registers the
capture through the same registry pattern as the viewport applier.

Snapshots upload to the **public** `snapshots` Storage bucket
(`supabase/migrations/04_snapshots.sql`) under a `<uid>/` prefix: writes are
owner-only via that prefix, reads are public because the point is a URL that
renders in an external journal. Clipboard image copy hands `ClipboardItem` the
*promise* rather than an awaited blob — Safari drops the user-gesture permission
across an `await`.

### Auth & cloud sync

`src/middleware.ts` (Supabase SSR) gates the whole app: unauthenticated users are redirected to `/login` (except `/login` and `/auth/*`). It checks the session with **`getClaims()`**, which verifies the JWT locally, not `getUser()`, which round-trips to Supabase's auth server on *every* request — at one middleware run per request that round trip dominated the billed wall-clock of the whole app. Any error or exception is treated as unauthenticated, so a failure redirects to `/login` rather than opening the door. On sign-in, `useCloudSync` + `useDrawingsSync` load the user's chart settings, watchlist, and drawings from Supabase, then debounce-save changes back. Supabase clients: `client.ts` (browser), `server.ts` (route handlers / middleware). Schema + RLS policies in `supabase/schema.sql` and `supabase/migrations/`.

The middleware `matcher` is also a **billing** control, not just an auth one: a matched request runs the middleware as its own invocation *before* the CDN cache is consulted, so a matched path can never be served purely from cache however long its `Cache-Control` is. The public data proxies (`/api/yahoo`, `/api/fred`, `/api/coingecko`, `/api/trade/exchange-info`) are therefore excluded from the matcher — they return identical credential-free market data to everyone and set long `Cache-Control` headers so Vercel's CDN answers repeats with no function run at all. `exchange-info` is the one that really matters: it parses a multi-MB Binance `exchangeInfo` document to pluck a single symbol, easily the most CPU-expensive thing in the API surface. Signed `/api/trade/*` routes stay matched on purpose — the session check is what stops the deployment being used as an open exchange proxy. Adding a new public, cacheable proxy route means adding it to the matcher exclusion too, or the cache headers do nothing.

### Responsive shell

`src/app/page.tsx` branches on `useIsMobile()`: desktop renders the full sidebar/panel layout; mobile renders `MobileShell` (bottom-tab screens in `src/components/mobile/`). The dialog components are shared across both.

Mobile screens are being brought to feature parity with their desktop equivalents screen by screen (an ongoing effort — not every screen is there yet). The pattern: call the *same* Zustand store actions desktop uses (no parallel mobile-only state), reserve `mobile-store.ts` for navigation only (current tab, which fullscreen sheet is open), and reuse `MobileSheet` for anything desktop shows in a dropdown/popover/dialog. Only the *interaction* is touch-adapted, not the underlying behavior: desktop's native HTML5 drag-and-drop becomes a `setPointerCapture` + manual hit-testing implementation (touch browsers don't reliably fire `dragstart`/`drop`), and desktop's right-click context menu becomes a long-press (a `pointerdown` timer cancelled on `pointermove` past a small slop or on `pointerup`) opening the same actions in a sheet. A drag handle or a long-press target that sits inside a row with its own tap handler must call `stopPropagation()` on every pointer event it handles (down/move/up/cancel) — pointer capture keeps routing events to it, but they still bubble to the row's handlers unless stopped, so a button tap would otherwise also fire the row's tap-to-open. `WatchlistScreen.tsx` is the fullest example of this pattern so far. `TradeScreen.tsx` goes one step further and imports `matchTpSl`/`EditOrderPopover` directly from the desktop `PositionsPanel.tsx` (both exported for this) rather than reimplementing them — `EditOrderPopover` in particular needed no touch adaptation at all, since it's already a centered modal rather than a hover-dependent popover.

Some desktop-only pieces already work on mobile with zero extra code, because they're mounted inside components mobile already renders unchanged: `FloatingContextToolbar` (per-drawing delete/duplicate/lock/style) and the indicator pill row (hide/remove/settings, including per-instance EMA settings) both live inside `PriceChart.tsx`, which `ChartScreen.tsx` renders as-is; the indicator/chart-settings/drawing-settings/create-alert dialogs are mounted directly in `src/app/page.tsx`'s mobile branch alongside `MobileShell`, "reusing the desktop dialogs" per the comment there. Check for this kind of free reuse before porting a feature — `MobileDrawingsSheet.tsx` and `MobileIndicatorsSheet.tsx` only needed to add the *triggers* (favorite star, magnet/alert/clear rows, "add EMA") that desktop exposes via right-click or a sidebar button mobile has no equivalent gesture for; the tool catalog itself is imported from the desktop-owned `drawing-tools.ts` rather than duplicated, so a tool added there appears on mobile automatically.

Not every desktop panel is safe to reuse as-is, though: `AlertsPanel.tsx`'s edit/delete buttons are hover-revealed (`opacity-0 group-hover:opacity-100`), which never becomes visible on touch, so `MobileAlertsSheet.tsx` reimplements the same two lists (standalone + drawing-attached alerts) with always-visible actions instead of importing the panel directly — check whether a component's interactive affordances *depend* on hover before reusing it wholesale, not just whether its layout would fit. Its "+" (create alert) button calls the same `openAlertDialog()` a desktop right-click on the chart uses; `CreateAlertDialog` itself needed no changes since it's a centered modal, not a hover-dependent popover, and mobile's `page.tsx` branch already mounts it. Desktop's `ChartTypeSelector` and `SnapshotButton`, by contrast, *are* directly reusable — they're built on the shared `DropdownMenu` primitive (Base UI, tap-triggered and portal-rendered, so it doesn't clip against `ChartScreen.tsx`'s horizontally-scrolling toolbar) — `ChartScreen.tsx` imports both as-is. `TimeframeSelector` is the opposite case again: a hand-rolled `absolute`-positioned dropdown with its own hover-revealed favorite star, so `MobileTimeframeSheet.tsx` reimplements it as a fullscreen list instead. The lesson each time: check whether the desktop piece is built on the shared portal-based `DropdownMenu`/dialog primitives (safe to reuse) versus hand-rolled positioning or hover-only affordances (needs a mobile-specific rebuild) — don't assume either way from layout alone.

Known remaining gap: there's no mobile equivalent of the desktop "Objects" tab (`ObjectTreePanel.tsx`) for browsing/managing drawings as a list rather than tapping them on the canvas.

### Typography

The app leans heavily on very small arbitrary text sizes (`text-[9px]`…`text-[12px]`). [src/app/globals.css](src/app/globals.css) overrides these **globally**, enforcing an 11px floor, and also raises Tailwind's `--text-xs`/`--text-sm` tokens. The overrides are declared *unlayered* (outside `@layer`) so they beat Tailwind's generated utilities regardless of source order. So a `text-[10px]` in a component does not render at 10px — change the sizing scale there, not per-component, and verify against the compiled CSS.

SVG overlays (chart drawings, order lines) size text with the numeric `fontSize` attribute instead, which those CSS rules do **not** affect — they must be adjusted in the components themselves.

## Keyboard shortcuts

Centralized in `src/hooks/useKeyboardShortcuts.ts`. The chart-level handler is global (`window`), guarded against input elements.

| Key | Action |
|---|---|
| `Esc` | Cancel current placement → reset tool → deselect |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Del` / `Backspace` | Delete selected drawing |
| `←` `→` `↑` `↓` | Nudge selected drawing (`Shift` = 10x) |

Mouse gestures on the chart live in `PriceChart.tsx`'s own `dblclick` handler rather than that hook. Double-click resolves in priority order: an EMA or key-level line within a few pixels opens its settings; a sub-pane opens its indicator's settings; otherwise, on **empty main-pane background with nothing selected and no placement in flight**, it collapses/restores the indicator sub-panes (`subPanesHidden`), the way TradingView maximizes the price pane. The "nothing selected" guard is what keeps a double-click that was really a deselect from silently hiding every study, and the handler ignores clicks past `timeScale().width()` so lightweight-charts keeps its own double-click-to-reset behaviour on the price scale.

Arrow nudging translates via the pure `translateDrawing()` (`src/lib/drawings/translate.ts`) and follows the drag convention — `updateLive` per keypress, one `commit` once the run settles — so holding a key doesn't spam history or the cloud. Vertical steps are one screen pixel, which the hook gets from a probe `PriceChart` registers in `src/lib/chart/nudge.ts` (same registry pattern as the viewport applier), since only the live chart knows the price-per-pixel scale.
