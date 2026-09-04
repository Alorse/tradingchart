"use client";

import { Bell, BellOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useAlertsStore, type AlertCondition, type AlertSource } from "@/lib/store/alerts-store";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { useChartStore } from "@/lib/store/chart-store";
import { useMobileStore } from "@/lib/store/mobile-store";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Drawing, DrawingKind } from "@/lib/drawings/types";
import { MobileSheet } from "./MobileSheet";

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
 * Mobile Alerts — same two lists as desktop's `AlertsPanel` (standalone
 * price/RSI/MACD alerts, and drawing-attached ones), rebuilt here rather
 * than reused because that panel's edit/delete buttons are hover-revealed
 * (`opacity-0 group-hover:opacity-100`), which never becomes visible on
 * touch. Actions are always visible instead. Creating a new standalone
 * alert is a right-click on the desktop chart with no mobile equivalent
 * gesture, so this adds its own "+" trigger calling the same
 * `openAlertDialog()` the chart's right-click uses — `CreateAlertDialog`
 * itself needs no adaptation, since `src/app/page.tsx` already mounts it
 * for the mobile branch and it's a centered modal, not hover-dependent.
 */
export function MobileAlertsSheet() {
  const alerts = useAlertsStore((s) => s.alerts);
  const toggleAlert = useAlertsStore((s) => s.toggleAlert);
  const removeAlert = useAlertsStore((s) => s.removeAlert);
  const openAlertDialog = useChartStore((s) => s.openAlertDialog);
  const openEditAlertDialog = useChartStore((s) => s.openEditAlertDialog);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const setSelected = useDrawingsStore((s) => s.setSelected);
  const drawings = useDrawingsStore((s) => s.drawings);
  const { update } = useDrawings();
  const closeSheet = useMobileStore((s) => s.closeSheet);
  const setTab = useMobileStore((s) => s.setTab);

  const drawingAlerts = drawings.filter((d) => d.alert);
  const total = alerts.length + drawingAlerts.length;

  function jumpTo(symbol: string, drawingId?: string) {
    setSymbol(symbol);
    if (drawingId) setSelected(drawingId);
    setTab("chart");
    closeSheet();
  }

  function toggleDrawingAlert(d: Drawing) {
    if (!d.alert) return;
    void update(d.id, { alert: { ...d.alert, enabled: !d.alert.enabled } } as Partial<Drawing>);
  }

  function removeDrawingAlert(d: Drawing) {
    void update(d.id, { alert: null } as Partial<Drawing>);
  }

  return (
    <MobileSheet title="Alerts" onClose={closeSheet}>
      <div>
        <div className="flex items-center justify-between border-b border-tv-border px-3 py-2">
          <span className="text-[11px] text-tv-text-muted">{total} alert{total === 1 ? "" : "s"}</span>
          <button
            onClick={() => openAlertDialog()}
            className="flex items-center gap-1 rounded p-1.5 text-tv-text-muted active:bg-tv-panel-hover active:text-tv-text"
            aria-label="Create alert"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {total === 0 ? (
          <div className="flex h-32 items-center justify-center px-6 text-center text-xs text-tv-text-muted">
            No alerts yet. Tap + to create a price/RSI/MACD alert, or select a
            horizontal/trend line on the chart and use its alert toggle.
          </div>
        ) : (
          <div>
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
                    "flex items-start gap-2 border-b border-tv-border/60 px-3 py-2.5",
                    !a.enabled && "opacity-50",
                  )}
                >
                  <button
                    onClick={() => toggleAlert(a.id)}
                    aria-label={a.enabled ? "Pause alert" : "Resume alert"}
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded",
                      a.enabled ? "text-tv-yellow" : "text-tv-text-dim active:text-tv-text",
                    )}
                  >
                    {a.enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                  </button>
                  <button onClick={() => jumpTo(a.symbol)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{a.symbol}</span>
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
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded text-tv-text-dim active:bg-tv-panel-hover active:text-tv-text"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeAlert(a.id)}
                    aria-label="Delete alert"
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded text-tv-text-dim active:bg-tv-red/15 active:text-tv-red"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}

            {drawingAlerts.length > 0 && (
              <div className="border-t border-tv-border bg-tv-panel/60 px-3 py-1.5 text-[10px] uppercase tracking-wider text-tv-text-muted">
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
                    "flex items-start gap-2 border-b border-tv-border/60 px-3 py-2.5",
                    !enabled && "opacity-50",
                  )}
                >
                  <button
                    onClick={() => toggleDrawingAlert(d)}
                    aria-label={enabled ? "Pause alert" : "Resume alert"}
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded",
                      enabled ? "text-tv-yellow" : "text-tv-text-dim active:text-tv-text",
                    )}
                  >
                    {enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                  </button>
                  <button onClick={() => jumpTo(d.symbol, d.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-medium">{d.symbol}</div>
                    <div className="truncate text-[11px] text-tv-text-muted">
                      {kindLabel} · {dirLabel}
                    </div>
                  </button>
                  <button
                    onClick={() => removeDrawingAlert(d)}
                    aria-label="Delete alert"
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded text-tv-text-dim active:bg-tv-red/15 active:text-tv-red"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </MobileSheet>
  );
}
