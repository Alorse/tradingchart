"use client";

import { cn } from "@/lib/utils";

/**
 * The chrome the live (`PositionsPanel`) and paper (`PaperPositionsPanel`)
 * account panels share. Both are the same TradingView-style docked panel and
 * are meant to hit-align and hover identically; these four were duplicated
 * verbatim in each, so a restyle silently applied to one mode only.
 */

/** One labelled figure in a panel's stats strip. */
export function Stat({
  label, value, valueClass,
}: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] text-tv-text-muted">{label}</span>
      <span className={cn("font-mono text-xs tabular-nums", valueClass ?? "text-tv-text")}>
        {value}
      </span>
    </div>
  );
}

/** Count pill sitting after a tab's label. */
export function Badge({ n }: { n: number }) {
  return <span className="ml-1 rounded bg-tv-blue/20 px-1 text-[9px] font-bold text-tv-blue-text">{n}</span>;
}

/**
 * A tab in a panel's tab strip. `className` exists for the paper panel, whose
 * tabs need `flex items-center` to align an icon child; the live panel's tabs
 * are text plus an inline badge and must stay on the baseline, so the flex
 * box is opt-in rather than baked in.
 */
export function TabBtn({
  active, onClick, className, children,
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        className,
        "border-b-2 px-3 py-1.5 text-[11px] font-medium transition-colors",
        active
          ? "border-tv-blue text-tv-text"
          : "border-transparent text-tv-text-muted hover:text-tv-text",
      )}
    >
      {children}
    </button>
  );
}

/** Centered placeholder filling an empty tab body. */
export function Stub({ message }: { message: string }) {
  return (
    <div className="flex h-32 items-center justify-center text-xs text-tv-text-muted">
      {message}
    </div>
  );
}
