import type { Drawing } from "@/lib/drawings/types";
import type {
  IndicatorKey,
  IndicatorConfig,
  AdxStyle,
  DmiTradeZoneStyle,
  SqueezeStyle,
  UserEMA,
} from "@/lib/store/chart-store";

// ── Drawing ops (unchanged from previous history.ts) ─────────────────────────
export type DrawingOp =
  | { type: "add"; drawing: Drawing }
  | { type: "remove"; drawing: Drawing }
  | { type: "update"; id: string; previous: Drawing; next: Drawing };

// ── Chart state snapshot — only the fields that can change ───────────────────
export interface ChartStateSnapshot {
  indicators?: Record<IndicatorKey, boolean>;
  hidden?: Record<IndicatorKey, boolean>;
  config?: IndicatorConfig;
  userEMAs?: UserEMA[];
  adxStyle?: AdxStyle;
  dmiTradeZoneStyle?: DmiTradeZoneStyle;
  squeezeStyle?: SqueezeStyle;
  logScale?: boolean;
  indicatorLogScale?: Partial<Record<IndicatorKey, boolean>>;
  mainPriceScaleMode?: "normal" | "percentage" | "indexed100";
  mainPriceScaleInverted?: boolean;
  indicatorOverlays?: Partial<Record<IndicatorKey, IndicatorKey | "own">>;
}

// ── Viewport ─────────────────────────────────────────────────────────────────
export interface ViewportRange {
  from: number;
  to: number;
}

// ── Unified op ───────────────────────────────────────────────────────────────
export type UnifiedOp =
  | { kind: "drawing"; op: DrawingOp }
  | { kind: "drawingOrder"; symbol: string; before: string[]; after: string[] }
  | { kind: "chartState"; before: ChartStateSnapshot; after: ChartStateSnapshot }
  | { kind: "viewport"; before: ViewportRange; after: ViewportRange };

const MAX_HISTORY = 100;

export class UnifiedHistoryStack {
  private undoStack: UnifiedOp[] = [];
  private redoStack: UnifiedOp[] = [];

  push(op: UnifiedOp) {
    this.undoStack.push(op);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  popUndo(): UnifiedOp | null {
    const op = this.undoStack.pop() ?? null;
    if (op) this.redoStack.push(op);
    return op;
  }

  popRedo(): UnifiedOp | null {
    const op = this.redoStack.pop() ?? null;
    if (op) this.undoStack.push(op);
    return op;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }
}

export const unifiedHistory = new UnifiedHistoryStack();

// ── Viewport applier — registered by PriceChart at mount time ────────────────
let _viewportApplier: ((range: ViewportRange) => void) | null = null;

export function registerViewportApplier(fn: (range: ViewportRange) => void) {
  _viewportApplier = fn;
}

export function applyViewport(range: ViewportRange) {
  _viewportApplier?.(range);
}

// ── Guard: prevent re-recording history during undo/redo application ─────────
export let isApplyingHistory = false;

export function withoutHistory(fn: () => void) {
  isApplyingHistory = true;
  try {
    fn();
  } finally {
    isApplyingHistory = false;
  }
}
