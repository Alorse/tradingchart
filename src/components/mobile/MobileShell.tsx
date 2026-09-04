"use client";

import { List, LineChart, ArrowLeftRight, Menu as MenuIcon } from "lucide-react";
import { useMobileStore, type MobileTab } from "@/lib/store/mobile-store";
import { cn } from "@/lib/utils";
import { WatchlistScreen } from "./WatchlistScreen";
import { ChartScreen } from "./ChartScreen";
import { TradeScreen } from "./TradeScreen";
import { MenuScreen } from "./MenuScreen";
import { MobileSheetsRoot } from "./MobileSheetsRoot";

/**
 * Mobile UI shell — full-screen container with a fixed bottom tab bar.
 * State-based routing (no URL changes) for an app-like feel.
 */
export function MobileShell() {
  const tab = useMobileStore((s) => s.tab);

  return (
    <div className="fixed inset-0 flex flex-col bg-tv-bg text-tv-text">
      <main className="min-h-0 flex-1 overflow-hidden">
        {tab === "watchlist" && <WatchlistScreen />}
        {tab === "chart" && <ChartScreen />}
        {tab === "trade" && <TradeScreen />}
        {tab === "menu" && <MenuScreen />}
      </main>
      <BottomTabBar />
      <MobileSheetsRoot />
    </div>
  );
}

interface TabDef {
  id: MobileTab;
  label: string;
  Icon: typeof List;
}

const TABS: TabDef[] = [
  { id: "watchlist", label: "Watchlist", Icon: List },
  { id: "chart",     label: "Chart",     Icon: LineChart },
  { id: "trade",     label: "Trade",     Icon: ArrowLeftRight },
  { id: "menu",      label: "Menu",      Icon: MenuIcon },
];

function BottomTabBar() {
  const tab = useMobileStore((s) => s.tab);
  const setTab = useMobileStore((s) => s.setTab);

  return (
    <nav
      className="grid shrink-0 grid-cols-4 border-t border-tv-border bg-tv-panel"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      role="tablist"
      aria-label="Main navigation"
    >
      {TABS.map(({ id, label, Icon }) => {
        const active = tab === id;
        return (
          <button
            key={id}
            onClick={() => setTab(id)}
            role="tab"
            aria-selected={active}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2 transition-colors",
              active ? "text-tv-blue-text" : "text-tv-text-muted active:text-tv-text",
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
