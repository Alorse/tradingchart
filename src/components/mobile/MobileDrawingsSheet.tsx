"use client";

import { Bell, BellOff, Magnet, Star, Trash2 } from "lucide-react";
import { useChartStore, type DrawingTool } from "@/lib/store/chart-store";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { useMobileStore } from "@/lib/store/mobile-store";
import type { Drawing, AlertConfig } from "@/lib/drawings/types";
import { MobileSheet } from "./MobileSheet";
import { cn } from "@/lib/utils";
import {
  ALL_TOOLS,
  CURSOR_TOOLS,
  LABELED_GROUPS,
  groupSections,
  type ToolDef,
} from "@/components/layout/drawing-tools";

/**
 * Mobile-friendly drawing tools picker — fullscreen sheet that replaces the
 * desktop LeftSidebar on small screens. Pulls the SAME tool catalog
 * (`drawing-tools.ts`) desktop does, so a tool added there shows up here too
 * without a second list to maintain, and adds the utility actions the
 * desktop sidebar keeps at its bottom (magnet mode, per-drawing alert
 * toggle, clear drawings) plus a per-tool favorite star, since there's no
 * right-click to favorite from on touch.
 */
export function MobileDrawingsSheet() {
  const tool = useChartStore((s) => s.tool);
  const setTool = useChartStore((s) => s.setTool);
  const symbol = useChartStore((s) => s.symbol);
  const favoriteTools = useChartStore((s) => s.favoriteTools);
  const toggleFavoriteTool = useChartStore((s) => s.toggleFavoriteTool);
  const magnetMode = useChartStore((s) => s.magnetMode);
  const toggleMagnetMode = useChartStore((s) => s.toggleMagnetMode);
  const selectedId = useDrawingsStore((s) => s.selectedId);
  const drawings = useDrawingsStore((s) => s.drawings);
  const { clear: clearDrawings, update } = useDrawings();
  const closeSheet = useMobileStore((s) => s.closeSheet);

  const selected = drawings.find((d) => d.id === selectedId);
  const canAlert =
    selected &&
    (selected.kind === "hline" ||
      selected.kind === "hray" ||
      selected.kind === "trendline" ||
      selected.kind === "ray");
  const alertOn = canAlert ? !!selected?.alert?.enabled : false;

  function toggleAlert() {
    if (!selected || !canAlert) return;
    const newAlert: AlertConfig = { enabled: !alertOn, sound: true, direction: "cross", lastTriggeredAt: undefined };
    void update(selected.id, { alert: newAlert } as Partial<Drawing>);
  }

  function pick(t: DrawingTool) {
    setTool(t);
    closeSheet();
  }

  const favorites = favoriteTools
    .map((k) => ALL_TOOLS[k])
    .filter((t): t is ToolDef => !!t);

  return (
    <MobileSheet title="Drawing tools" onClose={closeSheet}>
      {/* Utility actions — same bottom-of-sidebar actions desktop has */}
      <div className="border-b border-tv-border/60">
        <UtilityRow
          icon={Magnet}
          label="Magnet mode"
          hint="Always snap to OHLC while placing/dragging"
          active={magnetMode}
          onClick={toggleMagnetMode}
        />
        <UtilityRow
          icon={alertOn ? Bell : BellOff}
          label={alertOn ? "Alert enabled" : "Alert on selected line"}
          hint={canAlert ? "Beeps + toast when price crosses this line" : "Select a horizontal/trend line or ray first"}
          active={!!alertOn}
          disabled={!canAlert}
          onClick={toggleAlert}
        />
        <button
          onClick={() => void clearDrawings(symbol)}
          className="flex w-full items-center gap-3 px-3 py-3 text-left text-tv-red active:bg-tv-red/10"
        >
          <Trash2 className="h-5 w-5" />
          <span className="text-sm font-medium">Clear drawings</span>
        </button>
      </div>

      {favorites.length > 0 && (
        <ToolSectionList
          label="Favorites"
          tools={favorites}
          activeTool={tool}
          favoriteTools={favoriteTools}
          onPick={pick}
          onToggleFavorite={toggleFavoriteTool}
        />
      )}

      <ToolSectionList
        label={null}
        tools={CURSOR_TOOLS}
        activeTool={tool}
        favoriteTools={favoriteTools}
        onPick={pick}
        onToggleFavorite={toggleFavoriteTool}
      />

      {LABELED_GROUPS.map((group) =>
        groupSections(group).map((section) => (
          <ToolSectionList
            key={`${group.label}-${section.label}`}
            label={section.label}
            tools={section.tools}
            activeTool={tool}
            favoriteTools={favoriteTools}
            onPick={pick}
            onToggleFavorite={toggleFavoriteTool}
          />
        )),
      )}
    </MobileSheet>
  );
}

function ToolSectionList({
  label, tools, activeTool, favoriteTools, onPick, onToggleFavorite,
}: {
  label: string | null;
  tools: ToolDef[];
  activeTool: DrawingTool;
  favoriteTools: DrawingTool[];
  onPick: (t: DrawingTool) => void;
  onToggleFavorite: (t: DrawingTool) => void;
}) {
  return (
    <section>
      {label && (
        <h3 className="bg-tv-panel/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
          {label}
        </h3>
      )}
      {tools.map((t) => {
        const Icon = t.icon;
        const active = activeTool === t.key;
        const isFav = favoriteTools.includes(t.key);
        return (
          <div
            key={t.key}
            className={cn(
              "flex items-center gap-3 border-b border-tv-border/60",
              active && "bg-tv-blue/15",
            )}
          >
            <button
              onClick={() => onPick(t.key)}
              className="flex flex-1 items-center gap-3 py-3 pl-3 text-left active:bg-tv-panel-hover"
            >
              <Icon className={cn("h-5 w-5", active ? "text-tv-blue-text" : "text-tv-text-muted")} />
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{t.label}</span>
                {t.hint && <span className="text-[10px] text-tv-text-muted">{t.hint}</span>}
              </div>
            </button>
            <button
              onClick={() => onToggleFavorite(t.key)}
              aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
              className="flex h-10 w-10 shrink-0 items-center justify-center text-tv-text-dim active:text-tv-yellow"
            >
              <Star className={cn("h-4 w-4", isFav && "fill-tv-yellow text-tv-yellow")} />
            </button>
          </div>
        );
      })}
    </section>
  );
}

function UtilityRow({
  icon: Icon, label, hint, active, disabled, onClick,
}: {
  icon: typeof Magnet;
  label: string;
  hint: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-3 text-left active:bg-tv-panel-hover",
        disabled && "opacity-40",
      )}
    >
      <Icon className={cn("h-5 w-5", active ? "text-tv-blue-text" : "text-tv-text-muted")} />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className={cn("text-sm font-medium", active && "text-tv-blue-text")}>{label}</span>
        <span className="text-[10px] text-tv-text-muted">{hint}</span>
      </div>
    </button>
  );
}
