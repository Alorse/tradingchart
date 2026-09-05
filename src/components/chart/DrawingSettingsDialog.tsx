"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "@/components/ui/color-picker";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useChartStore } from "@/lib/store/chart-store";
import { useDrawings } from "@/lib/supabase/use-drawings";
import type { Drawing, PositionStatKey } from "@/lib/drawings/types";
import { useSymbolInfo } from "@/lib/trading/symbol-info";
import { cn } from "@/lib/utils";
import { TV_PINE } from "@/lib/chart/theme";

const KIND_TITLE: Record<string, string> = {
  hline: "Horizontal line",
  vline: "Vertical line",
  hray: "Horizontal ray",
  trendline: "Trendline",
  ray: "Ray",
  "parallel-channel": "Parallel channel",
  "fib-retracement": "Fibonacci retracement",
  "price-range": "Price range",
  "date-range": "Date range",
  long: "Long position",
  short: "Short position",
  rectangle: "Rectangle",
};

type Tab = "style" | "coordinates" | "inputs";

export function DrawingSettingsDialog() {
  const editingId = useDrawingsStore((s) => s.editingId);
  const setEditing = useDrawingsStore((s) => s.setEditing);
  const drawings = useDrawingsStore((s) => s.drawings);
  const setToolDefault = useChartStore((s) => s.setToolDefault);
  const { update, remove } = useDrawings();

  const drawing = drawings.find((d) => d.id === editingId) ?? null;
  const open = drawing !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && setEditing(null)}>
      <DialogContent className="max-w-sm bg-tv-panel">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            {drawing ? KIND_TITLE[drawing.kind] ?? drawing.kind : ""}
          </DialogTitle>
        </DialogHeader>
        {drawing && (
          <Form
            drawing={drawing}
            onApply={(patch) => {
              void update(drawing.id, patch);
              // Persist style as default so next drawing of this kind reuses it
              const stylePatch: Record<string, unknown> = {};
              if (patch.color !== undefined) stylePatch.color = patch.color;
              if (patch.lineWidth !== undefined) stylePatch.lineWidth = patch.lineWidth;
              if ((patch as Record<string, unknown>).lineStyle !== undefined) stylePatch.lineStyle = (patch as Record<string, unknown>).lineStyle;
              // Position-specific fields
              const p = patch as Record<string, unknown>;
              if (p.stopColor !== undefined) stylePatch.stopColor = p.stopColor;
              if (p.targetColor !== undefined) stylePatch.targetColor = p.targetColor;
              if (p.textColor !== undefined) stylePatch.textColor = p.textColor;
              if (p.textSize !== undefined) stylePatch.textSize = p.textSize;
              if (p.showLabels !== undefined) stylePatch.showLabels = p.showLabels;
              if (p.stopLineWidth !== undefined) stylePatch.stopLineWidth = p.stopLineWidth;
              if (p.stopLineStyle !== undefined) stylePatch.stopLineStyle = p.stopLineStyle;
              if (p.targetLineWidth !== undefined) stylePatch.targetLineWidth = p.targetLineWidth;
              if (p.targetLineStyle !== undefined) stylePatch.targetLineStyle = p.targetLineStyle;
              if (p.priceLabels !== undefined) stylePatch.priceLabels = p.priceLabels;
              if (p.alwaysShowStats !== undefined) stylePatch.alwaysShowStats = p.alwaysShowStats;
              if (p.compactStats !== undefined) stylePatch.compactStats = p.compactStats;
              if (p.statsOverrides !== undefined) stylePatch.statsOverrides = p.statsOverrides;
              // Rectangle-specific fields
              if (p.fillColor !== undefined) stylePatch.fillColor = p.fillColor;
              if (p.fillOpacity !== undefined) stylePatch.fillOpacity = p.fillOpacity;
              if (Object.keys(stylePatch).length > 0) {
                setToolDefault(drawing.kind, stylePatch as Parameters<typeof setToolDefault>[1]);
              }
              setEditing(null);
            }}
            onDelete={() => {
              void remove(drawing.id);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Form({
  drawing,
  onApply,
  onDelete,
  onCancel,
}: {
  drawing: Drawing;
  onApply: (patch: Partial<Drawing>) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const isPosition = drawing.kind === "long" || drawing.kind === "short";
  const isRect = drawing.kind === "rectangle";
  const tabs: Tab[] = isPosition ? ["style", "inputs"] : ["style", "coordinates"];
  const [tab, setTab] = useState<Tab>("style");
  const [color, setColor] = useState<string>(drawing.color ?? TV_PINE.neutral);
  const [lineWidth, setLineWidth] = useState<number>(drawing.lineWidth ?? 1);
  const [lineStyle, setLineStyle] = useState<0 | 1 | 2>(drawing.lineStyle ?? 0);
  const [stopColor, setStopColor] = useState<string>(
    isPosition ? ((drawing as { stopColor?: string }).stopColor ?? TV_PINE.red) : TV_PINE.red,
  );
  const [targetColor, setTargetColor] = useState<string>(
    isPosition ? ((drawing as { targetColor?: string }).targetColor ?? TV_PINE.green) : TV_PINE.green,
  );
  const [textColor, setTextColor] = useState<string>(
    isPosition ? ((drawing as { textColor?: string }).textColor ?? TV_PINE.neutral) : TV_PINE.neutral,
  );
  const [textSize, setTextSize] = useState<number>(
    isPosition ? ((drawing as { textSize?: number }).textSize ?? 11) : 11,
  );
  const [showLabels, setShowLabels] = useState<boolean>(
    isPosition ? ((drawing as { showLabels?: boolean }).showLabels ?? false) : false,
  );
  const [stopLineWidth, setStopLineWidth] = useState<number>(
    isPosition ? ((drawing as { stopLineWidth?: number }).stopLineWidth ?? 1.5) : 1.5,
  );
  const [stopLineStyle, setStopLineStyle] = useState<0 | 1 | 2>(
    isPosition ? ((drawing as { stopLineStyle?: 0 | 1 | 2 }).stopLineStyle ?? 0) : 0,
  );
  const [targetLineWidth, setTargetLineWidth] = useState<number>(
    isPosition ? ((drawing as { targetLineWidth?: number }).targetLineWidth ?? 1.5) : 1.5,
  );
  const [targetLineStyle, setTargetLineStyle] = useState<0 | 1 | 2>(
    isPosition ? ((drawing as { targetLineStyle?: 0 | 1 | 2 }).targetLineStyle ?? 0) : 0,
  );
  const [priceLabels, setPriceLabels] = useState<boolean>(
    isPosition ? ((drawing as { priceLabels?: boolean }).priceLabels ?? false) : false,
  );
  const [alwaysShowStats, setAlwaysShowStats] = useState<boolean>(
    isPosition ? ((drawing as { alwaysShowStats?: boolean }).alwaysShowStats ?? false) : false,
  );
  const [compactStats, setCompactStats] = useState<boolean>(
    isPosition ? ((drawing as { compactStats?: boolean }).compactStats ?? false) : false,
  );
  const [statsOverrides, setStatsOverrides] = useState<Partial<Record<PositionStatKey, boolean>>>(
    isPosition ? ((drawing as { statsOverrides?: Partial<Record<PositionStatKey, boolean>> }).statsOverrides ?? {}) : {},
  );
  const [fillColor, setFillColor] = useState<string>(
    isRect ? ((drawing as { fillColor?: string }).fillColor ?? TV_PINE.blue) : TV_PINE.blue,
  );
  const [fillOpacity, setFillOpacity] = useState<number>(
    isRect ? ((drawing as { fillOpacity?: number }).fillOpacity ?? 0.1) : 0.1,
  );

  // Inputs tab state (positions only)
  const [entry, setEntry] = useState<number>(isPosition ? (drawing as { entry: number }).entry : 0);
  const [target, setTarget] = useState<number>(isPosition ? (drawing as { target: number }).target : 0);
  const [stop, setStop] = useState<number>(isPosition ? (drawing as { stop: number }).stop : 0);
  const [accountSize, setAccountSize] = useState<number | undefined>(
    isPosition ? (drawing as { accountSize?: number }).accountSize : undefined,
  );
  const [risk, setRisk] = useState<number | undefined>(
    isPosition ? (drawing as { risk?: number }).risk : undefined,
  );
  const [riskIsPercent, setRiskIsPercent] = useState<boolean>(
    isPosition ? ((drawing as { riskIsPercent?: boolean }).riskIsPercent ?? false) : false,
  );
  const [leverage, setLeverage] = useState<number | undefined>(
    isPosition ? (drawing as { leverage?: number }).leverage : undefined,
  );
  const [lotSize, setLotSize] = useState<number>(
    isPosition ? ((drawing as { lotSize?: number }).lotSize ?? 1) : 1,
  );
  const [qtyPrecision, setQtyPrecision] = useState<number>(
    isPosition ? ((drawing as { qtyPrecision?: number }).qtyPrecision ?? 3) : 3,
  );
  // Applies to future drawings of this tool, not this one — read from/written
  // to `toolDefaults`, never to the drawing's own persisted fields.
  const [defaultRiskReward, setDefaultRiskReward] = useState<number>(1);
  const [defaultZoneDistancePct, setDefaultZoneDistancePct] = useState<number>(16);

  const symbolInfo = useSymbolInfo(drawing.symbol);
  const tickSize = symbolInfo.tickSize > 0 ? symbolInfo.tickSize : 0.01;

  useEffect(() => {
    setColor(drawing.color ?? TV_PINE.neutral);
    setLineWidth(drawing.lineWidth ?? 1);
    setLineStyle(drawing.lineStyle ?? 0);
    if (drawing.kind === "long" || drawing.kind === "short") {
      setStopColor(drawing.stopColor ?? TV_PINE.red);
      setTargetColor(drawing.targetColor ?? TV_PINE.green);
      setTextColor(drawing.textColor ?? TV_PINE.neutral);
      setTextSize(drawing.textSize ?? 11);
      setShowLabels(drawing.showLabels ?? false);
      setStopLineWidth(drawing.stopLineWidth ?? 1.5);
      setStopLineStyle(drawing.stopLineStyle ?? 0);
      setTargetLineWidth(drawing.targetLineWidth ?? 1.5);
      setTargetLineStyle(drawing.targetLineStyle ?? 0);
      setPriceLabels(drawing.priceLabels ?? false);
      setAlwaysShowStats(drawing.alwaysShowStats ?? false);
      setCompactStats(drawing.compactStats ?? false);
      setStatsOverrides(drawing.statsOverrides ?? {});
      setEntry(drawing.entry);
      setTarget(drawing.target);
      setStop(drawing.stop);
      setAccountSize(drawing.accountSize);
      setRisk(drawing.risk);
      setRiskIsPercent(drawing.riskIsPercent ?? false);
      setLeverage(drawing.leverage);
      setLotSize(drawing.lotSize ?? 1);
      setQtyPrecision(drawing.qtyPrecision ?? 3);
      const toolDefaults = useChartStore.getState().toolDefaults[drawing.kind] as
        | { defaultRiskReward?: number; defaultZoneDistancePct?: number }
        | undefined;
      setDefaultRiskReward(toolDefaults?.defaultRiskReward ?? 1);
      setDefaultZoneDistancePct(toolDefaults?.defaultZoneDistancePct ?? 16);
    }
    if (drawing.kind === "rectangle") {
      setFillColor(drawing.fillColor ?? TV_PINE.blue);
      setFillOpacity(drawing.fillOpacity ?? 0.1);
    }
  }, [drawing]);

  function apply() {
    const patch: Partial<Drawing> = {} as Partial<Drawing>;
    patch.color = color;
    patch.lineWidth = lineWidth;
    (patch as Record<string, unknown>).lineStyle = lineStyle;
    if (isPosition) {
      const p = patch as Record<string, unknown>;
      p.stopColor = stopColor;
      p.targetColor = targetColor;
      p.textColor = textColor;
      p.textSize = textSize;
      p.showLabels = showLabels;
      p.stopLineWidth = stopLineWidth;
      p.stopLineStyle = stopLineStyle;
      p.targetLineWidth = targetLineWidth;
      p.targetLineStyle = targetLineStyle;
      p.priceLabels = priceLabels;
      p.alwaysShowStats = alwaysShowStats;
      p.compactStats = compactStats;
      p.statsOverrides = statsOverrides;
      p.entry = entry;
      p.target = target;
      p.stop = stop;
      p.accountSize = accountSize;
      p.risk = risk;
      p.riskIsPercent = riskIsPercent;
      p.leverage = leverage;
      p.lotSize = lotSize;
      p.qtyPrecision = qtyPrecision;
    }
    if (isRect) {
      (patch as Record<string, unknown>).fillColor = fillColor;
      (patch as Record<string, unknown>).fillOpacity = fillOpacity;
    }
    if (isPosition) {
      useChartStore.getState().setToolDefault(drawing.kind, {
        defaultRiskReward,
        defaultZoneDistancePct,
      });
    }
    onApply(patch);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex border-b border-tv-border">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
              tab === t
                ? "border-b-2 border-tv-blue text-tv-text"
                : "text-tv-text-muted hover:text-tv-text",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "style" && (
        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
          {isPosition ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-tv-text">Entry line</span>
                <ColorPicker value={color} onChange={setColor} />
              </div>
              <LineStyleRow width={lineWidth} style={lineStyle} onWidth={setLineWidth} onStyle={setLineStyle} />

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-tv-text">Target line</span>
                <ColorPicker value={targetColor} onChange={setTargetColor} />
              </div>
              <LineStyleRow width={targetLineWidth} style={targetLineStyle} onWidth={setTargetLineWidth} onStyle={setTargetLineStyle} />

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-tv-text">Stop line</span>
                <ColorPicker value={stopColor} onChange={setStopColor} />
              </div>
              <LineStyleRow width={stopLineWidth} style={stopLineStyle} onWidth={setStopLineWidth} onStyle={setStopLineStyle} />

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-tv-text">Text color</span>
                <ColorPicker value={textColor} onChange={setTextColor} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-tv-text">Text size</span>
                <Input
                  type="number"
                  value={textSize}
                  onChange={(e) => setTextSize(parseInt(e.target.value) || 11)}
                  className="w-20 bg-tv-bg text-right tabular-nums"
                />
              </div>

              <div className="mt-1 border-t border-tv-border pt-2 text-[10px] font-semibold uppercase tracking-wide text-tv-text-dim">
                Display
              </div>
              <CheckRow label="Price-axis labels" checked={priceLabels} onChange={setPriceLabels} />
              <CheckRow label="Always show stats" checked={alwaysShowStats} onChange={setAlwaysShowStats} />
              <CheckRow label="Compact stats" checked={compactStats} onChange={setCompactStats} />
              <CheckRow label="Always show labels" checked={showLabels} onChange={setShowLabels} />

              <div className="mt-1 border-t border-tv-border pt-2 text-[10px] font-semibold uppercase tracking-wide text-tv-text-dim">
                Stats shown
              </div>
              {STAT_TOGGLES.map(({ key, label }) => (
                <CheckRow
                  key={key}
                  label={label}
                  checked={statsOverrides[key] !== false}
                  onChange={(v) =>
                    setStatsOverrides((s) => ({ ...s, [key]: v }))
                  }
                />
              ))}
            </>
          ) : (
            <>
              <ColorRow label={isRect ? "Border color" : "Color"} value={color} onChange={setColor} />
              <LineStyleRow width={lineWidth} style={lineStyle} onWidth={setLineWidth} onStyle={setLineStyle} />
              {isRect && (
                <>
                  <ColorRow label="Fill color" value={fillColor} onChange={setFillColor} />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-tv-text">Fill opacity</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(fillOpacity * 100)}
                        onChange={(e) => setFillOpacity(parseInt(e.target.value) / 100)}
                        className="w-24 accent-tv-blue"
                      />
                      <span className="w-8 text-right text-xs tabular-nums text-tv-text-muted">
                        {Math.round(fillOpacity * 100)}%
                      </span>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {tab === "coordinates" && <CoordinatesTab drawing={drawing} onApply={onApply} />}

      {tab === "inputs" && isPosition && (
        <PositionInputsTab
          tickSize={tickSize}
          entry={entry} target={target} stop={stop}
          onEntry={setEntry} onTarget={setTarget} onStop={setStop}
          accountSize={accountSize} onAccountSize={setAccountSize}
          risk={risk} onRisk={setRisk}
          riskIsPercent={riskIsPercent} onRiskIsPercent={setRiskIsPercent}
          leverage={leverage} onLeverage={setLeverage}
          lotSize={lotSize} onLotSize={setLotSize}
          qtyPrecision={qtyPrecision} onQtyPrecision={setQtyPrecision}
          defaultRiskReward={defaultRiskReward} onDefaultRiskReward={setDefaultRiskReward}
          defaultZoneDistancePct={defaultZoneDistancePct} onDefaultZoneDistancePct={setDefaultZoneDistancePct}
        />
      )}

      <div className="mt-2 flex items-center justify-between border-t border-tv-border pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-tv-red hover:bg-tv-red/10 hover:text-tv-red"
        >
          Delete
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-tv-text-muted hover:text-tv-text"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={apply}
            className="bg-tv-blue hover:bg-tv-blue/90"
          >
            Ok
          </Button>
        </div>
      </div>
    </div>
  );
}

const STAT_TOGGLES: { key: PositionStatKey; label: string }[] = [
  { key: "openPnl", label: "Open P&L" },
  { key: "qty", label: "Qty" },
  { key: "rr", label: "R:R" },
  { key: "profitLoss", label: "Profit/Loss $" },
  { key: "pct", label: "%" },
  { key: "ticks", label: "Ticks" },
  { key: "balance", label: "Balance after" },
];

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-xs text-tv-text">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-tv-blue"
      />
    </label>
  );
}

function LineStyleRow({
  width,
  style,
  onWidth,
  onStyle,
}: {
  width: number;
  style: 0 | 1 | 2;
  onWidth: (w: number) => void;
  onStyle: (s: 0 | 1 | 2) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pl-2">
      <div className="flex items-center gap-1">
        {[1, 1.5, 2, 3].map((w) => (
          <button
            key={w}
            onClick={() => onWidth(w)}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded border text-[10px]",
              width === w
                ? "border-tv-blue bg-tv-blue/15 text-tv-blue-text"
                : "border-tv-border text-tv-text-muted hover:bg-tv-panel-hover",
            )}
          >
            {w}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        {([0, 1, 2] as const).map((s) => (
          <button
            key={s}
            onClick={() => onStyle(s)}
            title={s === 0 ? "Solid" : s === 1 ? "Dashed" : "Dotted"}
            className={cn(
              "flex h-6 w-9 items-center justify-center rounded border",
              style === s
                ? "border-tv-blue bg-tv-blue/15"
                : "border-tv-border hover:bg-tv-panel-hover",
            )}
          >
            <svg width="22" height="2" viewBox="0 0 22 2">
              <line
                x1="0" y1="1" x2="22" y2="1"
                stroke="currentColor" strokeWidth="2"
                strokeDasharray={s === 1 ? "6 3" : s === 2 ? "2 3" : "none"}
              />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-tv-text">{label}</span>
      <ColorPicker value={value} onChange={onChange} />
    </div>
  );
}

function CoordinatesTab({
  drawing,
  onApply,
}: {
  drawing: Drawing;
  onApply: (patch: Partial<Drawing>) => void;
}) {
  // Show editable price fields for whatever anchors the drawing has
  // (per-kind, since the data model is a discriminated union)
  switch (drawing.kind) {
    case "hline":
      return (
        <PriceField
          label="Price"
          value={drawing.price}
          onChange={(v) => onApply({ price: v } as Partial<Drawing>)}
        />
      );
    case "hray":
      return (
        <PriceField
          label="Price"
          value={drawing.anchor.price}
          onChange={(v) =>
            onApply({
              anchor: { ...drawing.anchor, price: v },
            } as Partial<Drawing>)
          }
        />
      );
    case "trendline":
    case "ray":
    case "fib-retracement":
      return (
        <div className="flex flex-col gap-2">
          <PriceField
            label="Price A"
            value={drawing.a.price}
            onChange={(v) =>
              onApply({ a: { ...drawing.a, price: v } } as Partial<Drawing>)
            }
          />
          <PriceField
            label="Price B"
            value={drawing.b.price}
            onChange={(v) =>
              onApply({ b: { ...drawing.b, price: v } } as Partial<Drawing>)
            }
          />
        </div>
      );
    case "price-range":
      return (
        <div className="flex flex-col gap-2">
          <PriceField
            label="Price A"
            value={drawing.priceA}
            onChange={(v) => onApply({ priceA: v } as Partial<Drawing>)}
          />
          <PriceField
            label="Price B"
            value={drawing.priceB}
            onChange={(v) => onApply({ priceB: v } as Partial<Drawing>)}
          />
        </div>
      );
    default:
      return (
        <p className="text-xs text-tv-text-muted">
          Coordinate editing not available for this drawing.
        </p>
      );
  }
}

/**
 * Sizing inputs + entry/target/stop prices for the long/short drawing tools.
 * Unlike `CoordinatesTab` (which applies each field immediately on blur and
 * closes the dialog), every field here writes to `Form`'s local draft state
 * and is only committed once, by the shared Ok button — with a dozen+
 * fields, applying (and closing) on the first blur would make the tab
 * unusable for entering more than one value.
 */
function PositionInputsTab({
  tickSize,
  entry, target, stop,
  onEntry, onTarget, onStop,
  accountSize, onAccountSize,
  risk, onRisk,
  riskIsPercent, onRiskIsPercent,
  leverage, onLeverage,
  lotSize, onLotSize,
  qtyPrecision, onQtyPrecision,
  defaultRiskReward, onDefaultRiskReward,
  defaultZoneDistancePct, onDefaultZoneDistancePct,
}: {
  tickSize: number;
  entry: number; target: number; stop: number;
  onEntry: (v: number) => void; onTarget: (v: number) => void; onStop: (v: number) => void;
  accountSize?: number; onAccountSize: (v: number | undefined) => void;
  risk?: number; onRisk: (v: number | undefined) => void;
  riskIsPercent: boolean; onRiskIsPercent: (v: boolean) => void;
  leverage?: number; onLeverage: (v: number | undefined) => void;
  lotSize: number; onLotSize: (v: number) => void;
  qtyPrecision: number; onQtyPrecision: (v: number) => void;
  defaultRiskReward: number; onDefaultRiskReward: (v: number) => void;
  defaultZoneDistancePct: number; onDefaultZoneDistancePct: (v: number) => void;
}) {
  return (
    <div className="flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-tv-text-dim">
        Position sizing
      </div>
      <OptionalNumberField label="Account size" value={accountSize} onChange={onAccountSize} placeholder="Not set" />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-tv-text">Risk</span>
        <div className="flex items-center gap-1">
          <DraftNumberInput value={risk} onChange={onRisk} placeholder="Not set" className="w-24" />
          <div className="flex items-center rounded border border-tv-border">
            <button
              onClick={() => onRiskIsPercent(false)}
              className={cn(
                "flex h-7 w-7 items-center justify-center text-[11px]",
                !riskIsPercent ? "bg-tv-blue/15 text-tv-blue-text" : "text-tv-text-muted",
              )}
            >
              $
            </button>
            <button
              onClick={() => onRiskIsPercent(true)}
              className={cn(
                "flex h-7 w-7 items-center justify-center text-[11px]",
                riskIsPercent ? "bg-tv-blue/15 text-tv-blue-text" : "text-tv-text-muted",
              )}
            >
              %
            </button>
          </div>
        </div>
      </div>
      <OptionalNumberField label="Leverage" value={leverage} onChange={onLeverage} placeholder="Not set" />
      <NumberField label="Lot size" value={lotSize} onChange={onLotSize} />
      <NumberField label="Qty precision" value={qtyPrecision} onChange={(v) => onQtyPrecision(Math.max(0, Math.round(v)))} />

      <div className="mt-1 border-t border-tv-border pt-2 text-[10px] font-semibold uppercase tracking-wide text-tv-text-dim">
        Prices
      </div>
      <NumberField label="Entry price" value={entry} onChange={onEntry} />
      <PricePlusTicks label="Profit (target)" entry={entry} level={target} tickSize={tickSize} onLevel={onTarget} />
      <PricePlusTicks label="Stop" entry={entry} level={stop} tickSize={tickSize} onLevel={onStop} />

      <div className="mt-1 border-t border-tv-border pt-2 text-[10px] font-semibold uppercase tracking-wide text-tv-text-dim">
        Defaults for new positions
      </div>
      <NumberField label="Risk:reward" value={defaultRiskReward} onChange={(v) => onDefaultRiskReward(v > 0 ? v : 1)} />
      <NumberField
        label="Zone distance %"
        value={defaultZoneDistancePct}
        onChange={(v) => onDefaultZoneDistancePct(v > 0 ? v : 16)}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-tv-text">{label}</span>
      <Input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = parseFloat(draft);
          if (!isNaN(n)) onChange(n);
        }}
        className="w-32 bg-tv-bg text-right tabular-nums"
      />
    </label>
  );
}

/** Same as `NumberField`, but `undefined` is a valid ("not set") value. */
function OptionalNumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-tv-text">{label}</span>
      <DraftNumberInput value={value} onChange={onChange} placeholder={placeholder} className="w-32" />
    </label>
  );
}

function DraftNumberInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  useEffect(() => setDraft(value === undefined ? "" : String(value)), [value]);
  return (
    <Input
      type="number"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() === "") {
          onChange(undefined);
          return;
        }
        const n = parseFloat(draft);
        if (!isNaN(n)) onChange(n);
      }}
      className={cn("bg-tv-bg text-right tabular-nums", className)}
    />
  );
}

/** Paired Price + Ticks fields — editing either recomputes the other via
 *  `tickSize`, both driving the same `level` (target or stop) price. */
function PricePlusTicks({
  label,
  entry,
  level,
  tickSize,
  onLevel,
}: {
  label: string;
  entry: number;
  level: number;
  tickSize: number;
  onLevel: (v: number) => void;
}) {
  const ticks = tickSize > 0 ? Math.round((level - entry) / tickSize) : 0;
  const [priceDraft, setPriceDraft] = useState(String(level));
  const [ticksDraft, setTicksDraft] = useState(String(ticks));
  useEffect(() => setPriceDraft(String(level)), [level]);
  useEffect(() => setTicksDraft(String(ticks)), [ticks]);

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-tv-text">{label}</span>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          value={priceDraft}
          onChange={(e) => setPriceDraft(e.target.value)}
          onBlur={() => {
            const n = parseFloat(priceDraft);
            if (!isNaN(n)) onLevel(n);
          }}
          className="w-24 bg-tv-bg text-right tabular-nums"
        />
        <Input
          type="number"
          value={ticksDraft}
          onChange={(e) => setTicksDraft(e.target.value)}
          onBlur={() => {
            const n = parseFloat(ticksDraft);
            if (!isNaN(n) && tickSize > 0) onLevel(entry + n * tickSize);
          }}
          className="w-20 bg-tv-bg text-right tabular-nums"
          title="Ticks from entry"
        />
      </div>
    </div>
  );
}

function PriceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState(value.toString());
  useEffect(() => {
    setDraft(value.toString());
  }, [value]);
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-tv-text">{label}</span>
      <Input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = parseFloat(draft);
          if (!isNaN(n)) onChange(n);
        }}
        className="w-32 bg-tv-bg text-right tabular-nums"
      />
    </label>
  );
}
