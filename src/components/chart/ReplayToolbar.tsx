"use client";

import {
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
  SkipForward,
  StepBack,
  StepForward,
  X,
} from "lucide-react";
import { useReplayStore } from "@/lib/replay/replay-store";
import { cn } from "@/lib/utils";

const SPEEDS = [1, 3, 5, 10] as const;

/**
 * Bar-replay floating control bar (play/step/speed), shown over the chart once
 * replay is active. The entry "Replay" trigger itself lives in the Header, next
 * to Alert. All state lives in the replay store; PriceChart reacts to it to
 * drive the candle feed.
 */
export function ReplayToolbar() {
  const active = useReplayStore((s) => s.active);
  const picking = useReplayStore((s) => s.picking);
  const playing = useReplayStore((s) => s.playing);
  const speed = useReplayStore((s) => s.speed);
  const cursorIndex = useReplayStore((s) => s.cursorIndex);
  const total = useReplayStore((s) => s.total);

  const {
    exit,
    togglePlay,
    stepForward,
    stepBackward,
    setCursor,
    restart,
    setSpeed,
  } = useReplayStore.getState();

  if (!active) return null;

  const atStart = cursorIndex <= 0;
  const atEnd = total > 0 && cursorIndex >= total - 1;

  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded border border-tv-border bg-tv-panel/95 px-1 py-1 text-tv-text-muted shadow-lg backdrop-blur">
      {picking ? (
        <span className="px-2 py-0.5 text-[11px] font-medium text-tv-blue-text">
          Click a bar on the chart to start
        </span>
      ) : (
        <>
          <IconBtn label="Jump to start" onClick={restart} disabled={atStart}>
            <ChevronsLeft className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Step back" onClick={stepBackward} disabled={atStart}>
            <StepBack className="h-4 w-4" />
          </IconBtn>
          <IconBtn label={playing ? "Pause" : "Play"} onClick={togglePlay} highlight={playing}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </IconBtn>
          <IconBtn label="Step forward" onClick={stepForward} disabled={atEnd}>
            <StepForward className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Jump to end" onClick={() => setCursor(total - 1)} disabled={atEnd}>
            <ChevronsRight className="h-4 w-4" />
          </IconBtn>

          <div className="mx-1 h-4 w-px bg-tv-border" />

          {/* Speed */}
          <div className="flex items-center gap-0.5 px-0.5">
            <SkipForward className="h-3 w-3 text-tv-text-dim" />
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={cn(
                  "rounded px-1 text-[10px] font-semibold tabular-nums transition-colors",
                  speed === s
                    ? "bg-tv-blue/20 text-tv-blue-text"
                    : "text-tv-text-dim hover:text-tv-text",
                )}
              >
                {s}x
              </button>
            ))}
          </div>

          <span className="px-1.5 text-[10px] tabular-nums text-tv-text-dim">
            {total > 0 ? `${cursorIndex + 1} / ${total}` : "—"}
          </span>
        </>
      )}

      <div className="mx-1 h-4 w-px bg-tv-border" />
      <IconBtn label="Exit replay" onClick={exit}>
        <X className="h-4 w-4" />
      </IconBtn>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  highlight,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-tv-panel-hover hover:text-tv-text",
        highlight && "text-tv-blue-text",
        disabled && "pointer-events-none opacity-30",
      )}
    >
      {children}
    </button>
  );
}
