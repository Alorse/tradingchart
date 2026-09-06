"use client";

import {
  ChevronRight,
  KeyRound,
  Palette,
  Bell,
  Activity,
  LogOut,
  User,
} from "lucide-react";
import { useTradingStore } from "@/lib/store/trading-store";
import { useChartStore } from "@/lib/store/chart-store";
import { useDrawingsStore } from "@/lib/store/drawings-store";
import { useAlertsStore } from "@/lib/store/alerts-store";
import { useMobileStore } from "@/lib/store/mobile-store";
import { useAuth } from "@/lib/supabase/auth-context";
import { cn } from "@/lib/utils";

/**
 * Mobile Menu tab — vertical list of settings entries.
 * Tapping each entry opens the corresponding fullscreen sheet or dialog.
 */
export function MenuScreen() {
  const apiKey = useTradingStore((s) => s.apiKey);
  const testnet = useTradingStore((s) => s.testnet);
  const exchange = useTradingStore((s) => s.exchange);
  const openSheet = useMobileStore((s) => s.openSheet);
  const { user, signOut, promptLogin } = useAuth();
  const exLabel = exchange === "bybit" ? "Bybit" : "Binance";
  const activeAlerts = useAlertsStore((s) => s.alerts.filter((a) => a.enabled).length);
  const activeDrawingAlerts = useDrawingsStore(
    (s) => s.drawings.filter((d) => d.alert?.enabled).length,
  );
  const activeAlertCount = activeAlerts + activeDrawingAlerts;

  // Open the chart settings dialog (reuse desktop component).
  function openChartSettings() {
    useChartStore.getState().setChartSettingsOpen(true);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Profile header */}
      <header className="flex items-center gap-3 border-b border-tv-border bg-tv-panel px-4 py-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-tv-bg ring-1 ring-tv-border">
          <User className="h-6 w-6 text-tv-text-muted" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">
            {apiKey ? "Connected" : "Not connected"}
          </span>
          <span className="text-[11px] text-tv-text-muted">
            {apiKey ? `${exLabel} · ${testnet ? "Testnet" : "Mainnet"}` : "Add your API keys to trade"}
          </span>
        </div>
      </header>

      {/* Sections */}
      <Section title="Trading">
        <Row
          icon={KeyRound}
          label="API credentials"
          hint={apiKey ? (testnet ? "Testnet" : "Mainnet") : "Not set"}
          onClick={() => openSheet("apiKey")}
        />
        <Row
          icon={Bell}
          label="Alerts"
          hint={activeAlertCount > 0 ? `${activeAlertCount} active` : undefined}
          onClick={() => openSheet("alerts")}
        />
      </Section>

      <Section title="Chart">
        <Row
          icon={Activity}
          label="Indicators"
          onClick={() => openSheet("indicators")}
        />
        <Row
          icon={Palette}
          label="Chart appearance"
          onClick={openChartSettings}
        />
      </Section>

      <div className="mt-auto px-4 py-6">
        <button
          onClick={user ? () => void signOut() : promptLogin}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded border border-tv-border px-3 py-2.5 text-sm",
            user
              ? "text-tv-red active:bg-tv-red/10"
              : "text-tv-text active:bg-tv-panel-hover",
          )}
        >
          {user && <LogOut className="h-4 w-4" />}
          {user ? "Sign out" : "Login"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="bg-tv-panel/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}

function Row({
  icon: Icon, label, hint, onClick,
}: {
  icon: typeof KeyRound;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 border-b border-tv-border/60 px-3 py-3 text-left active:bg-tv-panel-hover",
      )}
    >
      <Icon className="h-4 w-4 text-tv-text-muted" />
      <span className="flex-1 text-sm">{label}</span>
      {hint && <span className="text-[10px] text-tv-text-muted">{hint}</span>}
      <ChevronRight className="h-4 w-4 text-tv-text-muted" />
    </button>
  );
}
