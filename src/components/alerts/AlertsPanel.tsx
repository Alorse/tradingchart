"use client";

import { Bell, BellOff, Pencil, Trash2 } from "lucide-react";
import { useAlertsStore, type AlertCondition, type AlertSource } from "@/lib/store/alerts-store";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { useChartStore } from "@/lib/store/chart-store";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Drawing, DrawingKind } from "@/lib/drawings/types";

const CONDITION_LABELS: Record<AlertCondition, string> = {
  crossing: "Crossing",
  "crossing-up": "Crossing up",
  "crossing-down": "Crossing down",
};

const SOURCE_LABELS: Record<AlertSource, string> = {
  price: "Price",
  rsi: "RSI",
  macd: "MACD",
};

const DRAWING_KIND_LABELS: Partial<Record<DrawingKind, string>> = {
  hline: "Horizontal line",
  hray: "Horizontal ray",
  trendline: "Trend line",
  ray: "Ray",
};

/**
 * Every alert the user can act on: standalone price/RSI/MACD alerts (their
 * own store) plus drawing-attached ones (hline/hray/trendline/ray, toggled
 * from the left toolbar's bell button) — listed together so there's one
 * place to see, pause, edit, or delete an alert once it's created.
 */
export function AlertsPanel() {
  const alerts = useAlertsStore((s) => s.alerts);
  const toggleAlert = useAlertsStore((s) => s.toggleAlert);
  const removeAlert = useAlertsStore((s) => s.removeAlert);
  const openEditAlertDialog = useChartStore((s) => s.openEditAlertDialog);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const setSelected = useDrawingsStore((s) => s.setSelected);
  const drawings = useDrawingsStore((s) => s.drawings);
  const { update } = useDrawings();

  const drawingAlerts = drawings.filter((d) => d.alert);
  const total = alerts.length + drawingAlerts.length;

  function jumpTo(symbol: string, drawingId?: string) {
    setSymbol(symbol);
    if (drawingId) setSelected(drawingId);
  }

  function toggleDrawingAlert(d: Drawing) {
    if (!d.alert) return;
    void update(d.id, { alert: { ...d.alert, enabled: !d.alert.enabled } } as Partial<Drawing>);
  }

  function removeDrawingAlert(d: Drawing) {
    void update(d.id, { alert: null } as Partial<Drawing>);
  }

  return (
    <div className="flex h-full flex-col text-tv-text">
      <div className="flex items-center justify-between border-b border-tv-border px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-tv-text-muted">
          Alerts
        </span>
        <span className="text-[11px] text-tv-text-muted">{total}</span>
      </div>

      {total === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-tv-text-muted">
          No alerts yet. Use the bell icon (Alt+A) or right-click the chart to create one.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {alerts.map((a) => {
            const source = a.source ?? "price";
            const desc =
              source === "macd"
                ? `${CONDITION_LABELS[a.condition]} signal`
                : `${SOURCE_LABELS[source]} ${CONDITION_LABELS[a.condition]} ${
                    source === "rsi" ? a.value : formatPrice(a.value)
                  }`;
            return (
              <div
                key={a.id}
                className={cn(
                  "group flex items-start gap-1.5 px-2 py-1.5 text-[12px] transition-colors hover:bg-tv-panel-hover",
                  !a.enabled && "opacity-50",
                )}
              >
                <button
                  onClick={() => toggleAlert(a.id)}
                  aria-label={a.enabled ? "Pause alert" : "Resume alert"}
                  title={a.enabled ? "Pause alert" : "Resume alert"}
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded",
                    a.enabled ? "text-tv-yellow" : "text-tv-text-dim hover:text-tv-text",
                  )}
                >
                  {a.enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => jumpTo(a.symbol)}
                  className="min-w-0 flex-1 text-left"
                  title="Go to symbol"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{a.symbol}</span>
                    {a.trigger === "once" && (
                      <span className="shrink-0 text-[9px] uppercase tracking-wider text-tv-text-muted">once</span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-tv-text-muted">{desc}</div>
                  {a.message && (
                    <div className="truncate text-[10px] text-tv-text-muted">{a.message}</div>
                  )}
                </button>
                <button
                  onClick={() => openEditAlertDialog(a.id)}
                  aria-label="Edit alert"
                  title="Edit alert"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-tv-text-dim opacity-0 hover:bg-tv-panel-hover hover:text-tv-text group-hover:opacity-100"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => removeAlert(a.id)}
                  aria-label="Delete alert"
                  title="Delete alert"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-tv-text-dim opacity-0 hover:bg-tv-panel-hover hover:text-tv-red group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          {drawingAlerts.length > 0 && (
            <div className="mt-1 border-t border-tv-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-tv-text-muted">
              From drawings
            </div>
          )}
          {drawingAlerts.map((d) => {
            const enabled = !!d.alert?.enabled;
            const kindLabel = DRAWING_KIND_LABELS[d.kind] ?? d.kind;
            const dirLabel =
              d.alert?.direction === "cross-up"
                ? "Crossing up"
                : d.alert?.direction === "cross-down"
                  ? "Crossing down"
                  : "Crossing";
            return (
              <div
                key={d.id}
                className={cn(
                  "group flex items-start gap-1.5 px-2 py-1.5 text-[12px] transition-colors hover:bg-tv-panel-hover",
                  !enabled && "opacity-50",
                )}
              >
                <button
                  onClick={() => toggleDrawingAlert(d)}
                  aria-label={enabled ? "Pause alert" : "Resume alert"}
                  title={enabled ? "Pause alert" : "Resume alert"}
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded",
                    enabled ? "text-tv-yellow" : "text-tv-text-dim hover:text-tv-text",
                  )}
                >
                  {enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => jumpTo(d.symbol, d.id)}
                  className="min-w-0 flex-1 text-left"
                  title="Select drawing"
                >
                  <div className="truncate font-medium">{d.symbol}</div>
                  <div className="truncate text-[11px] text-tv-text-muted">
                    {kindLabel} · {dirLabel}
                  </div>
                </button>
                <button
                  onClick={() => removeDrawingAlert(d)}
                  aria-label="Delete alert"
                  title="Delete alert"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-tv-text-dim opacity-0 hover:bg-tv-panel-hover hover:text-tv-red group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
