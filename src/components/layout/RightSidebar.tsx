"use client";

import { useRef, useState } from "react";
import { BarChart2, Bell, Layers, List } from "lucide-react";
import { Watchlist } from "@/components/watchlist/Watchlist";
import { TradePanel } from "@/components/trading/TradePanel";
import { ObjectTreePanel } from "@/components/chart/ObjectTreePanel";
import { AlertsPanel } from "@/components/alerts/AlertsPanel";
import { useAlertsStore } from "@/lib/store/alerts-store";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useChartStore } from "@/lib/store/chart-store";
import { cn } from "@/lib/utils";

export function RightSidebar() {
  // Tab lives in the store so the chart's Trade/Buy/Sell overlay can open the
  // order panel.
  const tab = useChartStore((s) => s.rightSidebarTab);
  const setTab = useChartStore((s) => s.setRightSidebarTab);
  const width = useChartStore((s) => s.rightSidebarWidth);
  const setWidth = useChartStore((s) => s.setRightSidebarWidth);
  const activeAlerts = useAlertsStore((s) => s.alerts.filter((a) => a.enabled).length);
  const activeDrawingAlerts = useDrawingsStore(
    (s) => s.drawings.filter((d) => d.alert?.enabled).length,
  );
  const activeAlertCount = activeAlerts + activeDrawingAlerts;

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [resizing, setResizing] = useState(false);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };
    setResizing(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResizeMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    // The sidebar sits on the right edge, so dragging the left border left
    // (negative dx) grows it and dragging right shrinks it.
    const dx = e.clientX - dragRef.current.startX;
    // Leave room for the chart column so it can never be squeezed to nothing;
    // the store applies the absolute bounds on top of this.
    const maxWidth = Math.max(200, window.innerWidth - 420);
    setWidth(Math.min(maxWidth, dragRef.current.startWidth - dx));
  }
  function endResize(e: React.PointerEvent) {
    dragRef.current = null;
    setResizing(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  return (
    <aside
      className="relative flex shrink-0 flex-row border-l border-tv-border bg-tv-panel"
      style={{ width }}
    >
      {/* Resize handle — drag the left edge to resize */}
      <div
        onPointerDown={startResize}
        onPointerMove={onResizeMove}
        onPointerUp={endResize}
        className={cn(
          "absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize",
          resizing && "bg-tv-blue/30",
        )}
      />

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={cn("flex-1 overflow-hidden", tab !== "watchlist" && "hidden")}>
          <Watchlist />
        </div>
        <div className={cn("flex-1 overflow-hidden", tab !== "objects" && "hidden")}>
          <ObjectTreePanel />
        </div>
        <div className={cn("flex-1 overflow-hidden", tab !== "trade" && "hidden")}>
          <TradePanel />
        </div>
        <div className={cn("flex-1 overflow-hidden", tab !== "alerts" && "hidden")}>
          <AlertsPanel />
        </div>
      </div>

      {/* Vertical tab rail, flush against the right edge */}
      <div className="flex w-12 shrink-0 flex-col border-l border-tv-border bg-tv-panel">
        <RailTab
          active={tab === "watchlist"}
          onClick={() => setTab("watchlist")}
          icon={List}
          label="Watchlist"
        />
        <RailTab
          active={tab === "objects"}
          onClick={() => setTab("objects")}
          icon={Layers}
          label="Objects"
        />
        <RailTab
          active={tab === "trade"}
          onClick={() => setTab("trade")}
          icon={BarChart2}
          label="Trade"
        />
        <RailTab
          active={tab === "alerts"}
          onClick={() => setTab("alerts")}
          icon={Bell}
          label="Alerts"
          badge={activeAlertCount}
        />
      </div>
    </aside>
  );
}

function RailTab({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof List;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center gap-1 border-l-2 py-2.5 text-[9px] font-medium transition-colors",
        active
          ? "border-tv-blue bg-tv-panel-hover text-tv-blue-text"
          : "border-transparent text-tv-text-muted hover:bg-tv-bg hover:text-tv-text",
      )}
    >
      <span className="relative">
        <Icon className="h-4 w-4" />
        {!!badge && badge > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-tv-blue px-0.5 text-[8px] font-semibold leading-none text-white">
            {badge}
          </span>
        )}
      </span>
      {label}
    </button>
  );
}
