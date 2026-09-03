import type { Candle } from "@/lib/binance/types";
import {
  closeSeries,
  emaSeries,
  highSeries,
  highestSeries,
  hlc3Series,
  lowSeries,
  lowestSeries,
  rmaSeries,
  smaSeries,
  stdevSeries,
  trueRangeSeries,
} from "./helpers";

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface MACDPoint {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * Simple Moving Average
 */
export function sma(candles: Candle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length < period) return out;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

/**
 * Exponential Moving Average — seeded with SMA of first `period` candles.
 */
export function ema(candles: Candle[], period: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += candles[i].close;
  prev /= period;
  out.push({ time: candles[period - 1].time, value: prev });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

/**
 * RSI (Wilder) — period typically 14.
 */
export function rsi(candles: Candle[], period = 14): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  let rs = loss === 0 ? 100 : gain / loss;
  out.push({ time: candles[period].time, value: 100 - 100 / (1 + rs) });
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    rs = loss === 0 ? 100 : gain / loss;
    out.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
  }
  return out;
}

/**
 * MACD — fast EMA, slow EMA, signal EMA of the MACD line.
 * Defaults: 12 / 26 / 9.
 */
export function macd(
  candles: Candle[],
  fast = 12,
  slow = 26,
  signal = 9,
): MACDPoint[] {
  if (candles.length < slow + signal) return [];
  const emaFast = ema(candles, fast);
  const emaSlow = ema(candles, slow);
  // align: emaSlow starts later
  const slowStartTime = emaSlow[0].time;
  const fastByTime = new Map(emaFast.map((p) => [p.time, p.value]));
  const macdLine: IndicatorPoint[] = [];
  for (const p of emaSlow) {
    const f = fastByTime.get(p.time);
    if (f !== undefined) macdLine.push({ time: p.time, value: f - p.value });
  }
  // signal = EMA of MACD line. Build synthetic candles for ema()
  const synth: Candle[] = macdLine.map((p) => ({
    time: p.time,
    open: p.value,
    high: p.value,
    low: p.value,
    close: p.value,
    volume: 0,
  }));
  const sig = ema(synth, signal);
  const sigByTime = new Map(sig.map((p) => [p.time, p.value]));
  const out: MACDPoint[] = [];
  for (const p of macdLine) {
    const s = sigByTime.get(p.time);
    if (s === undefined) continue;
    out.push({ time: p.time, macd: p.value, signal: s, histogram: p.value - s });
  }
  void slowStartTime;
  return out;
}

/**
 * On-Balance Volume — cumulative volume signed by close direction.
 *  obv[0] = 0
 *  obv[i] = obv[i-1] + sign(close[i] - close[i-1]) * volume[i]
 */
export function obv(candles: Candle[]): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (candles.length === 0) return out;
  let acc = 0;
  out.push({ time: candles[0].time, value: acc });
  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    acc += sign * candles[i].volume;
    out.push({ time: candles[i].time, value: acc });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bands, VWAP and the classic oscillators.
//
// These mirror Pine Script's built-ins (`ta.bb`, `ta.vwap`, `ta.stoch`,
// `ta.atr`, `ta.cci`, `ta.mfi`, `ta.wpr`) so a chart here reads the same as the
// TradingView one it is compared against. All of them build on the NaN-padded
// primitives in `helpers.ts` rather than re-slicing the candle array per bar.
// ─────────────────────────────────────────────────────────────────────────────

/** One bar of a banded overlay (Bollinger, VWAP ± deviation). */
export interface BandPoint {
  time: number;
  upper: number;
  mid: number;
  lower: number;
}

/** Stochastic RSI emits two lines. */
export interface StochRsiPoint {
  time: number;
  k: number;
  d: number;
}

/** Basis moving average available to Bollinger Bands. */
export type BbMaType = "SMA" | "EMA";

/**
 * Bollinger Bands — `basis ± mult * stdev(src, length)`.
 * Pine's `ta.stdev` is the population deviation, which `stdevSeries` matches.
 */
export function bollingerBands(
  candles: Candle[],
  period = 20,
  mult = 2,
  maType: BbMaType = "SMA",
): BandPoint[] {
  if (candles.length < period || period < 1) return [];
  const closes = closeSeries(candles);
  const basis = maType === "EMA" ? emaSeries(closes, period) : smaSeries(closes, period);
  const dev = stdevSeries(closes, period);
  const out: BandPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (isNaN(basis[i]) || isNaN(dev[i])) continue;
    const spread = mult * dev[i];
    out.push({
      time: candles[i].time,
      upper: basis[i] + spread,
      mid: basis[i],
      lower: basis[i] - spread,
    });
  }
  return out;
}

/** Where a VWAP's running sums reset. */
export type VwapAnchor = "session" | "week" | "month" | "year";

/** Anchor bucket key for a bar — a change in the key restarts the accumulation. */
function anchorKey(timeSec: number, anchor: VwapAnchor): string {
  const d = new Date(timeSec * 1000);
  const y = d.getUTCFullYear();
  switch (anchor) {
    case "year":
      return `${y}`;
    case "month":
      return `${y}-${d.getUTCMonth()}`;
    case "week": {
      // ISO-ish week bucket: the UTC Monday that starts this bar's week.
      const dayIdx = (d.getUTCDay() + 6) % 7; // Monday = 0
      const monday = Date.UTC(y, d.getUTCMonth(), d.getUTCDate() - dayIdx);
      return `w${monday}`;
    }
    default:
      return `${y}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  }
}

/**
 * Anchored VWAP with optional standard-deviation bands.
 *
 * The deviation is the volume-weighted one TradingView plots — the spread of
 * price *around the running VWAP*, not a plain stdev of close — so the bands
 * widen with participation rather than with volatility alone.
 */
export function vwap(
  candles: Candle[],
  anchor: VwapAnchor = "session",
  bandMult = 1,
): BandPoint[] {
  const out: BandPoint[] = [];
  let pv = 0;
  let vol = 0;
  let pv2 = 0; // Σ volume · src² — gives the weighted variance in one pass
  let key = "";
  for (const c of candles) {
    const k = anchorKey(c.time, anchor);
    if (k !== key) {
      pv = 0;
      vol = 0;
      pv2 = 0;
      key = k;
    }
    const src = (c.high + c.low + c.close) / 3;
    // A zero-volume bar (some non-crypto feeds) must still advance the series,
    // so fall back to weighting it as a single unit rather than dropping it.
    const v = c.volume > 0 ? c.volume : 1;
    pv += src * v;
    pv2 += src * src * v;
    vol += v;
    const mid = pv / vol;
    const variance = Math.max(0, pv2 / vol - mid * mid);
    const spread = bandMult * Math.sqrt(variance);
    out.push({ time: c.time, upper: mid + spread, mid, lower: mid - spread });
  }
  return out;
}

/**
 * Stochastic RSI — a stochastic oscillator run over the RSI series.
 * Pine: `k = sma(stoch(rsi, rsi, rsi, stochLen), smoothK)`, `d = sma(k, smoothD)`.
 */
export function stochRsi(
  candles: Candle[],
  rsiLen = 14,
  stochLen = 14,
  smoothK = 3,
  smoothD = 3,
): StochRsiPoint[] {
  const rsiSeries = rsi(candles, rsiLen);
  if (rsiSeries.length < stochLen) return [];
  const values = rsiSeries.map((p) => p.value);
  const hi = highestSeries(values, stochLen);
  const lo = lowestSeries(values, stochLen);
  const raw = values.map((v, i) => {
    if (isNaN(hi[i]) || isNaN(lo[i])) return NaN;
    return hi[i] === lo[i] ? 0 : ((v - lo[i]) / (hi[i] - lo[i])) * 100;
  });
  const kLine = smaSeries(raw.map((v) => (isNaN(v) ? 0 : v)), smoothK);
  const dLine = smaSeries(kLine.map((v) => (isNaN(v) ? 0 : v)), smoothD);
  const firstValid = stochLen - 1 + (smoothK - 1) + (smoothD - 1);
  const out: StochRsiPoint[] = [];
  for (let i = firstValid; i < rsiSeries.length; i++) {
    if (isNaN(kLine[i]) || isNaN(dLine[i])) continue;
    // Averaging a 0–100 series can land a few ulps outside it (100.00000000000004,
    // -3.5e-15). Harmless for the plot, but it leaks into the pill readout.
    out.push({ time: rsiSeries[i].time, k: clamp01to100(kLine[i]), d: clamp01to100(dLine[i]) });
  }
  return out;
}

function clamp01to100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** Williams %R — 0 at the top of the range down to -100 at the bottom. */
export function williamsR(candles: Candle[], period = 14): IndicatorPoint[] {
  const hi = highestSeries(highSeries(candles), period);
  const lo = lowestSeries(lowSeries(candles), period);
  const out: IndicatorPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (isNaN(hi[i]) || isNaN(lo[i])) continue;
    const span = hi[i] - lo[i];
    out.push({
      time: candles[i].time,
      value: span === 0 ? 0 : ((candles[i].close - hi[i]) / span) * 100,
    });
  }
  return out;
}

/** Average True Range (Wilder) — `rma(tr, period)`, aligned bar-for-bar. */
export function atr(candles: Candle[], period = 14): IndicatorPoint[] {
  if (candles.length === 0) return [];
  const smoothed = rmaSeries(trueRangeSeries(candles), period);
  const out: IndicatorPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (isNaN(smoothed[i])) continue;
    out.push({ time: candles[i].time, value: smoothed[i] });
  }
  return out;
}

/** Commodity Channel Index over the typical price, with Lambert's 0.015 constant. */
export function cci(candles: Candle[], period = 20): IndicatorPoint[] {
  const tp = hlc3Series(candles);
  const mean = smaSeries(tp, period);
  const out: IndicatorPoint[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    if (isNaN(mean[i])) continue;
    let absDev = 0;
    for (let j = i - period + 1; j <= i; j++) absDev += Math.abs(tp[j] - mean[i]);
    const meanDev = absDev / period;
    out.push({
      time: candles[i].time,
      value: meanDev === 0 ? 0 : (tp[i] - mean[i]) / (0.015 * meanDev),
    });
  }
  return out;
}

/**
 * Money Flow Index — RSI of money flow (typical price × volume), signed by the
 * direction of the typical price. Starts at bar `period` so every bar in the
 * window has a defined change.
 */
export function mfi(candles: Candle[], period = 14): IndicatorPoint[] {
  if (candles.length <= period) return [];
  const tp = hlc3Series(candles);
  const positive = new Array<number>(candles.length).fill(0);
  const negative = new Array<number>(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const flow = tp[i] * candles[i].volume;
    if (tp[i] > tp[i - 1]) positive[i] = flow;
    else if (tp[i] < tp[i - 1]) negative[i] = flow;
  }
  const out: IndicatorPoint[] = [];
  let up = 0;
  let down = 0;
  for (let i = 1; i < candles.length; i++) {
    up += positive[i];
    down += negative[i];
    if (i > period) {
      up -= positive[i - period];
      down -= negative[i - period];
    }
    if (i < period) continue;
    out.push({
      time: candles[i].time,
      value: down === 0 ? 100 : 100 - 100 / (1 + up / down),
    });
  }
  return out;
}
