"use client";

import { Activity, Check, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChartStore, type IndicatorKey } from "@/lib/store/chart-store";

import type { IndicatorConfig } from "@/lib/store/chart-store";

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

export function IndicatorMenu() {
  const indicators = useChartStore((s) => s.indicators);
  const config = useChartStore((s) => s.config);
  const toggle = useChartStore((s) => s.toggleIndicator);
  const userEMAs = useChartStore((s) => s.userEMAs);
  const addUserEMA = useChartStore((s) => s.addUserEMA);

  const groups = ENTRIES.reduce<Record<string, Entry[]>>((acc, i) => {
    (acc[i.group] ||= []).push(i);
    return acc;
  }, {});

  const activeCount =
    Object.values(indicators).filter(Boolean).length + userEMAs.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs text-tv-text hover:bg-tv-panel-hover">
        <Activity className="h-3.5 w-3.5" />
        <span>Indicators</span>
        {activeCount > 0 && (
          <span className="ml-1 rounded bg-tv-blue/20 px-1.5 py-0.5 text-[10px] font-semibold text-tv-blue-text">
            {activeCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 bg-tv-panel">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-tv-text-muted">
            Moving averages
          </DropdownMenuLabel>
          <DropdownMenuItem
            closeOnClick={false}
            onClick={() => addUserEMA()}
            className="flex items-center justify-between text-xs"
          >
            <span>EMA — Exponential Moving Average</span>
            <Plus className="h-3.5 w-3.5 text-tv-blue-text" />
          </DropdownMenuItem>
          {userEMAs.length > 0 && (
            <div className="px-2 py-1 text-[10px] text-tv-text-muted">
              {userEMAs.length} EMA{userEMAs.length === 1 ? "" : "s"} on chart
            </div>
          )}
        </DropdownMenuGroup>
        {Object.entries(groups).map(([group, items]) => (
          <DropdownMenuGroup key={group}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-tv-text-muted">
              {group}
            </DropdownMenuLabel>
            {items.map((i) => (
              <DropdownMenuItem
                key={i.key}
                closeOnClick={false}
                onClick={() => toggle(i.key)}
                className="flex items-center justify-between text-xs"
              >
                <span>{i.label(config)}</span>
                {indicators[i.key] && <Check className="h-3.5 w-3.5 text-tv-blue-text" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
