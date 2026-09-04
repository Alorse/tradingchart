"use client";

import { useState, useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogPortal,
  DialogOverlay,
} from "@/components/ui/dialog";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useChartStore } from "@/lib/store/chart-store";
import {
  useAlertsStore,
  type AlertCondition,
  type AlertTrigger,
  type AlertSource,
} from "@/lib/store/alerts-store";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const CONDITION_LABELS: Record<AlertCondition, string> = {
  crossing: "Crossing",
  "crossing-up": "Crossing Up",
  "crossing-down": "Crossing Down",
};

const SOURCE_LABELS: Record<AlertSource, string> = {
  price: "Price",
  rsi: "RSI",
  macd: "MACD",
};

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultExpiry(): string {
  return toLocalInput(Date.now() + 24 * 60 * 60 * 1000);
}

function autoMsg(symbol: string, source: AlertSource, condition: AlertCondition, value: number): string {
  if (source === "macd") return `${symbol} MACD ${CONDITION_LABELS[condition]} signal`;
  const level = source === "rsi" ? String(value) : formatPrice(value);
  return `${symbol} ${SOURCE_LABELS[source]} ${CONDITION_LABELS[condition]} ${level}`;
}

function priceStep(value: string): string {
  const n = parseFloat(value);
  if (isNaN(n) || n === 0) return "any";
  if (n >= 1000) return "0.01";
  if (n >= 1) return "0.0001";
  if (n >= 0.01) return "0.000001";
  return "0.00000001";
}

export function CreateAlertDialog() {
  const open = useChartStore((s) => s.alertDialogOpen);
  const closeDialog = useChartStore((s) => s.closeAlertDialog);
  const chartSymbol = useChartStore((s) => s.symbol);
  const defaultPrice = useChartStore((s) => s.alertDialogPrice);
  const currentLivePrice = useChartStore((s) => s.currentLivePrice);
  const editId = useChartStore((s) => s.alertDialogEditId);

  const addAlert = useAlertsStore((s) => s.addAlert);
  const updateAlert = useAlertsStore((s) => s.updateAlert);
  const alerts = useAlertsStore((s) => s.alerts);
  const editingAlert = editId ? alerts.find((a) => a.id === editId) ?? null : null;
  // Editing shows the alert's own symbol (it may differ from the chart
  // currently on screen); creating always targets the chart's symbol.
  const symbol = editingAlert?.symbol ?? chartSymbol;

  const [source, setSource] = useState<AlertSource>("price");
  const [condition, setCondition] = useState<AlertCondition>("crossing");
  const [value, setValue] = useState("");
  const [trigger, setTrigger] = useState<AlertTrigger>("once");
  const [expiry, setExpiry] = useState("");
  const [message, setMessage] = useState("");
  const [sound, setSound] = useState(true);
  const [toast, setToast] = useState(true);
  const [autoMessage, setAutoMessage] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (editingAlert) {
      setSource(editingAlert.source ?? "price");
      setValue(String(editingAlert.value));
      setCondition(editingAlert.condition);
      setTrigger(editingAlert.trigger);
      setExpiry(editingAlert.expiresAt ? toLocalInput(editingAlert.expiresAt) : "");
      setMessage(editingAlert.message);
      setSound(editingAlert.sound);
      setToast(editingAlert.toast);
      setAutoMessage(false);
      return;
    }
    const price = defaultPrice ?? currentLivePrice ?? 0;
    setSource("price");
    setValue(price > 0 ? String(parseFloat(formatPrice(price))) : "");
    setCondition("crossing");
    setTrigger("once");
    setExpiry(defaultExpiry());
    setAutoMessage(true);
    // editingAlert intentionally excluded — its identity changes every
    // render (freshly filtered), so depend on the stable editId instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultPrice, currentLivePrice, editId]);

  // Switching source resets the value to a sensible default for that source.
  function changeSource(next: AlertSource) {
    setSource(next);
    if (next === "rsi") setValue("70");
    else if (next === "macd") setValue("0");
    else setValue(currentLivePrice && currentLivePrice > 0 ? String(parseFloat(formatPrice(currentLivePrice))) : "");
  }

  const numVal = parseFloat(value);
  // MACD watches a line cross (no level); price/RSI need a numeric level.
  const valid = source === "macd" ? true : !isNaN(numVal) && numVal > 0;
  const needsValue = source !== "macd";

  useEffect(() => {
    if (!autoMessage) return;
    setMessage(autoMsg(symbol, source, condition, parseFloat(value) || 0));
  }, [autoMessage, symbol, source, condition, value]);

  function handleCreate() {
    if (!valid) return;
    const expiresAt = expiry ? new Date(expiry).getTime() : null;
    const payload = {
      symbol,
      source,
      condition,
      value: needsValue ? numVal : 0,
      trigger,
      expiresAt,
      message: message || autoMsg(symbol, source, condition, numVal || 0),
      sound,
      toast,
    };
    if (editingAlert) {
      updateAlert(editingAlert.id, payload);
    } else {
      addAlert(payload);
    }
    closeDialog();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeDialog()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 w-full max-w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-tv-border bg-tv-panel shadow-2xl outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-tv-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-tv-text">
                {editingAlert ? "Edit alert on" : "Create alert on"}
              </span>
              <div className="flex items-center gap-1.5 rounded bg-tv-blue/15 px-2 py-0.5">
                <span className="text-xs font-semibold text-tv-blue-text">{symbol}</span>
              </div>
            </div>
            <button
              onClick={closeDialog}
              className="rounded p-0.5 text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="divide-y divide-tv-border">
            {/* Condition */}
            <div className="grid grid-cols-[110px_1fr] gap-x-4 px-4 py-3">
              <span className="pt-1.5 text-xs text-tv-text-muted">Condition</span>
              <div className="flex flex-col gap-2">
                {/* Source */}
                <select
                  value={source}
                  onChange={(e) => changeSource(e.target.value as AlertSource)}
                  className="rounded border border-tv-border bg-tv-bg px-3 py-1.5 text-xs text-tv-text outline-none focus:border-tv-blue"
                >
                  <option value="price">Price</option>
                  <option value="rsi">RSI</option>
                  <option value="macd">MACD (crosses signal)</option>
                </select>
                {/* Operator */}
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as AlertCondition)}
                  className="rounded border border-tv-border bg-tv-bg px-3 py-1.5 text-xs text-tv-text outline-none focus:border-tv-blue"
                >
                  <option value="crossing">Crossing</option>
                  <option value="crossing-up">Crossing Up</option>
                  <option value="crossing-down">Crossing Down</option>
                </select>
                {/* Value row (hidden for MACD, which has no level) */}
                {needsValue && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded border border-tv-border bg-tv-bg px-3 py-1.5">
                      <span className="text-xs text-tv-text-muted">{source === "rsi" ? "Level" : "Value"}</span>
                    </div>
                    <input
                      type="number"
                      value={value}
                      step={source === "rsi" ? "1" : priceStep(value)}
                      min={0}
                      max={source === "rsi" ? 100 : undefined}
                      onChange={(e) => setValue(e.target.value)}
                      className="flex-1 rounded border border-tv-border bg-tv-bg px-3 py-1.5 text-xs text-tv-text outline-none focus:border-tv-blue"
                      placeholder={source === "rsi" ? "RSI level (0–100)" : "Price level"}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Trigger */}
            <div className="grid grid-cols-[110px_1fr] items-center gap-x-4 px-4 py-3">
              <span className="text-xs text-tv-text-muted">Trigger</span>
              <select
                value={trigger}
                onChange={(e) => setTrigger(e.target.value as AlertTrigger)}
                className="rounded border border-tv-border bg-tv-bg px-3 py-1.5 text-xs text-tv-text outline-none focus:border-tv-blue"
              >
                <option value="once">Once only</option>
                <option value="every">Every time</option>
              </select>
            </div>

            {/* Expiration */}
            <div className="grid grid-cols-[110px_1fr] items-center gap-x-4 px-4 py-3">
              <span className="text-xs text-tv-text-muted">Expiration</span>
              <input
                type="datetime-local"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="rounded border border-tv-border bg-tv-bg px-3 py-1.5 text-xs text-tv-text outline-none focus:border-tv-blue [color-scheme:dark]"
              />
            </div>

            {/* Message */}
            <div className="grid grid-cols-[110px_1fr] items-center gap-x-4 px-4 py-3">
              <span className="text-xs text-tv-text-muted">Message</span>
              <input
                type="text"
                value={message}
                onChange={(e) => { setMessage(e.target.value); setAutoMessage(false); }}
                className="rounded border border-tv-border bg-tv-bg px-3 py-1.5 text-xs text-tv-text outline-none focus:border-tv-blue"
                placeholder="Alert message"
              />
            </div>

            {/* Notifications */}
            <div className="grid grid-cols-[110px_1fr] items-center gap-x-4 px-4 py-3">
              <span className="text-xs text-tv-text-muted">Notifications</span>
              <div className="flex items-center gap-5">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-tv-text">
                  <input
                    type="checkbox"
                    checked={toast}
                    onChange={(e) => setToast(e.target.checked)}
                    className="h-3.5 w-3.5 accent-tv-blue"
                  />
                  Toasts
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-tv-text">
                  <input
                    type="checkbox"
                    checked={sound}
                    onChange={(e) => setSound(e.target.checked)}
                    className="h-3.5 w-3.5 accent-tv-blue"
                  />
                  Sound
                </label>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 rounded-b-lg border-t border-tv-border bg-tv-bg/40 px-4 py-3">
            {!valid && value !== "" && (
              <span className="mr-auto flex items-center gap-1 text-xs text-tv-red">
                <AlertTriangle className="h-3 w-3" />
                {source === "rsi" ? "Enter a valid RSI level" : "Enter a valid price"}
              </span>
            )}
            <button
              onClick={closeDialog}
              className="rounded px-4 py-1.5 text-xs text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!valid}
              className={cn(
                "rounded px-4 py-1.5 text-xs font-semibold transition-colors",
                valid
                  ? "bg-tv-blue text-white hover:bg-tv-blue/90"
                  : "cursor-not-allowed bg-tv-blue/30 text-white/50",
              )}
            >
              {editingAlert ? "Save" : "Create"}
            </button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
