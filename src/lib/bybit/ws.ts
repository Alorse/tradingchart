import type { Candle, Timeframe } from "@/lib/binance/types";
import { bybitInterval, bybitSymbol } from "./public";

/**
 * Bybit public linear WS (kline stream) with the same `subscribeKline` shape as
 * the Binance WS, so PriceChart can pick a WS by source kind and stream Bybit
 * perps live. Auto-reconnects; sends a heartbeat ping every 20s as Bybit
 * requires, otherwise the socket is dropped.
 */

const WS_URL = "wss://stream.bybit.com/v5/public/linear";

export interface KlineSubscription {
  symbol: string;
  interval: Timeframe;
  onCandle: (c: Candle) => void;
}

interface BybitKlineMsg {
  topic: string;
  data: {
    start: number;
    end: number;
    open: string;
    close: string;
    high: string;
    low: string;
    volume: string;
    confirm: boolean;
  }[];
}

interface BybitTickerMsg {
  topic: string;
  type: "snapshot" | "delta";
  data: { symbol: string; lastPrice?: string; price24hPcnt?: string };
}

export interface MiniTick {
  symbol: string;
  close: number;
  open: number;
  pct: number;
}

class BybitWS {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private subs = new Map<string, KlineSubscription>(); // topic -> sub
  // topic -> listeners. Several independent components can watch the same
  // symbol at once (a watchlist row *and* BuySellOverlay's quote for the
  // currently-charted symbol, since Bybit has no separate book-ticker stream
  // to fall back to) — a single-entry map here silently drops whichever
  // subscriber isn't "last in", and unsubscribing one would delete the topic
  // out from under the other. Fan out to a Set of listeners per topic instead.
  private tickerSubs = new Map<string, Set<{ onTick: (t: MiniTick) => void; ticker: string }>>();
  // `last` retains price/pct across delta frames (Bybit ticker deltas only
  // carry changed fields), shared by every listener on a topic.
  private tickerLast = new Map<string, { price: number; pct: number }>();
  private connected = false;
  private closing = false;

  private topicOf(sub: KlineSubscription): string {
    return `kline.${bybitInterval(sub.interval)}.${bybitSymbol(sub.symbol)}`;
  }

  connect() {
    if (this.ws || this.closing) return;
    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      const topics = [...this.subs.keys(), ...this.tickerSubs.keys()];
      if (topics.length > 0) this.send({ op: "subscribe", args: topics });
      this.pingTimer = setInterval(() => this.send({ op: "ping" }), 20000);
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as BybitKlineMsg | BybitTickerMsg | { op?: string };
        if (!("topic" in msg) || !msg.topic) return;
        if (msg.topic.startsWith("kline.")) this.dispatch(msg as BybitKlineMsg);
        else if (msg.topic.startsWith("tickers.")) this.dispatchTicker(msg as BybitTickerMsg);
      } catch {
        // ignore
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      if (!this.closing) this.scheduleReconnect();
    };

    this.ws.onerror = () => this.ws?.close();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(payload: object) {
    if (this.ws && this.connected) this.ws.send(JSON.stringify(payload));
  }

  private dispatch(msg: BybitKlineMsg) {
    const sub = this.subs.get(msg.topic);
    if (!sub) return;
    for (const k of msg.data) {
      sub.onCandle({
        time: Math.floor(k.start / 1000),
        open: parseFloat(k.open),
        high: parseFloat(k.high),
        low: parseFloat(k.low),
        close: parseFloat(k.close),
        volume: parseFloat(k.volume),
        isFinal: k.confirm,
      });
    }
  }

  private dispatchTicker(msg: BybitTickerMsg) {
    const listeners = this.tickerSubs.get(msg.topic);
    if (!listeners) return;
    let last = this.tickerLast.get(msg.topic);
    if (!last) {
      last = { price: 0, pct: 0 };
      this.tickerLast.set(msg.topic, last);
    }
    if (msg.data.lastPrice !== undefined) last.price = parseFloat(msg.data.lastPrice);
    if (msg.data.price24hPcnt !== undefined) last.pct = parseFloat(msg.data.price24hPcnt) * 100;
    for (const { onTick, ticker } of listeners) {
      onTick({ symbol: ticker, close: last.price, open: 0, pct: last.pct });
    }
  }

  subscribeKline(sub: KlineSubscription): () => void {
    const topic = this.topicOf(sub);
    this.subs.set(topic, sub);
    if (this.connected) this.send({ op: "subscribe", args: [topic] });
    else if (!this.ws) this.connect();
    return () => {
      this.subs.delete(topic);
      if (this.connected) this.send({ op: "unsubscribe", args: [topic] });
    };
  }

  /** Subscribe to live 24h ticker updates. Symbols may carry `BYBIT:`/`.P`; the
   *  emitted tick echoes the exact input symbol so callers can key rows by it.
   *  Multiple independent callers can watch the same underlying symbol; each
   *  gets its own listener entry rather than clobbering another caller's. */
  subscribeMiniTickers(symbols: string[], onTick: (t: MiniTick) => void): () => void {
    const topics = symbols.map((s) => `tickers.${bybitSymbol(s)}`);
    const listeners = symbols.map((symbol) => ({ onTick, ticker: symbol }));
    const newTopics: string[] = [];
    topics.forEach((topic, i) => {
      let set = this.tickerSubs.get(topic);
      if (!set) {
        set = new Set();
        this.tickerSubs.set(topic, set);
        newTopics.push(topic);
      }
      set.add(listeners[i]);
      // Deliver the cached price immediately so a subscriber that joins an
      // already-live topic doesn't sit stale until the next delta frame.
      const last = this.tickerLast.get(topic);
      if (last) onTick({ symbol: symbols[i], close: last.price, open: 0, pct: last.pct });
    });
    if (this.connected && newTopics.length > 0) this.send({ op: "subscribe", args: newTopics });
    else if (!this.ws) this.connect();
    return () => {
      topics.forEach((topic, i) => {
        const set = this.tickerSubs.get(topic);
        if (!set) return;
        set.delete(listeners[i]);
        if (set.size === 0) {
          this.tickerSubs.delete(topic);
          this.tickerLast.delete(topic);
          if (this.connected) this.send({ op: "unsubscribe", args: [topic] });
        }
      });
    };
  }

  close() {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }
}

let singleton: BybitWS | null = null;
export function getBybitWS(): BybitWS {
  if (typeof window === "undefined") return new BybitWS();
  if (!singleton) singleton = new BybitWS();
  return singleton;
}
