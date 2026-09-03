/**
 * Declarative specs for the "plain" sub-pane oscillators — the ones that are
 * fully described by *some lines over time* plus *some horizontal guides*.
 *
 * RSI, MACD, ADX, Squeeze and VuManChu each need bespoke rendering (histograms,
 * markers, area fills, an SVG overlay), so they stay as hand-written effects in
 * `PriceChart`. Everything here, though, differs only in its maths and its
 * colours, and five near-identical copies of the same create/teardown/update
 * effect is exactly the kind of drift this file exists to prevent: one spec
 * drives series creation, data updates, the legend pill and the settings form.
 */

import type { Candle } from "@/lib/binance/types";
import type { IndicatorConfig, SubPaneKey } from "@/lib/store/chart-store";
import { INDICATOR_COLORS } from "@/lib/store/chart-store";
import { atr, cci, mfi, stochRsi, williamsR } from "./index";

/** The five panes this module drives. */
export type SimpleOscKey = Extract<SubPaneKey, "stochrsi" | "williamsr" | "atr" | "cci" | "mfi">;

export interface OscLineSpec {
  color: string;
  width: 1 | 2 | 3 | 4;
}

export interface OscData {
  times: number[];
  /** One array of values per entry in `lines`, aligned to `times`. */
  lines: number[][];
}

export interface SimpleOscSpec {
  key: SimpleOscKey;
  /** Legend text on the pill, e.g. "Stoch RSI 14, 14, 3, 3". */
  name: (cfg: IndicatorConfig) => string;
  lines: OscLineSpec[];
  /** Dashed horizontal reference levels, kept inside the pane's autoscale. */
  guides: number[];
  compute: (candles: Candle[], cfg: IndicatorConfig) => OscData;
  /** How the pill renders the latest value of the first line. */
  format: (v: number) => string;
}

const twoDecimals = (v: number) => v.toFixed(2);

export const SIMPLE_OSCILLATORS: SimpleOscSpec[] = [
  {
    key: "stochrsi",
    name: (c) => `Stoch RSI ${c.stochRsiLen}, ${c.stochRsiStochLen}, ${c.stochRsiK}, ${c.stochRsiD}`,
    lines: [
      { color: INDICATOR_COLORS.stochrsi, width: 1 },
      { color: "#ff6d00", width: 1 },
    ],
    guides: [20, 80],
    compute: (candles, cfg) => {
      const pts = stochRsi(candles, cfg.stochRsiLen, cfg.stochRsiStochLen, cfg.stochRsiK, cfg.stochRsiD);
      return {
        times: pts.map((p) => p.time),
        lines: [pts.map((p) => p.k), pts.map((p) => p.d)],
      };
    },
    format: twoDecimals,
  },
  {
    key: "williamsr",
    name: (c) => `Williams %R ${c.williamsRPeriod}`,
    lines: [{ color: INDICATOR_COLORS.williamsr, width: 1 }],
    guides: [-20, -80],
    compute: (candles, cfg) => {
      const pts = williamsR(candles, cfg.williamsRPeriod);
      return { times: pts.map((p) => p.time), lines: [pts.map((p) => p.value)] };
    },
    format: twoDecimals,
  },
  {
    key: "atr",
    name: (c) => `ATR ${c.atrPeriod}`,
    lines: [{ color: INDICATOR_COLORS.atr, width: 2 }],
    guides: [],
    compute: (candles, cfg) => {
      const pts = atr(candles, cfg.atrPeriod);
      return { times: pts.map((p) => p.time), lines: [pts.map((p) => p.value)] };
    },
    // ATR is a price distance, so it needs more precision than an oscillator.
    format: (v) => (Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(4)),
  },
  {
    key: "cci",
    name: (c) => `CCI ${c.cciPeriod}`,
    lines: [{ color: INDICATOR_COLORS.cci, width: 1 }],
    guides: [-100, 100],
    compute: (candles, cfg) => {
      const pts = cci(candles, cfg.cciPeriod);
      return { times: pts.map((p) => p.time), lines: [pts.map((p) => p.value)] };
    },
    format: twoDecimals,
  },
  {
    key: "mfi",
    name: (c) => `MFI ${c.mfiPeriod}`,
    lines: [{ color: INDICATOR_COLORS.mfi, width: 1 }],
    guides: [20, 80],
    compute: (candles, cfg) => {
      const pts = mfi(candles, cfg.mfiPeriod);
      return { times: pts.map((p) => p.time), lines: [pts.map((p) => p.value)] };
    },
    format: twoDecimals,
  },
];

export const SIMPLE_OSC_KEYS: SimpleOscKey[] = SIMPLE_OSCILLATORS.map((s) => s.key);

export function simpleOscSpec(key: string): SimpleOscSpec | undefined {
  return SIMPLE_OSCILLATORS.find((s) => s.key === key);
}
