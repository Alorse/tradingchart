import type { CloseReason } from "./paper-engine";

/**
 * Compact human duration for a closed paper trade's `durationMs`, e.g. for
 * the history table. Escalates units only as far as needed to stay readable
 * — a two-day trade doesn't need its seconds, but a 40-second scalp doesn't
 * need a leading "0h". Each tier below 1 unit of the next one up shows two
 * components (minutes+seconds, hours+minutes, days+hours); anything under a
 * minute is seconds alone.
 */
export function formatDuration(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const minutes = totalMinutes % 60;
    return `${totalHours}h ${String(minutes).padStart(2, "0")}m`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days}d ${hours}h`;
}

const REASON_LABELS: Record<CloseReason, string> = {
  MANUAL: "Manual",
  TP: "TP",
  SL: "SL",
  LIQUIDATION: "Liquidation",
};

/** Human-readable label for a `PaperTrade.reason`. */
export function reasonLabel(reason: CloseReason): string {
  return REASON_LABELS[reason];
}
