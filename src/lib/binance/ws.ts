import type { Candle, Timeframe } from "./types";
import { isPerp, cleanSym } from "./rest";

const SPOT_WS = "wss://stream.binance.com:9443/stream";
const FUTURES_WS = "wss://fstream.binance.com/stream";

interface KlineMsg {
  stream: string;
  data: {
    e: string;
    E: number;
    s: string;
    k: {
      t: number;
      T: number;
      s: string;
      i: string;
      o: string;
      c: string;
      h: string;
      l: string;
      v: string;
      x: boolean;
    };
  };
}

interface MiniTickerMsg {
  stream: string;
  data: {
    e: string;
    E: number;
    s: string;
    c: string;
    o: string;
    h: string;
    l: string;
    v: string;
    q: string;
  };
}

interface BookTickerMsg {
  stream: string;
  data: {
    u: number;
    s: string;
    b: string;
    B: string;
    a: string;
    A: string;
  };
}

type WSMsg = KlineMsg | MiniTickerMsg | BookTickerMsg;

export interface KlineSubscription {
  symbol: string;
  interval: Timeframe;
  onCandle: (c: Candle) => void;
}

/**
 * One Binance WS connection (either spot or futures). Multiplexed with
 * auto-reconnect.
 */
class BinanceWSConn {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private klineSubs = new Map<string, KlineSubscription>();
  // stream -> listeners. Two independent components can watch the same
  // symbol's mini-ticker at once (the watchlist row and `usePaperExposureFeed`
  // driving the paper engine, both riding this same process-wide singleton) —
  // a single-callback map here silently drops whichever subscriber isn't
  // "last in", and the first one to unsubscribe deletes the stream out from
  // under the other. Fan out to a Set of listeners per stream instead, the
  // same shape `BybitWS.tickerSubs` already uses.
  private tickerSubs = new Map<
    string,
    Set<{ onTick: (s: { symbol: string; close: number; open: number; pct: number }) => void; symbol: string }>
  >();
  private bookTickerSubs = new Map<string, (m: { bid: number; ask: number }) => void>();
  private connected = false;
  private closing = false;
  private url: string;
  private symbolDecorator: (s: string) => string;

  constructor(url: string, symbolDecorator: (s: string) => string) {
    this.url = url;
    this.symbolDecorator = symbolDecorator;
  }

  connect() {
    if (this.ws || this.closing) return;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      const streams: string[] = [];
      this.klineSubs.forEach((s) => {
        streams.push(`${cleanSym(s.symbol).toLowerCase()}@kline_${s.interval}`);
      });
      this.tickerSubs.forEach((_v, k) => streams.push(k));
      this.bookTickerSubs.forEach((_v, k) => streams.push(k));
      if (streams.length > 0) {
        this.send({ method: "SUBSCRIBE", params: streams, id: this.nextId++ });
      }
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WSMsg | { result: unknown; id: number };
        if ("stream" in msg) this.dispatch(msg);
      } catch {
        // ignore
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.ws = null;
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

  private dispatch(msg: WSMsg) {
    if (msg.stream.includes("@kline_")) {
      const sub = this.klineSubs.get(msg.stream);
      if (!sub) return;
      const k = (msg as KlineMsg).data.k;
      sub.onCandle({
        time: Math.floor(k.t / 1000),
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
        isFinal: k.x,
      });
    } else if (msg.stream.includes("@miniTicker")) {
      const listeners = this.tickerSubs.get(msg.stream);
      if (listeners) {
        const d = (msg as MiniTickerMsg).data;
        const close = parseFloat(d.c);
        const open = parseFloat(d.o);
        const pct = open === 0 ? 0 : ((close - open) / open) * 100;
        for (const { onTick, symbol } of listeners) {
          onTick({ symbol: this.symbolDecorator(symbol), close, open, pct });
        }
      }
    } else if (msg.stream.includes("@bookTicker")) {
      const handler = this.bookTickerSubs.get(msg.stream);
      if (handler) {
        const d = (msg as BookTickerMsg).data;
        handler({ bid: parseFloat(d.b), ask: parseFloat(d.a) });
      }
    }
  }

  subscribeKline(sub: KlineSubscription): () => void {
    const stream = `${cleanSym(sub.symbol).toLowerCase()}@kline_${sub.interval}`;
    this.klineSubs.set(stream, sub);
    if (this.connected) {
      this.send({ method: "SUBSCRIBE", params: [stream], id: this.nextId++ });
    } else if (!this.ws) {
      this.connect();
    }
    return () => {
      this.klineSubs.delete(stream);
      if (this.connected) {
        this.send({ method: "UNSUBSCRIBE", params: [stream], id: this.nextId++ });
      }
    };
  }

  subscribeMiniTickers(
    symbols: string[],
    onTick: (s: { symbol: string; close: number; open: number; pct: number }) => void,
  ): () => void {
    // One entry per symbol carrying both its stream and its listener, rather
    // than two index-aligned arrays that the subscribe and unsubscribe loops
    // each have to index in step.
    const subs = symbols.map((symbol) => ({
      stream: `${cleanSym(symbol).toLowerCase()}@miniTicker`,
      listener: { onTick, symbol },
    }));
    const newStreams: string[] = [];
    for (const { stream, listener } of subs) {
      let set = this.tickerSubs.get(stream);
      if (!set) {
        set = new Set();
        this.tickerSubs.set(stream, set);
        newStreams.push(stream);
      }
      set.add(listener);
    }
    if (this.connected && newStreams.length > 0) {
      this.send({ method: "SUBSCRIBE", params: newStreams, id: this.nextId++ });
    } else if (!this.ws) {
      this.connect();
    }
    return () => {
      for (const { stream, listener } of subs) {
        const set = this.tickerSubs.get(stream);
        if (!set) continue;
        set.delete(listener);
        if (set.size === 0) {
          this.tickerSubs.delete(stream);
          if (this.connected) {
            this.send({ method: "UNSUBSCRIBE", params: [stream], id: this.nextId++ });
          }
        }
      }
    };
  }

  subscribeBookTicker(
    symbol: string,
    onTick: (data: { bid: number; ask: number }) => void,
  ): () => void {
    const stream = `${cleanSym(symbol).toLowerCase()}@bookTicker`;
    this.bookTickerSubs.set(stream, onTick);
    if (this.connected) {
      this.send({ method: "SUBSCRIBE", params: [stream], id: this.nextId++ });
    } else if (!this.ws) {
      this.connect();
    }
    return () => {
      this.bookTickerSubs.delete(stream);
      if (this.connected) {
        this.send({ method: "UNSUBSCRIBE", params: [stream], id: this.nextId++ });
      }
    };
  }

  close() {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}

/**
 * Public WS facade with two underlying connections (spot + futures). Routes
 * subscriptions by inspecting the symbol for the ".P" suffix.
 */
export class BinanceWS {
  private spot = new BinanceWSConn(SPOT_WS, (s) => s);
  private futures = new BinanceWSConn(FUTURES_WS, (s) => s);

  connect() {
    // Lazy: connect on first subscription
  }

  subscribeKline(sub: KlineSubscription): () => void {
    const conn = isPerp(sub.symbol) ? this.futures : this.spot;
    return conn.subscribeKline(sub);
  }

  subscribeMiniTickers(
    symbols: string[],
    onTick: (s: { symbol: string; close: number; open: number; pct: number }) => void,
  ): () => void {
    const spotSyms = symbols.filter((s) => !isPerp(s));
    const perpSyms = symbols.filter((s) => isPerp(s));
    const unsubs: (() => void)[] = [];
    if (spotSyms.length > 0)
      unsubs.push(this.spot.subscribeMiniTickers(spotSyms, onTick));
    if (perpSyms.length > 0)
      unsubs.push(this.futures.subscribeMiniTickers(perpSyms, onTick));
    return () => unsubs.forEach((u) => u());
  }

  subscribeBookTicker(
    symbol: string,
    onTick: (data: { bid: number; ask: number }) => void,
  ): () => void {
    const conn = isPerp(symbol) ? this.futures : this.spot;
    return conn.subscribeBookTicker(symbol, onTick);
  }

  close() {
    this.spot.close();
    this.futures.close();
  }
}

let singleton: BinanceWS | null = null;
export function getBinanceWS(): BinanceWS {
  if (typeof window === "undefined") return new BinanceWS();
  if (!singleton) singleton = new BinanceWS();
  return singleton;
}
