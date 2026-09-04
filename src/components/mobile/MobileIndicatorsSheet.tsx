"use client";

import { Check, Plus, Settings2 } from "lucide-react";
import { useChartStore, type IndicatorConfig, type IndicatorKey } from "@/lib/store/chart-store";
import { useMobileStore } from "@/lib/store/mobile-store";
import { MobileSheet } from "./MobileSheet";
import { cn } from "@/lib/utils";

/**
 * Mobile-friendly indicators list — replaces the desktop IndicatorMenu
 * dropdown on touch. Adding/toggling indicators lives here; hiding,
 * removing, and per-instance settings (including for each added EMA) are
 * already available from the on-canvas pill row `PriceChart.tsx` renders
 * for every active indicator — that component is shared with desktop, so
 * it works here unchanged.
 */

interface Entry {
  key: IndicatorKey;
  label: (cfg: IndicatorConfig) => string;
  group: string;
}

const ENTRIES: Entry[] = [
  { key: "volume",    group: "Volume",      label: () => "Volume" },
  { key: "obv",       group: "Volume",      label: () => "On-Balance Volume (OBV)" },
  { key: "vrvp",      group: "Volume",      label: () => "Volume Profile (Visible Range)" },
  { key: "mfi",       group: "Volume",      label: (c) => `Money Flow Index (${c.mfiPeriod})` },
  { key: "rsi",       group: "Oscillators", label: (c) => `RSI (${c.rsi})` },
  { key: "macd",      group: "Oscillators", label: (c) => `MACD (${c.macdFast}, ${c.macdSlow}, ${c.macdSignal})` },
  { key: "stochrsi",  group: "Oscillators", label: (c) => `Stochastic RSI (${c.stochRsiLen}, ${c.stochRsiStochLen}, ${c.stochRsiK}, ${c.stochRsiD})` },
  { key: "williamsr", group: "Oscillators", label: (c) => `Williams %R (${c.williamsRPeriod})` },
  { key: "cci",       group: "Oscillators", label: (c) => `CCI (${c.cciPeriod})` },
  { key: "adx",       group: "Trend",       label: (c) => `ADX (${c.adx})` },
  { key: "bb",        group: "Volatility",  label: (c) => `Bollinger Bands (${c.bbPeriod}, ${c.bbMult})` },
  { key: "atr",       group: "Volatility",  label: (c) => `Average True Range (${c.atrPeriod})` },
  { key: "vwap",      group: "Overlays",    label: () => "VWAP" },
  { key: "squeeze",   group: "Momentum",    label: () => "Squeeze Momentum [LazyBear]" },
  { key: "vumanchu",  group: "Momentum",    label: () => "VuManChu Cipher B + Div" },
  { key: "keylevels", group: "Levels",      label: () => "Key Levels (W,M,Q,Y)" },
];

export function MobileIndicatorsSheet() {
  const indicators = useChartStore((s) => s.indicators);
  const config = useChartStore((s) => s.config);
  const toggle = useChartStore((s) => s.toggleIndicator);
  const setSettingsTarget = useChartStore((s) => s.setSettingsTarget);
  const userEMAs = useChartStore((s) => s.userEMAs);
  const addUserEMA = useChartStore((s) => s.addUserEMA);
  const closeSheet = useMobileStore((s) => s.closeSheet);

  const groups = ENTRIES.reduce<Record<string, Entry[]>>((acc, e) => {
    (acc[e.group] ||= []).push(e);
    return acc;
  }, {});

  return (
    <MobileSheet title="Indicators" onClose={closeSheet}>
      <section>
        <h3 className="bg-tv-panel/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
          Moving averages
        </h3>
        <button
          onClick={() => addUserEMA()}
          className="flex w-full items-center gap-3 border-b border-tv-border/60 px-3 py-3 text-left active:bg-tv-panel-hover"
        >
          <Plus className="h-4 w-4 text-tv-blue-text" />
          <span className="flex-1 text-sm">EMA — Exponential Moving Average</span>
        </button>
        {userEMAs.length > 0 && (
          <p className="border-b border-tv-border/60 px-3 py-2 text-[10px] text-tv-text-muted">
            {userEMAs.length} EMA{userEMAs.length === 1 ? "" : "s"} on chart — hide, remove, or configure
            each from its pill on the chart itself.
          </p>
        )}
      </section>
      {Object.entries(groups).map(([group, entries]) => (
        <section key={group}>
          <h3 className="bg-tv-panel/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
            {group}
          </h3>
          {entries.map((e) => {
            const on = indicators[e.key];
            const label = e.label(config);
            return (
              <div
                key={e.key}
                className="flex items-center gap-3 border-b border-tv-border/60 px-3 py-3"
              >
                <button
                  onClick={() => toggle(e.key)}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded border",
                    on ? "border-tv-blue bg-tv-blue text-white" : "border-tv-border bg-tv-bg",
                  )}
                  aria-pressed={on}
                  aria-label={`${on ? "Disable" : "Enable"} ${label}`}
                >
                  {on && <Check className="h-3.5 w-3.5" />}
                </button>
                <span className="flex-1 text-sm">{label}</span>
                {on && (
                  <button
                    onClick={() => {
                      setSettingsTarget(e.key);
                      closeSheet();
                    }}
                    aria-label={`Settings for ${label}`}
                    className="rounded p-1.5 text-tv-text-muted active:bg-tv-panel-hover"
                  >
                    <Settings2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </MobileSheet>
  );
}
