import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { getBinanceWS } from "./ws";

/**
 * Minimal fake of the browser `WebSocket` the module talks to: captures the
 * handlers `BinanceWSConn` assigns and lets the test drive `onopen`/`onmessage`
 * directly, without a real socket or network access.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.();
  }
}

function openAll() {
  for (const sock of FakeSocket.instances) sock.onopen?.();
}

function emitMiniTicker(stream: string, close: number, open: number) {
  for (const sock of FakeSocket.instances) {
    sock.onmessage?.({
      data: JSON.stringify({
        stream,
        data: { e: "24hrMiniTicker", E: 0, s: "", c: String(close), o: String(open), h: "0", l: "0", v: "0", q: "0" },
      }),
    });
  }
}

const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  FakeSocket.instances = [];
  // @ts-expect-error test stub, not a full WebSocket implementation
  globalThis.WebSocket = FakeSocket;
});

afterEach(() => {
  globalThis.WebSocket = OriginalWebSocket;
});

describe("BinanceWS mini-ticker fan-out", () => {
  it("delivers ticks to two concurrent subscribers on the same symbol", () => {
    const ws = getBinanceWS();
    const ticksA: number[] = [];
    const ticksB: number[] = [];
    ws.subscribeMiniTickers(["BTCUSDT"], (t) => ticksA.push(t.close));
    ws.subscribeMiniTickers(["BTCUSDT"], (t) => ticksB.push(t.close));

    openAll();
    emitMiniTicker("btcusdt@miniTicker", 100, 90);

    expect(ticksA).toEqual([100]);
    expect(ticksB).toEqual([100]);
  });

  it("unsubscribing one listener leaves the other intact", () => {
    const ws = getBinanceWS();
    const ticksA: number[] = [];
    const ticksB: number[] = [];
    const unsubA = ws.subscribeMiniTickers(["BTCUSDT"], (t) => ticksA.push(t.close));
    ws.subscribeMiniTickers(["BTCUSDT"], (t) => ticksB.push(t.close));

    openAll();
    emitMiniTicker("btcusdt@miniTicker", 100, 90);
    unsubA();
    emitMiniTicker("btcusdt@miniTicker", 105, 90);

    expect(ticksA).toEqual([100]);
    expect(ticksB).toEqual([100, 105]);
  });

  it("only sends an UNSUBSCRIBE once every listener on a stream is gone", () => {
    const ws = getBinanceWS();
    const unsubA = ws.subscribeMiniTickers(["BTCUSDT"], () => {});
    const unsubB = ws.subscribeMiniTickers(["BTCUSDT"], () => {});
    openAll();

    unsubA();
    const sentBeforeSecondUnsub = FakeSocket.instances.flatMap((s) => s.sent).join("\n");
    expect(sentBeforeSecondUnsub.includes("UNSUBSCRIBE")).toBe(false);

    unsubB();
    const sentAfter = FakeSocket.instances.flatMap((s) => s.sent).join("\n");
    expect(sentAfter.includes("UNSUBSCRIBE")).toBe(true);
  });
});
