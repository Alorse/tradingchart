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
import type { Drawing } from "@/lib/drawings/types";
import { cn } from "@/lib/utils";

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

type Tab = "style" | "coordinates";

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
              if (p.showLabels !== undefined) stylePatch.showLabels = p.showLabels;
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
  const [tab, setTab] = useState<Tab>("style");
  const [color, setColor] = useState<string>(drawing.color ?? "#d1d4dc");
  const [lineWidth, setLineWidth] = useState<number>(drawing.lineWidth ?? 1);
  const [lineStyle, setLineStyle] = useState<0 | 1 | 2>(drawing.lineStyle ?? 0);
  const isPosition = drawing.kind === "long" || drawing.kind === "short";
  const isRect = drawing.kind === "rectangle";
  const [stopColor, setStopColor] = useState<string>(
    isPosition ? ((drawing as { stopColor?: string }).stopColor ?? "#ef5350") : "#ef5350",
  );
  const [targetColor, setTargetColor] = useState<string>(
    isPosition ? ((drawing as { targetColor?: string }).targetColor ?? "#26a69a") : "#26a69a",
  );
  const [textColor, setTextColor] = useState<string>(
    isPosition ? ((drawing as { textColor?: string }).textColor ?? "#d1d4dc") : "#d1d4dc",
  );
  const [showLabels, setShowLabels] = useState<boolean>(
    isPosition ? ((drawing as { showLabels?: boolean }).showLabels ?? false) : false,
  );
  const [fillColor, setFillColor] = useState<string>(
    isRect ? ((drawing as { fillColor?: string }).fillColor ?? "#2962ff") : "#2962ff",
  );
  const [fillOpacity, setFillOpacity] = useState<number>(
    isRect ? ((drawing as { fillOpacity?: number }).fillOpacity ?? 0.1) : 0.1,
  );

  useEffect(() => {
    setColor(drawing.color ?? "#d1d4dc");
    setLineWidth(drawing.lineWidth ?? 1);
    setLineStyle(drawing.lineStyle ?? 0);
    if (drawing.kind === "long" || drawing.kind === "short") {
      setStopColor(drawing.stopColor ?? "#ef5350");
      setTargetColor(drawing.targetColor ?? "#26a69a");
      setTextColor(drawing.textColor ?? "#d1d4dc");
      setShowLabels(drawing.showLabels ?? false);
    }
    if (drawing.kind === "rectangle") {
      setFillColor(drawing.fillColor ?? "#2962ff");
      setFillOpacity(drawing.fillOpacity ?? 0.1);
    }
  }, [drawing]);

  function apply() {
    const patch: Partial<Drawing> = {} as Partial<Drawing>;
    patch.color = color;
    patch.lineWidth = lineWidth;
    (patch as Record<string, unknown>).lineStyle = lineStyle;
    if (isPosition) {
      (patch as Record<string, unknown>).stopColor = stopColor;
      (patch as Record<string, unknown>).targetColor = targetColor;
      (patch as Record<string, unknown>).textColor = textColor;
      (patch as Record<string, unknown>).showLabels = showLabels;
    }
    if (isRect) {
      (patch as Record<string, unknown>).fillColor = fillColor;
      (patch as Record<string, unknown>).fillOpacity = fillOpacity;
    }
    onApply(patch);
  }

  const tabs: Tab[] = ["style", "coordinates"];

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
        <div className="flex flex-col gap-3">
          {isPosition ? (
            <>
              <ColorRow label="Entry line" value={color} onChange={setColor} />
              <ColorRow label="Stop color" value={stopColor} onChange={setStopColor} />
              <ColorRow label="Target color" value={targetColor} onChange={setTargetColor} />
              <ColorRow label="Text color" value={textColor} onChange={setTextColor} />
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="text-xs text-tv-text">Always show labels</span>
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                  className="h-3.5 w-3.5 accent-tv-blue"
                />
              </label>
            </>
          ) : (
            <>
              <ColorRow label={isRect ? "Border color" : "Color"} value={color} onChange={setColor} />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-tv-text">Line width</span>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4].map((w) => (
                    <button
                      key={w}
                      onClick={() => setLineWidth(w)}
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded border text-[10px]",
                        lineWidth === w
                          ? "border-tv-blue bg-tv-blue/15 text-tv-blue-text"
                          : "border-tv-border text-tv-text-muted hover:bg-tv-panel-hover",
                      )}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-tv-text">Line style</span>
                <div className="flex items-center gap-1">
                  {([0, 1, 2] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setLineStyle(s)}
                      title={s === 0 ? "Solid" : s === 1 ? "Dashed" : "Dotted"}
                      className={cn(
                        "flex h-7 w-10 items-center justify-center rounded border",
                        lineStyle === s
                          ? "border-tv-blue bg-tv-blue/15"
                          : "border-tv-border hover:bg-tv-panel-hover",
                      )}
                    >
                      <svg width="24" height="2" viewBox="0 0 24 2">
                        <line
                          x1="0" y1="1" x2="24" y2="1"
                          stroke="currentColor" strokeWidth="2"
                          strokeDasharray={s === 1 ? "6 3" : s === 2 ? "2 3" : "none"}
                        />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
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
    case "long":
    case "short":
      return (
        <div className="flex flex-col gap-2">
          <PriceField
            label="Entry"
            value={drawing.entry}
            onChange={(v) => onApply({ entry: v } as Partial<Drawing>)}
          />
          <PriceField
            label="Stop"
            value={drawing.stop}
            onChange={(v) => onApply({ stop: v } as Partial<Drawing>)}
          />
          <PriceField
            label="Target"
            value={drawing.target}
            onChange={(v) => onApply({ target: v } as Partial<Drawing>)}
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
