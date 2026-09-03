# TradingView Free 📈

> **An open-source, 100% free alternative to TradingView Pro.**
> Live candles, custom indicators, drawing tools, alerts, bar replay — no fees, no ads.

A crypto charting platform built on **Binance**'s public data (WebSocket) and the same rendering library TradingView itself uses ([`lightweight-charts`](https://github.com/tradingview/lightweight-charts)).

---

## ✨ Features

- 📊 **Live candles** via Binance's WebSocket (no API key)
- 🔍 **Symbol search** across every USDT pair on the exchange
- ⏱️ **Multi-timeframe**: 1m / 5m / 15m / 1h / 4h / 1d / 1w
- 📐 **Client-side indicators**: EMA, RSI, MACD, Bollinger Bands, VWAP, Volume Profile, oscillators
- ✏️ **Drawing tools**: trend lines, Fibs, rectangles, channels, positions and more, persisted + cloud-synced
- 🔔 **Price alerts** with in-app notifications
- ⏪ **Bar replay** for practice and manual backtesting
- 👁️ **Watchlist** with prices and 24h change updating in real time
- 🎨 **Visually identical to TradingView** (palette, fonts, layout)
- 💾 **Persistence** in localStorage (symbol, timeframe, indicators)
- 🔌 **Robust WebSocket reconnection** with exponential backoff
- 🌐 100% client-side — static deploy on Vercel/Cloudflare

## 🚀 Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 🛠️ Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styles | Tailwind CSS 4 + shadcn/ui |
| Charts | [lightweight-charts](https://github.com/tradingview/lightweight-charts) v5 |
| State | Zustand (with persistence) |
| Icons | lucide-react |
| Data | Binance Public REST + WebSocket |

## 📐 Architecture

```
src/
├── app/
│   ├── layout.tsx          # Root, Inter font, TooltipProvider, dark
│   ├── page.tsx            # Dashboard assembling the layout
│   └── globals.css         # TradingView palette
├── components/
│   ├── chart/
│   │   ├── PriceChart.tsx     # Chart core (lightweight-charts + panes)
│   │   ├── SymbolSelector.tsx # USDT pair search
│   │   ├── TimeframeSelector.tsx
│   │   └── IndicatorMenu.tsx  # Toggle EMA/RSI/MACD/Volume
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── LeftSidebar.tsx    # Drawing tool icons (visual)
│   │   ├── RightSidebar.tsx
│   │   └── BottomPanel.tsx    # 24h stats
│   ├── watchlist/
│   │   └── Watchlist.tsx      # Live multi-symbol prices
│   └── ui/                    # shadcn primitives
└── lib/
    ├── binance/
    │   ├── rest.ts            # klines / ticker / exchangeInfo
    │   ├── ws.ts              # WS multiplex + auto-reconnect
    │   └── types.ts
    ├── indicators/
    │   └── index.ts           # SMA, EMA, RSI (Wilder), MACD
    ├── store/
    │   └── chart-store.ts     # Zustand global state
    └── format.ts              # formatPrice / formatPct / formatVolume
```

## 🌐 Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Or connect the repo at [vercel.com/new](https://vercel.com/new) for automatic deploys. There are no environment variables — everything is client-side.

## 🧠 How it works

### Historical data
Opening a symbol fires a `GET /api/v3/klines` (REST) that brings back the last **1000 candles** for the active pair + timeframe. They render instantly.

### Live data
A single multiplexed WebSocket connection (`stream.binance.com`) receives:
- `<symbol>@kline_<interval>` → updates to the current candle + candle closes
- `<symbol>@miniTicker` → watchlist tickers

On reconnect (Binance drops the WS every 24h) every active stream is resubscribed with exponential backoff.

### Indicators
They are computed **client-side** over the candle array on every update. Pure TypeScript implementations:
- `EMA`: seeded with the SMA of the first period, then `close * k + prev * (1-k)`
- `RSI`: Wilder (exponential smoothing over gains/losses, period 14)
- `MACD`: EMA(12) − EMA(26), signal = EMA(9) over the MACD line

For 1000 candles and multiple panes the cost is negligible.

## ⚠️ Not included (yet)

- ❌ Pine Script (proprietary to TradingView, can't be cloned)
- ❌ Server-side alerts (alerts currently run client-side)
- ❌ Real trading (broker integration)
- ❌ Screener / scanner over the full exchange universe

`lightweight-charts` is Apache 2.0 with attribution to TradingView — the attribution lives in the footer/UI as the license requires.
