"use client";

import { useState } from "react";
import { KeyRound, PlugZap, X } from "lucide-react";
import { useTradingStore } from "@/lib/store/trading-store";
import { cn } from "@/lib/utils";

export function ApiKeyDialog({ onClose }: { onClose: () => void }) {
  const { apiKey, apiSecret, testnet, setCredentials, fetchBalance } = useTradingStore();
  const setConnected = useTradingStore((s) => s.setConnected);
  const exchange = useTradingStore((s) => s.exchange);
  const setExchange = useTradingStore((s) => s.setExchange);
  const symbol = "BTCUSDT";

  const [ex, setEx] = useState(exchange);
  const [key, setKey] = useState(apiKey);
  const [secret, setSecret] = useState(apiSecret);
  const [tn, setTn] = useState(testnet);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const exLabel = ex === "bybit" ? "Bybit" : "Binance";

  async function tryBalance(isPerp: boolean): Promise<{ ok: boolean; error?: string }> {
    const params = new URLSearchParams({
      apiKey: key,
      apiSecret: secret,
      testnet: String(tn),
      isPerp: String(isPerp),
      exchange: ex,
    });
    try {
      const res = await fetch(`/api/trade/balance?${params}`);
      if (res.ok) return { ok: true };
      const data = (await res.json().catch(() => ({}))) as { msg?: string; error?: string };
      return { ok: false, error: data.msg ?? data.error ?? `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "network error" };
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    setExchange(ex);
    setCredentials(key, secret, tn);
    useTradingStore.setState({ exchange: ex, apiKey: key, apiSecret: secret, testnet: tn });

    // The Binance spot testnet (testnet.binance.vision) and futures testnet
    // (testnet.binancefuture.com) are SEPARATE: each requires its own API key.
    // We try futures first since the UI is futures-oriented, then fall back to
    // spot so users with spot-only keys can still connect.
    const futuresResult = await tryBalance(true);
    if (futuresResult.ok) {
      setTestResult("ok");
      setConnected(true);
      await fetchBalance(symbol);
      setTesting(false);
      return;
    }
    const spotResult = await tryBalance(false);
    if (spotResult.ok) {
      setTestResult("ok");
      setConnected(true);
      await fetchBalance(symbol);
      setTesting(false);
      return;
    }
    setTestResult("fail");
    setConnected(false);
    // Show the more informative of the two errors (prefer the futures one
    // since that is the recommended setup).
    setTestError(futuresResult.error ?? spotResult.error ?? null);
    setTesting(false);
  }

  function save() {
    setExchange(ex);
    setCredentials(key, secret, tn);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[400px] rounded-lg border border-tv-border bg-tv-panel shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-tv-border px-4 py-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-tv-blue-text" />
            <span className="text-sm font-semibold text-tv-text">{exLabel} API Credentials</span>
          </div>
          <button onClick={onClose} className="text-tv-text-muted hover:text-tv-text">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* Exchange selector */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-tv-text-muted">Exchange</span>
            <div className="flex gap-1 rounded-md border border-tv-border p-0.5">
              {(["bybit", "binance"] as const).map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    setEx(e);
                    setTestResult(null);
                    setTestError(null);
                  }}
                  className={cn(
                    "rounded px-3 py-1 text-xs capitalize transition-colors",
                    ex === e
                      ? "bg-tv-blue text-white"
                      : "text-tv-text-muted hover:bg-tv-panel-hover",
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Testnet toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-tv-text-muted">Network</span>
            <div className="flex gap-1 rounded-md border border-tv-border p-0.5">
              <button
                onClick={() => setTn(true)}
                className={cn(
                  "rounded px-3 py-1 text-xs transition-colors",
                  tn
                    ? "bg-tv-blue text-white"
                    : "text-tv-text-muted hover:bg-tv-panel-hover",
                )}
              >
                Testnet
              </button>
              <button
                onClick={() => setTn(false)}
                className={cn(
                  "rounded px-3 py-1 text-xs transition-colors",
                  !tn
                    ? "bg-tv-blue text-white"
                    : "text-tv-text-muted hover:bg-tv-panel-hover",
                )}
              >
                Mainnet
              </button>
            </div>
          </div>

          {!tn && (
            <div className="rounded border border-tv-red/40 bg-tv-red/10 px-3 py-2 text-xs text-tv-red">
              Warning: Mainnet uses real funds. Make sure your API key has only the necessary permissions.
            </div>
          )}

          {/* API Key */}
          <div className="space-y-1">
            <label className="text-xs text-tv-text-muted">API Key</label>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={`Enter your ${exLabel} API Key`}
              className="w-full rounded border border-tv-border bg-tv-bg px-3 py-2 text-xs text-tv-text outline-none focus:border-tv-blue"
            />
          </div>

          {/* API Secret */}
          <div className="space-y-1">
            <label className="text-xs text-tv-text-muted">API Secret</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={`Enter your ${exLabel} API Secret`}
              className="w-full rounded border border-tv-border bg-tv-bg px-3 py-2 text-xs text-tv-text outline-none focus:border-tv-blue"
            />
          </div>

          <p className="text-[10px] text-tv-text-dim">
            {ex === "bybit"
              ? "Keys are stored locally in your browser. Use a Unified Trading Account key with Contract/Order + Position read-write permissions."
              : "Keys are stored locally in your browser. Enable “Futures Trading” permission on your API key."}
          </p>

          {/* Test result */}
          {testResult && (
            <div
              className={cn(
                "rounded px-3 py-2 text-xs",
                testResult === "ok"
                  ? "bg-tv-green/15 text-tv-green"
                  : "bg-tv-red/15 text-tv-red",
              )}
            >
              {testResult === "ok"
                ? "Connected successfully!"
                : testError
                  ? `Connection failed: ${testError}`
                  : "Connection failed. Check your API key and permissions."}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-t border-tv-border px-4 py-3">
          <button
            onClick={testConnection}
            disabled={!key || !secret || testing}
            className="flex items-center gap-1.5 rounded border border-tv-border px-3 py-1.5 text-xs text-tv-text transition-colors hover:bg-tv-panel-hover disabled:opacity-50"
          >
            <PlugZap className="h-3.5 w-3.5" />
            {testing ? "Testing…" : "Test connection"}
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-tv-text-muted hover:bg-tv-panel-hover"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!key || !secret}
            className="rounded bg-tv-blue px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-tv-blue/80 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
