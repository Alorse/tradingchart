"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bookmark, BookmarkPlus, Check, Copy, Eye, EyeOff, Lock, Pin, RotateCcw, Settings2, Trash2, TrendingUp, Unlock, X } from "lucide-react";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { useChartStore, type DrawingTool } from "@/lib/store/chart-store";
import { useTradingStore } from "@/lib/store/trading-store";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Drawing } from "@/lib/drawings/types";
import type { DrawingTemplate } from "@/lib/store/chart-store";
import { TV_PINE } from "@/lib/chart/theme";

// Stable empty-array reference: a fresh `[]` on every selector call would
// give useSyncExternalStore a snapshot that "changes" on every render even
// when nothing did, which crashes with "Maximum update depth exceeded" the
// instant a drawing kind with no saved templates gets selected.
const NO_TEMPLATES: DrawingTemplate[] = [];

interface Props {
  containerSize: { width: number; height: number };
  onOpenSettings: () => void;
}

export function FloatingContextToolbar({ containerSize, onOpenSettings }: Props) {
  const selectedId = useDrawingsStore((s) => s.selectedId);
  const drawings = useDrawingsStore((s) => s.drawings);
  const drawing = selectedId ? drawings.find((d) => d.id === selectedId) ?? null : null;

  const { update, remove, duplicate } = useDrawings();

  const [pos, setPos] = useState({ x: -9999, y: 8 });
  const dragRef = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const prevIdRef = useRef<string | null>(null);

  // Snap to top-right on new selection (after layout so width is known)
  useLayoutEffect(() => {
    if (!selectedId || selectedId === prevIdRef.current) return;
    prevIdRef.current = selectedId;
    const tw = toolbarRef.current?.offsetWidth ?? 0;
    setPos({ x: Math.max(0, containerSize.width - tw - 16), y: 8 });
  });

  // Clamp inside container on resize
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    setPos((p) => ({
      x: Math.min(p.x, Math.max(0, containerSize.width - el.offsetWidth)),
      y: Math.min(p.y, Math.max(0, containerSize.height - el.offsetHeight)),
    }));
  }, [containerSize]);

  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    dragRef.current = { ox: e.clientX, oy: e.clientY, px: pos.x, py: pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const tw = toolbarRef.current?.offsetWidth ?? 0;
    const th = toolbarRef.current?.offsetHeight ?? 0;
    setPos({
      x: Math.max(0, Math.min(dragRef.current.px + e.clientX - dragRef.current.ox, containerSize.width - tw)),
      y: Math.max(0, Math.min(dragRef.current.py + e.clientY - dragRef.current.oy, containerSize.height - th)),
    });
  }
  function onPointerUp() { dragRef.current = null; }

  if (!drawing) return null;

  const isPosition = drawing.kind === "long" || drawing.kind === "short";

  function patch(p: Partial<Drawing>) {
    void update(drawing!.id, p);
    // Keep tool defaults in sync so next drawing reuses the same style
    useChartStore.getState().setToolDefault(
      drawing!.kind as DrawingTool,
      p as Parameters<ReturnType<typeof useChartStore.getState>["setToolDefault"]>[1],
    );
  }

  return (
    <div
      ref={toolbarRef}
      className="pointer-events-auto absolute z-30 flex h-7 items-stretch overflow-visible rounded border border-tv-border bg-tv-panel shadow-lg"
      style={{ left: pos.x, top: pos.y, userSelect: "none" }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Drag handle */}
      <div
        className="flex cursor-grab items-center px-1.5 text-[11px] text-tv-text-muted/50 hover:text-tv-text-muted active:cursor-grabbing"
        onPointerDown={startDrag}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        ⠿
      </div>

      <Sep />

      {/* Line drawings: color + width */}
      {!isPosition && (
        <>
          <Seg>
            <SwatchPicker
              value={drawing.color ?? TV_PINE.blue}
              onChange={(c) => patch({ color: c })}
            />
          </Seg>
          {"lineWidth" in drawing && (
            <>
              <Sep />
              <Seg>
                {[1, 2, 3].map((w) => (
                  <button
                    key={w}
                    onClick={() => patch({ lineWidth: w })}
                    title={`Width ${w}`}
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold",
                      (drawing.lineWidth ?? 1) === w
                        ? "bg-tv-blue/20 text-tv-blue-text"
                        : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
                    )}
                  >
                    {w}
                  </button>
                ))}
              </Seg>
            </>
          )}
        </>
      )}

      {/* Position drawings: E / S / T color pickers */}
      {isPosition && (
        <Seg gap>
          <MiniColorLabel label="E">
            <SwatchPicker
              value={drawing.color ?? TV_PINE.neutral}
              onChange={(c) => patch({ color: c })}
            />
          </MiniColorLabel>
          <MiniColorLabel label="S">
            <SwatchPicker
              value={(drawing as { stopColor?: string }).stopColor ?? TV_PINE.red}
              onChange={(c) => patch({ stopColor: c } as Partial<Drawing>)}
            />
          </MiniColorLabel>
          <MiniColorLabel label="T">
            <SwatchPicker
              value={(drawing as { targetColor?: string }).targetColor ?? TV_PINE.green}
              onChange={(c) => patch({ targetColor: c } as Partial<Drawing>)}
            />
          </MiniColorLabel>
        </Seg>
      )}

      <Sep />

      {/* Common actions */}
      <Seg>
        <Btn title="Settings" onClick={onOpenSettings}>
          <Settings2 className="h-3.5 w-3.5" />
        </Btn>
        <VisBtn drawing={drawing} onPatch={patch} />
        <LockBtn drawing={drawing} onPatch={patch} />
        <Btn title="Duplicate (Ctrl+D)" onClick={() => void duplicate(drawing.id)}>
          <Copy className="h-3.5 w-3.5" />
        </Btn>
        <SaveAsDefaultButton drawing={drawing} />
        <TemplatesButton drawing={drawing} onApply={patch} />
        <Btn title="Delete" danger onClick={() => {
          void remove(drawing.id);
          useDrawingsStore.getState().setSelected(null);
        }}>
          <Trash2 className="h-3.5 w-3.5" />
        </Btn>
      </Seg>

      {/* Create Limit Order from the long/short drawing */}
      {isPosition && <LimitOrderButton drawing={drawing} />}
    </div>
  );
}

/* ── Primitives ─────────────────────────────────────────────────── */

function Sep() {
  return <div className="w-px self-stretch bg-tv-border" />;
}

function Seg({ children, gap }: { children: React.ReactNode; gap?: boolean }) {
  return (
    <div className={cn("flex items-center px-1", gap && "gap-1.5")}>
      {children}
    </div>
  );
}

function Btn({
  children, title, onClick, danger,
}: {
  children: React.ReactNode; title: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded transition-colors",
        danger
          ? "text-tv-text-muted hover:bg-tv-red/15 hover:text-tv-red"
          : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
      )}
    >
      {children}
    </button>
  );
}

function VisBtn({ drawing, onPatch }: { drawing: Drawing; onPatch: (p: Partial<Drawing>) => void }) {
  const hidden = drawing.hidden ?? false;
  return (
    <button
      title={hidden ? "Show" : "Hide"}
      onClick={() => onPatch({ hidden: !hidden })}
      className="flex h-5 w-5 items-center justify-center rounded text-tv-text-muted transition-colors hover:bg-tv-panel-hover hover:text-tv-text"
    >
      {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
    </button>
  );
}

function LockBtn({ drawing, onPatch }: { drawing: Drawing; onPatch: (p: Partial<Drawing>) => void }) {
  const locked = drawing.locked ?? false;
  return (
    <button
      title={locked ? "Unlock — allow moving" : "Lock — prevent moving"}
      onClick={() => onPatch({ locked: !locked })}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded transition-colors",
        locked
          ? "text-tv-blue-text hover:bg-tv-blue/15"
          : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
      )}
    >
      {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
    </button>
  );
}

function MiniColorLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-px">
      <span className="text-[7px] font-bold uppercase tracking-wider text-tv-text-muted/60">{label}</span>
      {children}
    </div>
  );
}

/**
 * Wraps ColorPicker in a scaled-down container so the swatch fits the compact bar height.
 */
function SwatchPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ transform: "scale(0.78)", transformOrigin: "center" }}>
      <ColorPicker value={value} onChange={onChange} />
    </div>
  );
}

/**
 * The subset of fields worth saving/restoring as a template or a tool default:
 * everything that describes how the drawing *looks*, and nothing that
 * describes where it sits. Fib ratios count as style here — copying a
 * customized ladder onto the next fib is the whole point of saving it.
 */
const STYLE_FIELDS = [
  "color",
  "lineWidth",
  "lineStyle",
  "stopColor",
  "targetColor",
  "textColor",
  "showLabels",
  "fillColor",
  "fillOpacity",
  "fontSize",
  "levels",
] as const;

function styleOf(d: Drawing): Record<string, unknown> {
  const src = d as unknown as Record<string, unknown>;
  const style: Record<string, unknown> = {};
  for (const f of STYLE_FIELDS) {
    if (src[f] !== undefined) style[f] = src[f];
  }
  return style;
}

/**
 * One-click "make this the default for the tool".
 *
 * Editing a style from this toolbar already writes `toolDefaults` field by
 * field, but that only ever captures the field just touched — a drawing whose
 * look was built up earlier (or imported, or restored from a template) has a
 * style the defaults have never seen. This copies the whole thing in a single
 * click, with none of the naming prompt a template needs; the matching
 * "Reset default style" lives in the templates menu, where an undo belongs.
 */
function SaveAsDefaultButton({ drawing }: { drawing: Drawing }) {
  const setToolDefault = useChartStore((s) => s.setToolDefault);
  const [saved, setSaved] = useState(false);

  // Reset the confirmation when the selection moves to another drawing, so a
  // stale check mark never suggests the new one was saved too.
  useEffect(() => {
    setSaved(false);
  }, [drawing.id]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1200);
    return () => clearTimeout(t);
  }, [saved]);

  return (
    <button
      title={saved ? "Saved as default" : "Save as default style for this tool"}
      onClick={() => {
        setToolDefault(
          drawing.kind,
          styleOf(drawing) as Parameters<typeof setToolDefault>[1],
        );
        setSaved(true);
      }}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded transition-colors",
        saved
          ? "text-tv-green"
          : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
      )}
    >
      {saved ? <Check className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * Named style presets for this drawing's kind — save the current style under
 * a name, and re-apply any saved one later. Unlike `toolDefaults` (the
 * single "last style used", applied silently to new drawings), templates are
 * explicit and applied on demand to the selected drawing.
 */
function TemplatesButton({
  drawing,
  onApply,
}: {
  drawing: Drawing;
  onApply: (p: Partial<Drawing>) => void;
}) {
  const templates = useChartStore((s) => s.drawingTemplates[drawing.kind] ?? NO_TEMPLATES);
  const saveDrawingTemplate = useChartStore((s) => s.saveDrawingTemplate);
  const deleteDrawingTemplate = useChartStore((s) => s.deleteDrawingTemplate);
  const clearToolDefault = useChartStore((s) => s.clearToolDefault);

  function saveTemplate() {
    const name = window.prompt("Template name:");
    if (name && name.trim()) {
      saveDrawingTemplate(drawing.kind, name.trim(), styleOf(drawing));
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Templates"
        className="flex h-5 w-5 items-center justify-center rounded text-tv-text-muted transition-colors hover:bg-tv-panel-hover hover:text-tv-text"
      >
        <Bookmark className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48 bg-tv-panel">
        <DropdownMenuItem onClick={saveTemplate} className="text-xs">
          <BookmarkPlus className="h-3.5 w-3.5" />
          <span>Save as template…</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => clearToolDefault(drawing.kind)}
          className="text-xs"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Reset default style</span>
        </DropdownMenuItem>
        {templates.length > 0 && <DropdownMenuSeparator />}
        {templates.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => onApply(t.style as Partial<Drawing>)}
            className="text-xs"
          >
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
            <span
              role="button"
              aria-label="Delete template"
              title="Delete template"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                deleteDrawingTemplate(drawing.kind, t.id);
              }}
              className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded text-tv-text-dim hover:bg-tv-panel-hover hover:text-tv-red"
            >
              <X className="h-3 w-3" />
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Pre-fills the OrderPanel with the long/short drawing's entry / stop /
 * target and opens the right sidebar so the user can confirm the qty + submit.
 *
 * If no API credentials are set we disable the button and prompt to connect.
 */
function LimitOrderButton({ drawing }: { drawing: Drawing }) {
  const apiKey = useTradingStore((s) => s.apiKey);
  const apiSecret = useTradingStore((s) => s.apiSecret);
  const updateForm = useTradingStore((s) => s.updateForm);
  const setTradingPanelOpen = useTradingStore((s) => s.setTradingPanelOpen);
  const connected = apiKey && apiSecret;

  function onClick() {
    if (!connected) return;
    if (drawing.kind !== "long" && drawing.kind !== "short") return;
    const isLong = drawing.kind === "long";
    updateForm({
      side: isLong ? "BUY" : "SELL",
      type: "LIMIT",
      price: drawing.entry.toString(),
      stopPrice: "",
      slEnabled: true,
      sl: drawing.stop.toString(),
      tpEnabled: true,
      tp: drawing.target.toString(),
    });
    setTradingPanelOpen(true);
  }

  return (
    <>
      <Sep />
      <Seg>
        <button
          disabled={!connected}
          onClick={onClick}
          title={connected
            ? "Pre-fill the order panel with this drawing's E/S/T"
            : "Connect an exchange to create orders"}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 text-[10px] font-medium transition-colors",
            connected
              ? "text-tv-blue-text hover:bg-tv-blue/15"
              : "text-tv-text-muted/40",
          )}
        >
          <TrendingUp className="h-3 w-3" />
          <span>Limit order</span>
        </button>
      </Seg>
    </>
  );
}
