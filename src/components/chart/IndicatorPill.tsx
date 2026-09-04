"use client";

import { Eye, EyeOff, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  value?: string;
  color: string;
  hidden: boolean;
  onToggleHide: () => void;
  onSettings: () => void;
  onRemove: () => void;
}

export function IndicatorPill({
  name,
  value,
  color,
  hidden,
  onToggleHide,
  onSettings,
  onRemove,
}: Props) {
  return (
    <div
      className={cn(
        "group/pill pointer-events-auto flex items-center gap-1.5 rounded bg-tv-panel/95 px-1.5 py-0.5 text-[11px] shadow-sm ring-1 ring-tv-border backdrop-blur",
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className={cn("font-medium", hidden ? "text-tv-text-disabled" : "text-tv-text")}>
        {name}
      </span>
      {value !== undefined && (
        <span className={cn("tabular-nums", hidden ? "text-tv-text-disabled" : "text-tv-text-muted")}>
          {value}
        </span>
      )}
      <div className="ml-1 flex items-center gap-0.5">
        <button
          onClick={onToggleHide}
          title={hidden ? "Show" : "Hide"}
          aria-label={hidden ? "Show" : "Hide"}
          className="rounded p-0.5 text-tv-text-dim transition-colors hover:bg-tv-panel-hover hover:text-tv-text"
        >
          {hidden ? (
            <EyeOff className="h-3 w-3" />
          ) : (
            <Eye className="h-3 w-3" />
          )}
        </button>
        <button
          onClick={onSettings}
          title="Settings"
          aria-label="Settings"
          className="rounded p-0.5 text-tv-text-dim transition-colors hover:bg-tv-panel-hover hover:text-tv-text"
        >
          <Settings className="h-3 w-3" />
        </button>
        <button
          onClick={onRemove}
          title="Remove"
          aria-label="Remove"
          className="rounded p-0.5 text-tv-text-dim transition-colors hover:bg-tv-panel-hover hover:text-tv-red"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
