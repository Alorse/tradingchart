"use client";

import React, { useState } from "react";
import { Bell, BellOff, ChevronRight, Magnet, Star, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChartStore, type DrawingTool } from "@/lib/store/chart-store";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useDrawings } from "@/lib/supabase/use-drawings";
import type { Drawing, AlertConfig } from "@/lib/drawings/types";
import { cn } from "@/lib/utils";
import {
  type ToolDef,
  groupTools,
  groupSections,
  CURSOR_TOOLS,
  LABELED_GROUPS,
} from "./drawing-tools";

/**
 * A single tool button. Right-click toggles favorite (works for every tool,
 * including single-tool categories that have no flyout).
 */
function ToolButton({
  t,
  active,
  favorite,
  onSelect,
  onToggleFavorite,
}: {
  t: ToolDef;
  active: boolean;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  const Icon = t.icon;
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault();
          onToggleFavorite();
        }}
        aria-label={t.label}
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded transition-colors hover:bg-tv-panel-hover",
          active ? "bg-tv-blue/15 text-tv-blue-text" : "text-tv-text-muted hover:text-tv-text",
        )}
      >
        <Icon className="h-7 w-7" />
        {favorite && <Star className="absolute right-0.5 top-0.5 h-2 w-2 fill-tv-yellow text-tv-yellow" />}
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        <div className="font-medium">{t.label}</div>
        {t.hint && <div className="mt-0.5 text-[10px] text-tv-text-muted">{t.hint}</div>}
        <div className="mt-0.5 text-[10px] text-tv-text-muted">
          {favorite ? "Right-click to unfavorite" : "Right-click to favorite"}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function LeftSidebar() {
  const tool = useChartStore((s) => s.tool);
  const setTool = useChartStore((s) => s.setTool);
  const symbol = useChartStore((s) => s.symbol);
  const favoriteTools = useChartStore((s) => s.favoriteTools);
  const toggleFavoriteTool = useChartStore((s) => s.toggleFavoriteTool);
  const selectedId = useDrawingsStore((s) => s.selectedId);
  const drawings = useDrawingsStore((s) => s.drawings);
  const magnetMode = useChartStore((s) => s.magnetMode);
  const toggleMagnetMode = useChartStore((s) => s.toggleMagnetMode);
  const { clear: clearDrawings, update } = useDrawings();

  // Per-category "active" tool — the one whose icon shows on the button.
  const [categoryActive, setCategoryActive] = useState<Record<string, DrawingTool>>(() => {
    const m: Record<string, DrawingTool> = {};
    for (const g of LABELED_GROUPS) {
      if (g.label) m[g.label] = groupTools(g)[0].key;
    }
    return m;
  });

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

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-tv-border bg-tv-panel py-2">
      {/* Cursor */}
      {CURSOR_TOOLS.map((t) => (
        <ToolButton
          key={t.key}
          t={t}
          active={tool === t.key}
          favorite={false}
          onSelect={() => setTool(t.key)}
          onToggleFavorite={() => {}}
        />
      ))}

      {/* Tool categories */}
      {LABELED_GROUPS.map((group, gi) => {
        const tools = groupTools(group);
        if (tools.length === 1) {
          const t = tools[0];
          return (
            <ToolButton
              key={group.label}
              t={t}
              active={tool === t.key}
              favorite={favoriteTools.includes(t.key)}
              onSelect={() => setTool(t.key)}
              onToggleFavorite={() => toggleFavoriteTool(t.key)}
            />
          );
        }
        const activeKey = categoryActive[group.label!] ?? tools[0].key;
        const activeTool = tools.find((t) => t.key === activeKey) ?? tools[0];
        const ActiveIcon = activeTool.icon;
        const groupHasActive = tools.some((t) => t.key === tool);
        return (
          <div key={gi} className="relative">
            <Tooltip>
              <TooltipTrigger
                onClick={() => setTool(activeTool.key)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  toggleFavoriteTool(activeTool.key);
                }}
                aria-label={activeTool.label}
                className={cn(
                  "relative flex h-10 w-10 items-center justify-center rounded transition-colors hover:bg-tv-panel-hover",
                  groupHasActive ? "bg-tv-blue/15 text-tv-blue-text" : "text-tv-text-muted hover:text-tv-text",
                )}
              >
                <ActiveIcon className="h-7 w-7" />
                {favoriteTools.includes(activeTool.key) && (
                  <Star className="absolute right-0.5 top-0.5 h-2 w-2 fill-tv-yellow text-tv-yellow" />
                )}
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                <div className="font-medium">{activeTool.label}</div>
                {activeTool.hint && <div className="mt-0.5 text-[10px] text-tv-text-muted">{activeTool.hint}</div>}
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`${group.label} tools`}
                className="absolute -right-0 bottom-0 flex h-3 w-3 items-center justify-center rounded-tl-[2px] text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
              >
                <ChevronRight className="h-2.5 w-2.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" sideOffset={4} className="min-w-52 bg-tv-panel">
                {groupSections(group).map((section) => (
                  <React.Fragment key={section.label}>
                    <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-tv-text-muted">
                      {section.label}
                    </div>
                    {section.tools.map((t) => {
                      const Icon = t.icon;
                      const isActive = tool === t.key;
                      const isFav = favoriteTools.includes(t.key);
                      return (
                        <DropdownMenuItem
                          key={t.key}
                          onClick={() => {
                            setTool(t.key);
                            setCategoryActive((m) => ({ ...m, [group.label!]: t.key }));
                          }}
                          className={cn("flex items-center gap-2.5 text-xs", isActive && "bg-tv-blue/15 text-tv-blue-text")}
                        >
                          {/* `size-7` (not h-7 w-7) so it beats the menu's default svg size-4 rule */}
                          <Icon className="size-7" />
                          <span>{t.label}</span>
                          <span
                            role="button"
                            aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                            title={isFav ? "Remove from favorites" : "Add to favorites"}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleFavoriteTool(t.key);
                            }}
                            className="ml-auto flex h-6 w-6 items-center justify-center rounded text-tv-text-dim hover:bg-tv-panel-hover hover:text-tv-yellow"
                          >
                            <Star className={cn("h-3.5 w-3.5", isFav && "fill-tv-yellow text-tv-yellow")} />
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                  </React.Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}

      <div className="mt-auto flex w-full flex-col items-center gap-0.5 pb-0.5">
        <div className="my-1 h-px w-6 bg-tv-border-strong" />

        <Tooltip>
          <TooltipTrigger
            onClick={toggleMagnetMode}
            aria-label="Toggle magnet mode"
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded transition-colors",
              magnetMode
                ? "bg-tv-blue/15 text-tv-blue-text"
                : "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
            )}
          >
            <Magnet className="h-7 w-7" />
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            <div className="font-medium">{magnetMode ? "Disable magnet" : "Enable magnet"}</div>
            <div className="mt-0.5 text-[10px] text-tv-text-muted">
              Always snap to OHLC while placing/dragging (same as holding Ctrl)
            </div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            onClick={toggleAlert}
            disabled={!canAlert}
            aria-label="Toggle alert"
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded transition-colors",
              !canAlert && "cursor-not-allowed opacity-30",
              canAlert && alertOn && "bg-tv-yellow/15 text-tv-yellow",
              canAlert && !alertOn && "text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text",
            )}
          >
            {alertOn ? <Bell className="h-7 w-7" /> : <BellOff className="h-7 w-7" />}
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            <div className="font-medium">{alertOn ? "Disable alert" : "Enable alert"}</div>
            <div className="mt-0.5 text-[10px] text-tv-text-muted">
              {canAlert ? "Beeps + toast when price crosses this line" : "Select a horizontal/trend line or ray first"}
            </div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            onClick={() => void clearDrawings(symbol)}
            aria-label="Clear drawings"
            className="flex h-10 w-10 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-red"
          >
            <Trash2 className="h-7 w-7" />
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            <div className="font-medium">Clear drawings</div>
            <div className="mt-0.5 text-[10px] text-tv-text-muted">Remove all on this symbol</div>
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
