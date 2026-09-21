"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useChartStore } from "@/lib/store/chart-store";
import { useDrawings } from "@/lib/supabase/use-drawings";
import type {
  Drawing,
  HorzTextAlign,
  PositionStatKey,
  VertTextAlign,
} from "@/lib/drawings/types";
import { useSymbolInfo } from "@/lib/trading/symbol-info";
import { deriveQuoteCurrency } from "@/lib/drawings/position-math";
import { pickStyle, SETTINGS_STYLE_FIELDS } from "@/lib/drawings/style";
import { resolveTextLabel, type ResolvedTextLabel } from "@/lib/drawings/text-label";
import { cn } from "@/lib/utils";
import {
  formatDecimalInput,
  formatPriceInput,
  roundDecimalForInput,
  roundPriceForInput,
  stepDecimals,
} from "@/lib/format";
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
  arrow: "Arrow",
};

type Tab = "style" | "text" | "coordinates" | "inputs";

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
      <DialogContent className="max-w-sm bg-tv-panel" mobileFullScreen>
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
              // Persist style as default so next drawing of this kind reuses
              // it. The field list lives in `lib/drawings/style.ts` next to
              // the toolbar's, rather than as an if-chain that has to be
              // extended by hand for every new style field.
              const stylePatch = pickStyle(patch, SETTINGS_STYLE_FIELDS);
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
  // Narrowed once so the per-field initializers below can read the union's
  // position/rectangle members directly, instead of each casting its own
  // `drawing as { field?: T }` shape back out of the union.
  const pos = drawing.kind === "long" || drawing.kind === "short" ? drawing : null;
  const rect = drawing.kind === "rectangle" ? drawing : null;
  const isPosition = pos !== null;
  const isRect = rect !== null;
  // Null for kinds without a text label, which therefore get no Text tab.
  const initialTextLabel = resolveTextLabel(drawing, drawing.color ?? TV_PINE.blue);
  const hasText = initialTextLabel !== null;
  const tabs: Tab[] = isPosition
    ? ["inputs", "style"]
    : hasText
      ? ["style", "text", "coordinates"]
      : ["style", "coordinates"];
  const [tab, setTab] = useState<Tab>(() => (isPosition ? "inputs" : "style"));
  const [color, setColor] = useState<string>(drawing.color ?? TV_PINE.neutral);
  const [lineWidth, setLineWidth] = useState<number>(drawing.lineWidth ?? 1);
  const [lineStyle, setLineStyle] = useState<0 | 1 | 2>(drawing.lineStyle ?? 0);
  const [stopColor, setStopColor] = useState<string>(
    pos?.stopColor ?? TV_PINE.red,
  );
  const [targetColor, setTargetColor] = useState<string>(
    pos?.targetColor ?? TV_PINE.green,
  );
  const [textColor, setTextColor] = useState<string>(
    pos?.textColor ?? TV_PINE.neutral,
  );
  const [textSize, setTextSize] = useState<number>(
    pos?.textSize ?? 11,
  );
  const [showLabels, setShowLabels] = useState<boolean>(
    pos?.showLabels ?? false,
  );
  const [stopLineWidth, setStopLineWidth] = useState<number>(
    pos?.stopLineWidth ?? 1.5,
  );
  const [stopLineStyle, setStopLineStyle] = useState<0 | 1 | 2>(
    pos?.stopLineStyle ?? 0,
  );
  const [targetLineWidth, setTargetLineWidth] = useState<number>(
    pos?.targetLineWidth ?? 1.5,
  );
  const [targetLineStyle, setTargetLineStyle] = useState<0 | 1 | 2>(
    pos?.targetLineStyle ?? 0,
  );
  const [priceLabels, setPriceLabels] = useState<boolean>(
    pos?.priceLabels ?? false,
  );
  const [alwaysShowStats, setAlwaysShowStats] = useState<boolean>(
    pos?.alwaysShowStats ?? false,
  );
  const [compactStats, setCompactStats] = useState<boolean>(
    pos?.compactStats ?? false,
  );
  const [statsOverrides, setStatsOverrides] = useState<Partial<Record<PositionStatKey, boolean>>>(
    pos?.statsOverrides ?? {},
  );
  const [fillColor, setFillColor] = useState<string>(
    rect?.fillColor ?? TV_PINE.blue,
  );
  const [fillOpacity, setFillOpacity] = useState<number>(
    rect?.fillOpacity ?? 0.1,
  );
  // Text tab state (line tools only). One object rather than eight useStates:
  // the fields travel together into the patch and reset together.
  const [textLabel, setTextLabel] = useState<ResolvedTextLabel | null>(initialTextLabel);

  // Inputs tab state (positions only)
  const [entry, setEntry] = useState<number>(pos?.entry ?? 0);
  const [target, setTarget] = useState<number>(pos?.target ?? 0);
  const [stop, setStop] = useState<number>(pos?.stop ?? 0);
  const [accountSize, setAccountSize] = useState<number | undefined>(
    pos?.accountSize,
  );
  const [risk, setRisk] = useState<number | undefined>(
    pos?.risk,
  );
  const [riskIsPercent, setRiskIsPercent] = useState<boolean>(
    pos?.riskIsPercent ?? false,
  );
  const [leverage, setLeverage] = useState<number | undefined>(
    pos?.leverage,
  );
  const [lotSize, setLotSize] = useState<number>(
    pos?.lotSize ?? 1,
  );
  const [qtyPrecision, setQtyPrecision] = useState<number | undefined>(
    pos?.qtyPrecision,
  );
  // Applies to future drawings of this tool, not this one — read from/written
  // to `toolDefaults`, never to the drawing's own persisted fields.
  const [defaultRiskReward, setDefaultRiskReward] = useState<number>(1);
  const [defaultZoneDistancePct, setDefaultZoneDistancePct] = useState<number>(16);

  const symbolInfo = useSymbolInfo(drawing.symbol);
  const tickSize = symbolInfo.tickSize > 0 ? symbolInfo.tickSize : 0.01;

  useEffect(() => {
    setTab(isPosition ? "inputs" : "style");
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
      setQtyPrecision(drawing.qtyPrecision);
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
    setTextLabel(resolveTextLabel(drawing, drawing.color ?? TV_PINE.blue));
  }, [drawing, isPosition]);

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
    // Only written when the Text tab was actually edited: otherwise every Ok
    // would bake the resolved defaults into the drawing (freezing a text colour
    // that should keep following the line colour) and into the tool default.
    const before = resolveTextLabel(drawing, drawing.color ?? TV_PINE.blue);
    if (
      textLabel &&
      before &&
      (Object.keys(textLabel) as (keyof ResolvedTextLabel)[]).some((k) => textLabel[k] !== before[k])
    ) {
      // `text` is content, the rest appearance — SETTINGS_STYLE_FIELDS picks
      // only the latter into the tool default.
      Object.assign(patch, { ...textLabel, text: textLabel.text.trim() === "" ? "" : textLabel.text });
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
        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto pr-1 max-sm:max-h-none">
          {isPosition ? (
            <>
              <ColorRow label="Entry line" value={color} onChange={setColor} />
              <LineStyleRow compact width={lineWidth} style={lineStyle} onWidth={setLineWidth} onStyle={setLineStyle} />

              <ColorRow label="Target line" value={targetColor} onChange={setTargetColor} />
              <LineStyleRow compact width={targetLineWidth} style={targetLineStyle} onWidth={setTargetLineWidth} onStyle={setTargetLineStyle} />

              <ColorRow label="Stop line" value={stopColor} onChange={setStopColor} />
              <LineStyleRow compact width={stopLineWidth} style={stopLineStyle} onWidth={setStopLineWidth} onStyle={setStopLineStyle} />

              <ColorRow label="Text color" value={textColor} onChange={setTextColor} />
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

      {tab === "text" && textLabel && (
        <TextLabelTab
          value={textLabel}
          onChange={(p) => setTextLabel((t) => (t ? { ...t, ...p } : t))}
        />
      )}

      {tab === "coordinates" && <CoordinatesTab drawing={drawing} onApply={onApply} />}

      {tab === "inputs" && isPosition && (
        <PositionInputsTab
          symbol={drawing.symbol}
          tickSize={tickSize}
          entry={entry} target={target} stop={stop}
          onEntry={setEntry} onTarget={setTarget} onStop={setStop}
          accountSize={accountSize} onAccountSize={setAccountSize}
          risk={risk} onRisk={setRisk}
          riskIsPercent={riskIsPercent} onRiskIsPercent={setRiskIsPercent}
          leverage={leverage} onLeverage={setLeverage}
          lotSize={lotSize} onLotSize={setLotSize}
          qtyPrecision={qtyPrecision} onQtyPrecision={setQtyPrecision}
        />
      )}

      <div className="mt-2 flex items-center justify-between border-t border-tv-border pt-3">
        <div className="flex items-center gap-2">
          {isPosition && (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 rounded border border-tv-border px-2 py-1 text-[11px] text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text">
                Template
                <ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-tv-panel">
                <DropdownMenuItem>Default template</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-tv-red hover:bg-tv-red/10 hover:text-tv-red"
          >
            Delete
          </Button>
        </div>
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

const FONT_SIZES = [10, 11, 12, 14, 16, 20, 24, 28, 32, 40];

const HORZ_ALIGN_OPTIONS: { value: HorzTextAlign; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

const VERT_ALIGN_OPTIONS: { value: VertTextAlign; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
];

/**
 * TradingView's "Text" tab for line tools: the master checkbox, the string,
 * then its appearance. While the checkbox is off the rest stays visible but
 * disabled (a native `<fieldset disabled>`, which also disables the Select
 * triggers and colour swatch), so the user can see what turning it on does.
 */
function TextLabelTab({
  value,
  onChange,
}: {
  value: ResolvedTextLabel;
  onChange: (patch: Partial<ResolvedTextLabel>) => void;
}) {
  const off = !value.showText;
  // Keep a non-preset size (e.g. from an older drawing) selectable.
  const sizes = FONT_SIZES.includes(value.fontSize)
    ? FONT_SIZES
    : [...FONT_SIZES, value.fontSize].sort((a, b) => a - b);
  return (
    <div className="flex max-h-96 flex-col gap-3 overflow-y-auto pr-1 max-sm:max-h-none">
      <CheckRow label="Text" checked={value.showText} onChange={(v) => onChange({ showText: v })} />
      <fieldset disabled={off} className={cn("flex flex-col gap-3", off && "opacity-50")}>
        <textarea
          value={value.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Add text"
          rows={3}
          className="w-full resize-none rounded border border-tv-border bg-tv-bg px-2 py-1 text-xs text-tv-text outline-none focus:border-tv-blue"
        />
        <ColorRow label="Text color" value={value.textColor} onChange={(v) => onChange({ textColor: v })} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-tv-text">Font size</span>
          <Select
            value={String(value.fontSize)}
            onValueChange={(v) => onChange({ fontSize: Number(v) })}
            disabled={off}
          >
            <SelectTrigger size="sm" className="h-7 w-[4.5rem] px-2 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sizes.map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <CheckRow label="Bold" checked={value.bold} onChange={(v) => onChange({ bold: v })} />
        <CheckRow label="Italic" checked={value.italic} onChange={(v) => onChange({ italic: v })} />
        <div className="mt-1 border-t border-tv-border pt-2 text-[10px] font-semibold uppercase tracking-wide text-tv-text-dim">
          Text alignment
        </div>
        <AlignRow
          label="Horizontal"
          value={value.horzTextAlign}
          options={HORZ_ALIGN_OPTIONS}
          disabled={off}
          onChange={(v) => onChange({ horzTextAlign: v })}
        />
        <AlignRow
          label="Vertical"
          value={value.vertTextAlign}
          options={VERT_ALIGN_OPTIONS}
          disabled={off}
          onChange={(v) => onChange({ vertTextAlign: v })}
        />
      </fieldset>
    </div>
  );
}

function AlignRow<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-tv-text">{label}</span>
      <Select value={value} items={options} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
        <SelectTrigger size="sm" className="h-7 w-24 px-2 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

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

/**
 * Width + line-style picker. The position tool renders it as a compact,
 * unlabelled row indented under each of its three colour rows, and offers a
 * 1.5 step its thin entry/target/stop rails need; every other drawing gets the
 * generic labelled "Line width" / "Line style" rows with integer widths 1-4.
 */
function LineStyleRow({
  width,
  style,
  onWidth,
  onStyle,
  compact = false,
}: {
  width: number;
  style: 0 | 1 | 2;
  onWidth: (w: number) => void;
  onStyle: (s: 0 | 1 | 2) => void;
  compact?: boolean;
}) {
  const widths = compact ? [1, 1.5, 2, 3] : [1, 2, 3, 4];

  const widthButtons = (
    <div className="flex items-center gap-1">
      {widths.map((w) => (
        <button
          key={w}
          onClick={() => onWidth(w)}
          className={cn(
            "flex items-center justify-center rounded border text-[10px]",
            compact ? "h-6 w-6" : "h-7 w-7",
            width === w
              ? "border-tv-blue bg-tv-blue/15 text-tv-blue-text"
              : "border-tv-border text-tv-text-muted hover:bg-tv-panel-hover",
          )}
        >
          {w}
        </button>
      ))}
    </div>
  );

  const styleButtons = (
    <div className="flex items-center gap-1">
      {([0, 1, 2] as const).map((s) => (
        <button
          key={s}
          onClick={() => onStyle(s)}
          title={s === 0 ? "Solid" : s === 1 ? "Dashed" : "Dotted"}
          className={cn(
            "flex items-center justify-center rounded border",
            compact ? "h-6 w-9" : "h-7 w-10",
            style === s
              ? "border-tv-blue bg-tv-blue/15"
              : "border-tv-border hover:bg-tv-panel-hover",
          )}
        >
          <svg width={compact ? 22 : 24} height="2" viewBox={compact ? "0 0 22 2" : "0 0 24 2"}>
            <line
              x1="0" y1="1" x2={compact ? 22 : 24} y2="1"
              stroke="currentColor" strokeWidth="2"
              strokeDasharray={s === 1 ? "6 3" : s === 2 ? "2 3" : "none"}
            />
          </svg>
        </button>
      ))}
    </div>
  );

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 pl-2">
        {widthButtons}
        {styleButtons}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-tv-text">Line width</span>
        {widthButtons}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-tv-text">Line style</span>
        {styleButtons}
      </div>
    </>
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
  symbol,
  tickSize,
  entry, target, stop,
  onEntry, onTarget, onStop,
  accountSize, onAccountSize,
  risk, onRisk,
  riskIsPercent, onRiskIsPercent,
  leverage, onLeverage,
  lotSize, onLotSize,
  qtyPrecision, onQtyPrecision,
}: {
  symbol: string;
  tickSize: number;
  entry: number; target: number; stop: number;
  onEntry: (v: number) => void; onTarget: (v: number) => void; onStop: (v: number) => void;
  accountSize?: number; onAccountSize: (v: number | undefined) => void;
  risk?: number; onRisk: (v: number | undefined) => void;
  riskIsPercent: boolean; onRiskIsPercent: (v: boolean) => void;
  leverage?: number; onLeverage: (v: number | undefined) => void;
  lotSize: number; onLotSize: (v: number) => void;
  qtyPrecision: number | undefined; onQtyPrecision: (v: number | undefined) => void;
}) {
  const quoteCurrency = deriveQuoteCurrency(symbol);
  return (
    <div className="flex max-h-96 flex-col gap-3 overflow-y-auto pr-1 max-sm:max-h-none">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-tv-text">Account size</span>
        <div className="flex items-center gap-1.5">
          <DraftNumberInput value={accountSize} onChange={onAccountSize} decimals={2} placeholder="Not set" className="w-24" />
          <Select value="default" disabled>
            <SelectTrigger size="sm" className="h-7 w-[4.5rem] px-2 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <NumberField label="Lot size" value={lotSize} onChange={onLotSize} decimals={6} />

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-tv-text">Risk</span>
        <div className="flex items-center gap-1.5">
          <DraftNumberInput value={risk} onChange={onRisk} decimals={2} placeholder="Not set" className="w-24" />
          <Select
            value={riskIsPercent ? "percent" : "currency"}
            onValueChange={(v) => onRiskIsPercent(v === "percent")}
          >
            <SelectTrigger size="sm" className="h-7 w-[4.5rem] px-2 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="currency">{quoteCurrency}</SelectItem>
              <SelectItem value="percent">%</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <PriceFieldStepped label="Entry price" value={entry} onChange={onEntry} step={tickSize} />
      <OptionalNumberFieldStepped label="Leverage" value={leverage} onChange={onLeverage} step={1} decimals={2} placeholder="Not set" />

      <div className="mt-1 border-t border-tv-border pt-2 text-[10px] font-semibold uppercase tracking-wide text-tv-text-dim">
        Profit level
      </div>
      <PricePlusTicks entry={entry} level={target} tickSize={tickSize} onLevel={onTarget} />

      <div className="mt-1 border-t border-tv-border pt-2 text-[10px] font-semibold uppercase tracking-wide text-tv-text-dim">
        Stop level
      </div>
      <PricePlusTicks entry={entry} level={stop} tickSize={tickSize} onLevel={onStop} />

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-tv-text">Qty precision</span>
        <Select
          value={qtyPrecision === undefined ? "default" : String(qtyPrecision)}
          onValueChange={(v) => onQtyPrecision(v === "default" ? undefined : Number(v))}
        >
          <SelectTrigger size="sm" className="h-7 w-[4.5rem] px-2 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default</SelectItem>
            <SelectItem value="0">0</SelectItem>
            <SelectItem value="1">1</SelectItem>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="3">3</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** Syncs a text-input draft to an external value without an effect: React's
 *  documented "adjust state during render" escape hatch for a controlled
 *  input whose source of truth can also change from outside (e.g. a chart drag). */
function useSyncedDraft<T>(value: T, format: (v: T) => string) {
  const [prevValue, setPrevValue] = useState(value);
  const [draft, setDraft] = useState(() => format(value));
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(format(value));
  }
  return [draft, setDraft] as const;
}

/** Parses a field's draft on blur, returning `null` when there is nothing to
 *  commit: unparseable text, or a draft the user never changed. The latter
 *  matters because the display is rounded — committing an untouched draft
 *  would silently overwrite a stored `2.1234` with the `2.123` on screen just
 *  because the field was focused and left. */
function parseEditedDraft(draft: string, shown: string): number | null {
  if (draft === shown) return null;
  const n = parseFloat(draft);
  return isNaN(n) ? null : n;
}

/** Generic non-price number, rounded to `decimals` for display and storage. */
function NumberField({
  label,
  value,
  onChange,
  decimals,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  decimals: number;
}) {
  const format = (v: number) => formatDecimalInput(v, decimals);
  const [draft, setDraft] = useSyncedDraft(value, format);
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-tv-text">{label}</span>
      <Input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = parseEditedDraft(draft, format(value));
          if (n !== null) onChange(roundDecimalForInput(n, decimals));
        }}
        className="w-32 bg-tv-bg text-right tabular-nums"
      />
    </label>
  );
}

/** Small up/down stepper used next to a number input (entry price, leverage). */
function StepperButtons({ onStep }: { onStep: (dir: 1 | -1) => void }) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => onStep(1)}
        className="flex h-3.5 w-4 items-center justify-center rounded-t border border-b-0 border-tv-border text-tv-text-muted hover:bg-tv-panel-hover"
      >
        <ChevronUp className="size-2.5" />
      </button>
      <button
        type="button"
        onClick={() => onStep(-1)}
        className="flex h-3.5 w-4 items-center justify-center rounded-b border border-tv-border text-tv-text-muted hover:bg-tv-panel-hover"
      >
        <ChevronDown className="size-2.5" />
      </button>
    </div>
  );
}

/** Like `PriceField`, plus a stepper that nudges the price by one `step` (the
 *  symbol's tick). The tick's own decimals are a floor on the rounding, or a
 *  0.0001 tick on a $2 symbol would be rounded straight back by the 3-decimal
 *  cap and the stepper would never move. */
function PriceFieldStepped({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step: number;
}) {
  const minDecimals = stepDecimals(step);
  const format = (v: number) => formatPriceInput(v, minDecimals);
  const [draft, setDraft] = useSyncedDraft(value, format);
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-tv-text">{label}</span>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = parseEditedDraft(draft, format(value));
            if (n !== null) onChange(roundPriceForInput(n, minDecimals));
          }}
          className="w-28 bg-tv-bg text-right tabular-nums"
        />
        <StepperButtons
          onStep={(dir) => onChange(roundPriceForInput(value + dir * step, minDecimals))}
        />
      </div>
    </label>
  );
}

/** Same as `NumberField` plus a stepper, but `undefined` is a valid ("not set") value. */
function OptionalNumberFieldStepped({
  label,
  value,
  onChange,
  step,
  decimals,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  step: number;
  decimals: number;
  placeholder?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-tv-text">{label}</span>
      <div className="flex items-center gap-1">
        <DraftNumberInput value={value} onChange={onChange} decimals={decimals} placeholder={placeholder} className="w-28" />
        <StepperButtons
          onStep={(dir) =>
            onChange(Math.max(0, roundDecimalForInput((value ?? 0) + dir * step, decimals)))
          }
        />
      </div>
    </label>
  );
}

/** Optional non-price number (blank = `undefined`), rounded to `decimals`. */
function DraftNumberInput({
  value,
  onChange,
  decimals,
  placeholder,
  className,
}: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  decimals: number;
  placeholder?: string;
  className?: string;
}) {
  const format = (v: number | undefined) => (v === undefined ? "" : formatDecimalInput(v, decimals));
  const [draft, setDraft] = useSyncedDraft(value, format);
  return (
    <Input
      type="number"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === format(value)) return;
        if (draft.trim() === "") {
          onChange(undefined);
          return;
        }
        const n = parseFloat(draft);
        if (!isNaN(n)) onChange(roundDecimalForInput(n, decimals));
      }}
      className={cn("bg-tv-bg text-right tabular-nums", className)}
    />
  );
}

/** Paired Ticks + Price fields — editing either recomputes the other via
 *  `tickSize`, both driving the same `level` (target or stop) price. Ticks are
 *  whole numbers; the price keeps at least the tick's decimals, for the same
 *  reason as `PriceFieldStepped`. */
function PricePlusTicks({
  entry,
  level,
  tickSize,
  onLevel,
}: {
  entry: number;
  level: number;
  tickSize: number;
  onLevel: (v: number) => void;
}) {
  const minDecimals = stepDecimals(tickSize);
  const formatLevel = (v: number) => formatPriceInput(v, minDecimals);
  const ticks = tickSize > 0 ? Math.round((level - entry) / tickSize) : 0;
  const [priceDraft, setPriceDraft] = useSyncedDraft(level, formatLevel);
  const [ticksDraft, setTicksDraft] = useSyncedDraft(ticks, (v) => String(v));

  return (
    <>
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-tv-text">Ticks</span>
        <Input
          type="number"
          value={ticksDraft}
          onChange={(e) => setTicksDraft(e.target.value)}
          onBlur={() => {
            const n = parseEditedDraft(ticksDraft, String(ticks));
            if (n !== null && tickSize > 0) {
              onLevel(roundPriceForInput(entry + Math.round(n) * tickSize, minDecimals));
            }
          }}
          className="w-32 bg-tv-bg text-right tabular-nums"
        />
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-tv-text">Price</span>
        <Input
          type="number"
          value={priceDraft}
          onChange={(e) => setPriceDraft(e.target.value)}
          onBlur={() => {
            const n = parseEditedDraft(priceDraft, formatLevel(level));
            if (n !== null) onLevel(roundPriceForInput(n, minDecimals));
          }}
          className="w-32 bg-tv-bg text-right tabular-nums"
        />
      </label>
    </>
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
  const [draft, setDraft] = useSyncedDraft(value, formatPriceInput);
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-tv-text">{label}</span>
      <Input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = parseEditedDraft(draft, formatPriceInput(value));
          if (n !== null) onChange(roundPriceForInput(n));
        }}
        className="w-32 bg-tv-bg text-right tabular-nums"
      />
    </label>
  );
}
