Verified the essentials directly. Here is the report.

---

# Code audit — TradingView App

## 1. Executive summary

The code is, on the whole, well built: zero `any` in the critical financial paths, zero outstanding TODO/FIXMEs, middleware that fails closed, no SSRF in the four public proxies, no hardcoded secrets and no `service_role` leak, and most of the invariants CLAUDE.md documents (read gating, `snapToOHLC`, `SUB_PANE_KEYS`, `useBatchedTicks`, UTC handling, Volume Profile, `pnlAtExit`, real ROI) hold up when verified against the current code.

The problem is not in the architecture but in the **error handling of the order execution path** and in a **gating hole on the write path**. There are three defects that can cost real money: TP/SL orders that fail silently, leaving leveraged positions unprotected; `modifyOrder`, which can cancel an order and fail to replace it on hedge accounts; and orders routed to the connected exchange without checking that the charted symbol belongs to that venue. On top of that, exchange credentials travel as a query string on a poll every 2 seconds.

---

## 2. Security (critical)

### 2.1 Hardcoded secrets — no findings

There are no exchange credentials or `service_role` keys in the code. Only `.env.example` is committed, and `.gitignore` correctly excludes `.env*`. The only variables exposed to the client are the expected `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` pair (`src/lib/supabase/client.ts:5-6`, `src/lib/supabase/server.ts:7-8`, `src/middleware.ts:8-9`). **Correct.**

### 2.2 Exchange keys: storage and transport

**Critical — `apiKey` and `apiSecret` in localStorage, unencrypted.** `src/lib/store/trading-store.ts:739-742`: `partialize` explicitly includes both fields, so zustand writes them as plain JSON under the `"trading-store"` key. Any XSS, browser extension or access to the local profile reads live trading credentials with a single `localStorage.getItem("trading-store")`. The UI states it ("Keys are stored locally in your browser", `src/components/trading/ApiKeyDialog.tsx:186-187`), so it looks like a conscious decision, but it remains the app's highest-impact secrets risk: if the key has withdrawal permission, the blast radius is the entire account.

**High — credentials sent in the GET query string.** Every account read sends `apiKey`/`apiSecret` in the URL, not in the body:

- `src/lib/store/trading-store.ts:256-264` (`fetchBalance`), `:278-287` (`fetchOrders`), `:300-308` / `:329-336` (positions), `:364-373` (`syncAccount`), `:415-418` (position-mode)
- `src/components/trading/ApiKeyDialog.tsx:26-34` (connection test)
- Server side: `src/lib/exchanges/account.ts:253-265` (`readAccountParams` reads from `url.searchParams`), consumed in `src/app/api/trade/{balance,orders,positions,sync}/route.ts` and `position-mode/route.ts:9-10`

`syncAccount` runs every 2 seconds, so the key and secret end up written in plain text into Vercel's access logs, any intermediate proxy and the browser history, continuously for the whole session. The routes that **mutate** (order, leverage, trading-stop, close) do use a POST body (`trading-store.ts:459-463, 521-525, 574-578, 602-613, 639-646, 682-692, 719-723`) — the problem is exclusive to the read side, which is precisely the highest-frequency one.

**No findings:** no route returns the credentials in its response, nor logs them.

### 2.3 API routes

**Auth: correct today, but single-layered.** None of the 12 routes under `src/app/api/**/route.ts` verifies the session on its own (grepping `getClaims|getUser` under `src/app/api` returns nothing). Everything depends on `src/middleware.ts:35-41`, which does fail closed:

```ts
let authenticated = false;
try { const { data, error } = await supabase.auth.getClaims();
      authenticated = !error && !!data?.claims?.sub; }
catch { authenticated = false; }
```

The matcher (`src/middleware.ts:72-76`) excludes exactly `api/yahoo`, `api/fred`, `api/coingecko` and `api/trade/exchange-info` — all four are public, credential-free, cacheable data, so the exclusion is correct and complete. The remaining 8 `/api/trade/*` routes stay protected. **There is no drift between the matcher and the current route tree.** The residual risk (Low) is that if the matcher ever broke, those 8 routes would become an open exchange proxy for anyone with leaked credentials; a redundant session check inside each handler would be worthwhile.

**SSRF: no findings.** All four proxies insert the parameter with `encodeURIComponent` into a hardcoded host — `src/app/api/yahoo/route.ts:60-72` (and `interval`/`range` come from a fixed table, `:32-48`), `src/app/api/fred/route.ts:38-45`, `src/app/api/coingecko/route.ts:56-57,108-113` (with `days` clamped to 1–365), `src/app/api/trade/exchange-info/route.ts:50-55`. There is no way to redirect the fetch to another host.

**Medium — zero rate limiting across the whole app.** There is no throttling on `/api/trade/order` (order placement), on `/auth/callback`, or on the public proxies beyond the CDN `Cache-Control` — which offers no protection when an attacker varies the parameter and evades the cache key (the comment in `src/app/api/coingecko/route.ts:9` itself mentions the upstream's ~30 req/min limit).

**Medium — open redirect in `/auth/callback`.** `src/app/auth/callback/route.ts:7,13`: `next` is taken from the query string without validation and concatenated as a string (`${origin}${next}`) instead of `new URL(next, origin)`. A payload like `next=@evil.com/phish` produces `https://app.com@evil.com/phish`, which many browsers interpret as userinfo + host `evil.com`. It fires right after `exchangeCodeForSession`, so it is a direct phishing vector against a freshly authenticated user — chainable with 2.2 to ask them to "reconnect" their API keys.

### 2.4 Input validation

- **Medium** — `src/app/api/trade/leverage/route.ts:35` only checks truthiness (`!leverage`). A `-5` or `1e9` passes through and is forwarded verbatim to the exchange (`:41-45,57-69`). There is no local `1 <= leverage <= 125` bound.
- **Low** — `src/app/api/trade/order/route.ts:22-23,54-73`: `quantity`, `price` and `stopPrice` are taken from the body without checking that they are positive, finite numbers; same in `src/lib/exchanges/bybit.ts:415-457` (`body.qty = a.quantity`, line 426). All quantitative safety is delegated to the exchange.
- **Low** — `symbol` is not validated against a `^[A-Z0-9]+$` pattern in any trading route. It is not SSRF (it never lands in a host/path), but it is worth hardening.
- **No findings** — every route wraps its logic in `try/catch` with a JSON response, so malformed input cannot crash the serverless function.

---

## 3. Trading correctness (critical)

### Invariants verified as correct

Worth recording because these are the ones that most often break: `pnlAtExit` signs by the **position's** side, not the reduceOnly order's (`src/lib/trading/sizing.ts:126-134`, with `OrderLinesLayer.tsx:1010-1074` always passing `side: posSide`, and the generic path guarded by `line.entryPrice`, which is undefined on standalone orders — `OrderLinesLayer.tsx:954`). `Position.percentage` is real ROI in both mappers (`src/lib/exchanges/bybit.ts:163-173`, `src/lib/exchanges/account.ts:214-228`). The liquidation price is never recomputed client-side (`bybit.ts:183`, `account.ts:239`). Bybit's trigger direction is correct across all 4 side/type combinations (`bybit.ts:447-454`). `useTradingSync` is still the only account poll — verified by grep; the other `setInterval`s are public tickers, the countdown, or debounces. And the TP/SL↔position matching in hedge mode (`OrderLinesLayer.tsx:607-625`) is **not** ambiguous despite matching only on symbol+side: closing a long is always SELL and closing a short is always BUY, so the two positions never collide.

### Bugs

**🔴 Critical — TP/SL failures swallowed silently.** `src/lib/store/trading-store.ts:473-505` (the reduceOnly SL and TP legs in `placeOrder`) and `:681-693` (the `place()` helper of `setPositionTpSl` for Binance) `await fetch(...)` **without checking `res.ok`** or reading the body. `fetch` only rejects on network failure; an exchange rejection (invalid stop price, "would trigger immediately", minNotional, rate limit) arrives as an ordinary 400 and is ignored. `placeOrder` returns `{ ok: true }` all the same (line 509).

*Scenario:* you open a leveraged long with SL enabled. The MARKET entry fills; the SL is rejected because the mark moved between the quote and the submission. The app reports success and shows no error. **The position stays open and completely unprotected**, with no signal on screen. This is an inconsistency, not a design choice: the entry leg (`:465-469`), `closePosition` (`:614-618`) and `modifyOrder` (`:579-584`) do check `res.ok`.

**🔴 Critical — `modifyOrder`, two distinct failures** (`src/lib/store/trading-store.ts:529-591`):

**(a) Loses `positionIdx` when reposting.** The repost body (lines 563-572) does not include `positionIdx`, unlike `placeOrder` (`:445,484,502`), `closePosition` (`:611`) and `setPositionTpSl` (`:644`), which do thread it through. Since `bybitPlaceOrder` only adds it `if (a.positionIdx !== undefined)` (`bybit.ts:428`), it is omitted and Bybit rejects with "position idx not match position mode" on a hedge account. **The original order has already been cancelled.** Worse: the failure path (`:581-584`) sets `lastError` but **does not call `syncAccount`**, so the cached list can keep showing the cancelled order until the next tick — up to 15s at idle cadence, during which the UI actively lies about an SL that no longer exists. It is triggered by dragging an order's line (`OrderLinesLayer.tsx:946`) or from `EditOrderPopover` (`PositionsPanel.tsx:594`).

**(b) Uses `origQty` instead of the unfilled remainder.** Line 562: `const quantity = patch.quantity ?? order.origQty`. `EditOrderPopover` seeds the field with `order.origQty` (`PositionsPanel.tsx:581,592`) and only sets `patch.quantity` if the user changes it. Editing **only the price** of a partially filled limit order reposts the full original quantity on top of what has already filled: a 1 BTC order filled 40% goes from 0.4 filled + 0.6 pending to 0.4 filled + 1.0 new = up to **1.4 BTC of exposure** against the 1.0 intended.

**🟠 High — `quickOrder` with a stale, symbol-agnostic quantity.** `src/components/trading/BuySellOverlay.tsx:56-62` fires an immediate MARKET order with `form.qty` **without a confirmation dialog**. `resetForm` (`trading-store.ts:240-250`) exists precisely to clear `qty` but is **never called anywhere** in the code; `qty` is not persisted either, but within a session it survives a symbol change intact. The Buy/Sell buttons are visible with the order panel collapsed (`:64-105`), so the stale quantity is not on screen at the moment of the double click. You set a size on one symbol, switch the chart to a far more expensive one, double click → a full-size market order sized for the wrong instrument.

**🟡 Medium — `cancelOrder` does not check its response.** `src/lib/store/trading-store.ts:516-527`: the same fire-and-forget pattern, with no `lastError`. The consequence is minor (a "live" order the user believes is cancelled) but it is the same underlying defect.

**🟡 Medium — no `minNotional` or max-leverage pre-check.** `roundToStep` (`src/lib/trading/sizing.ts:23-26`) only snaps to `stepSize`; nothing verifies `qty * price >= minNotional` before submitting, even though the data is available (`bybit.ts:318`, `exchange-info/route.ts:99-100`, `symbol-info.ts:23`). In RISK_USD/RISK_PCT modes near the floor, `sizingToQty` (`sizing.ts:85-100`) can compute a quantity below the minimum with no warning in the panel.

**🟢 Low — `.toFixed()` with a fixed decimal count.** `src/components/trading/OrderPanel/OrderPanel.tsx:545,557` (`BidAskBar`) renders `bid.toFixed(2)`/`ask.toFixed(2)`, ignoring `symInfo.pricePrecision`: on a sub-cent symbol it shows "0.00" on both sides, right next to the Buy/Sell buttons. It does not corrupt the order (the real price fields do use the precision — lines 248, 251, 262, 769, 838, 841) but it is a materially misleading read of the market. Similar at `:479-481` and `:697`. The `.toFixed(2)` calls in `OrderLinesLayer.tsx` are USD/percentage values and are fine.

**🟢 Low — IEEE754 artifacts in `roundToStep`/`roundToTick`** (`sizing.ts:23-32`). The direction is always conservative for quantity (never over), so it does not create oversized orders.

---

## 4. Data integrity

**🔴 Critical — the write path has no exchange gating.** This is the audit's most important finding, and it extends the problem CLAUDE.md already documents for reads. Every read site is correctly guarded (`Watchlist.tsx:595-596`, `WatchlistScreen.tsx:468-470`, `OrderLinesLayer.tsx:702-704`, `BuySellOverlay.tsx:32-41`). But:

- `src/lib/store/trading-store.ts:396-470` (`placeOrder`) takes the symbol from the chart, calls `cleanSym(symbol)` and sends to the connected exchange. **There is no `resolveSource(symbol).kind === exchange` anywhere in the function** (verified by reading the whole block).
- `src/components/trading/BuySellOverlay.tsx:56-62` calls `placeOrder` without gating, even though the same component does guard the bid/ask it displays on line 32.
- `src/components/trading/OrderPanel/OrderPanel.tsx:336`: `onSubmit={() => placeOrder(symbol)}`, and the button is only disabled by `isLoading`/`!qty` (`:962-966`), never by a source mismatch.

*Scenario:* the account is connected to Binance, and you open a Bybit-only ticker (reachable from search, because `useBybitSymbols` registers Bybit's entire perp universe). The overlay correctly shows Bybit's bid/ask. Double click Buy expecting execution on Bybit → the order is placed **on Binance** against `cleanSym(symbol)`: a different book, a different price, or a 400 if it isn't even listed there.

**🟠 High — precision also comes from the wrong venue** (same root cause). `useSymbolInfo` (`src/lib/trading/symbol-info.ts:64-87`) resolves using `useTradingStore((s) => s.exchange)` — the connected account — not `resolveSource(symbol).kind`. That value feeds price rounding in `OrderLinesLayer.tsx:684` and `OrderPanel.tsx:143,356`, which flows into `updateForm({price/tp/sl})` (`OrderLinesLayer.tsx:845,867,880,889,900,911`). The cache itself is correct (key `${cleanSymbol}|${testnet}|${exchange}`, line 11/39, with no collision or staleness when the exchange changes) — the bug is the input, not the cache.

**🟠 High — Bybit silently substitutes 8h/3d.** `src/lib/bybit/public.ts:12-27`: Bybit has no 8h or 3d interval, so `"8h"` degrades to `"240"` (4h) and `"3d"` to `"D"` (1 day), in both REST (`:33`) and WS (`src/lib/bybit/ws.ts:66`). Nothing downstream compensates: `timeframeToSeconds` still returns 28800 and 259200 (`src/lib/chart/coords.ts:22,25`) and `BarCountdown.tsx:76` uses the declared timeframe. `TimeframeSelector.tsx:10-35` offers 8h/3d without conditioning on the source. Result: on a Bybit symbol at "8h" the chart shows twice as many bars as the timeframe implies, and the countdown can read up to ~4h remaining on a candle that has already closed and been replaced.

**🟢 Low — inconsistent `isFinal`.** Present on both Binance paths (`rest.ts:40`, `ws.ts:142`) and on Bybit's WS (`ws.ts:127`), absent from Bybit's REST (`public.ts:69-76`). Nobody reads it outside tests today, but it is a landmine for the first consumer that trusts it.

**Verified correct:** `snapToOHLC` is only called from `snap.ts` (no bypass of `magnet.ts`); the three `SUB_PANE_KEYS` sites are in sync and OBV is now wired into all three (`PriceChart.tsx:1148,1365,335,3055,1831,1852,3086`) — the historical drift is fixed; the only two tick consumers that render lists go through `useBatchedTicks`; all calendar arithmetic uses UTC getters (`keylevels.ts:35-67`, `indicators/index.ts:210-227`); Binance and Bybit normalize to the same `Candle` shape (time in seconds, volume in base); and Volume Profile implements exactly the proportional overlap distribution (`volume-profile.ts:104-121`) and the two-row value-area expansion (`:169-199`).

---

## 5. Architecture and client/server boundaries

- **The boundary is well drawn.** 105 files carry `'use client'` out of 174 non-test files (~60%), consistent with the stated philosophy. All HMAC work lives server-side only: `src/app/api/trade/order/route.ts:17,72,111`, `leverage/route.ts:10,63`, `src/lib/exchanges/account.ts:1,45-61`. **Zero signing code in `src/components/` or in hooks.**
- **The real design smell** is that the secret materializes in the browser and travels on every action (read in `OrderPanel.tsx:127`, `ApiKeyDialog.tsx:9`, `FloatingContextToolbar.tsx:442`, `TradeScreen.tsx:25`, `PositionsPanel.tsx:21`, `useTradingSync.ts:54`). It does not violate the boundary, but it turns any XSS from "read a value" into "trading account takeover".
- **Zustand persist:** `chart-store` (`:1375-1413`) and `mobile-store` (`:38-39`) persist preferences only, which is correct. `alerts-store.ts:43-67` is the only one **without `partialize`** — harmless today (JSON.stringify drops functions) but fragile if someone adds a sensitive field without noticing. `drawings-store` does not persist (it goes to Supabase). The problem is `trading-store`, already covered in §2.2.
- **Dependencies:** notably clean — a single charting library, no duplicated date libraries, no lodash. The one anomaly: `"shadcn": "^4.7.0"` sits in `dependencies` (`package.json:20`) without ever being imported from `src/`; it is a generator CLI and belongs in `devDependencies`, or should be removed.
- **Technical debt:** **zero** TODO/FIXME/HACK/XXX across all of `src/`, and **zero** `: any` / `as any` in `src/lib/trading/`, `src/lib/exchanges/` and `src/app/api/trade/`. The financial paths are genuinely typed — a real and uncommon strength.

---

## 6. Tests

23 `*.test.ts` files. Well covered: `sizing.ts`, `bybit.ts` (mappers), `countdown.ts`, `source.ts`, `volume-profile.ts`, the main indicators, drawing geometry/fib/duplicate/translate, and the chart/drawings/replay stores.

| Module | Tested? | Risk if not |
|---|---|---|
| `src/lib/exchanges/account.ts` (265 lines) | **No** | **High.** The shared normalization layer behind `/api/trade/{balance,orders,positions,sync}`. The pure balance logic (`:95-122`: `free = availableBalance`, `locked = balance - availableBalance`) has not a single assertion. A regression here misreports the available balance on both exchanges. It is the uncovered pure module with the greatest financial impact. |
| `src/lib/trading/symbol-info.ts` | **No** | Medium-high. `cleanSymbol` and the `DEFAULT_SYMBOL_INFO` fallback feed order rounding precision. |
| `src/lib/drawings/serialize.ts` | **No** | Medium. `drawingToRow`/`rowToDrawing` (`:9,29`) is the persistence boundary to Supabase; a broken field mapping corrupts saved drawings with nothing to catch it. |
| `src/lib/symbols/prefix.ts`, `catalog.ts` | **No** | Medium. `prefix.ts` feeds order routing decisions (§4). |
| `src/lib/indicators/vumanchu.ts` (301 lines), `keylevels.ts` (239) | **No** | Medium. The two large indicators without coverage; a calculation error misinforms decisions without touching execution. |
| `src/lib/chart/magnet.ts`, `src/lib/history/index.ts` | **No** | Low-medium, UX level. |
| `snap.ts`, `alert-eval.ts` | Yes, but misplaced | Low. Covered from `coords-snap.test.ts`/`snap-drawings.test.ts` and `src/hooks/alert-logic.test.ts` — they break the "test next to the code" convention. |

**Cross-cutting gap:** none of the critical bugs in §3 has a test. `placeOrder`, `modifyOrder` and `cancelOrder` live in the store and are testable with a mocked `fetch` under the current runner — no DOM required.

---

## 7. Top 10 prioritized findings

| # | Sev. | File:line | What to do |
|---|---|---|---|
| 1 | **Critical** | `trading-store.ts:473-505`, `:681-693` | Check `res.ok` on the TP/SL legs and propagate the failure. If the SL is rejected after a filled entry, warn prominently on screen — today a leveraged position is left without a stop and the app says "success". |
| 2 | **Critical** | `trading-store.ts:396-470`, `BuySellOverlay.tsx:56-62`, `OrderPanel.tsx:336` | Add `resolveSource(symbol).kind === exchange` before placing; disable Buy/Sell with an explicit message on a mismatch. Prevents routing to the wrong venue. |
| 3 | **Critical** | `trading-store.ts:563-572` | Include `positionIdx` in `modifyOrder`'s repost (add it to `Order` in `trading-types.ts:19-35`). Today, on a Bybit hedge account, it cancels and the repost is rejected. |
| 4 | **Critical** | `trading-store.ts:562` | Use the remainder (`origQty - executedQty`), not `origQty`, when reposting. Editing the price of a partially filled order currently inflates exposure. |
| 5 | **High** | `trading-store.ts:581-584` | Call `syncAccount` on the repost failure path too, so the UI stops showing an already-cancelled order for up to 15s. |
| 6 | **High** | `trading-store.ts:256-373`, `account.ts:253-265` | Move account reads from GET+query string to POST+body. The key and secret are being written to logs every 2 seconds. |
| 7 | **High** | `BuySellOverlay.tsx:56-62` | Call `resetForm` on symbol change (it exists at `:240-250` and is never used) and/or show the quantity on the quick-order button. |
| 8 | **High** | `symbol-info.ts:64-87` | Derive the exchange from `resolveSource(symbol).kind`, not from the connected account, so tick/step size come from the correct venue. |
| 9 | **High** | `bybit/public.ts:12-27` | Hide 8h/3d in `TimeframeSelector` for Bybit sources, or label the substitution. Today the displayed granularity and the countdown are silently wrong. |
| 10 | **Medium** | `auth/callback/route.ts:7,13` | Validate `next` (`startsWith("/") && !startsWith("//")` and no `@`) or use `new URL(next, origin)`. Open redirect against a freshly authenticated user. |

**Just below the top 10, in order:** test coverage for `exchanges/account.ts` (§6), encryption or a documented mitigation for the secret in localStorage (`trading-store.ts:739-742`), rate limiting on `/api/trade/order` and `/auth/callback`, a leverage bound (`leverage/route.ts:35`), a `minNotional` pre-check, `res.ok` in `cancelOrder`, and `bid/ask.toFixed(2)` in `OrderPanel.tsx:545,557`.

Nothing was edited — a strictly read-only audit, as you asked. If you want, I can open the four critical findings as tasks or prepare the patches for #1 through #4, which are the ones that touch money directly.
