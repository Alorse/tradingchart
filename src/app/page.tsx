"use client";

import { Header } from "@/components/layout/Header";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { FavoritesBar } from "@/components/layout/FavoritesBar";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { BottomPanel } from "@/components/layout/BottomPanel";
import { PositionsPanel } from "@/components/layout/PositionsPanel";
import { PaperPositionsPanel } from "@/components/layout/PaperPositionsPanel";
import { PriceChart } from "@/components/chart/PriceChart";
import { IndicatorSettingsDialog } from "@/components/chart/IndicatorSettingsDialog";
import { ChartSettingsDialog } from "@/components/chart/ChartSettingsDialog";
import { DrawingSettingsDialog } from "@/components/chart/DrawingSettingsDialog";
import { CreateAlertDialog } from "@/components/alerts/CreateAlertDialog";
import { MobileShell } from "@/components/mobile/MobileShell";
import { useChartStore } from "@/lib/store/chart-store";
import { useIsMobile } from "@/hooks/useIsMobile";

export default function HomePage() {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <>
        <MobileShell />
        {/* Reuse the desktop dialogs — they're already viewport-aware. */}
        <IndicatorSettingsDialog />
        <ChartSettingsDialog />
        <DrawingSettingsDialog />
        <CreateAlertDialog />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-tv-bg">
      <Header />
      <div className="flex min-h-0 flex-1">
        <LeftSidebar />
        {/* min-w-0 lets the chart column actually shrink: a flex item defaults
            to min-width:auto, which would otherwise pin it to its content width
            and push the resizable right sidebar off-screen. */}
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <PriceChart symbol={symbol} timeframe={timeframe} />
          </div>
          <FavoritesBar />
          <PositionsPanel />
          <PaperPositionsPanel />
        </main>
        <RightSidebar />
      </div>
      <BottomPanel />
      <IndicatorSettingsDialog />
      <ChartSettingsDialog />
      <DrawingSettingsDialog />
      <CreateAlertDialog />
    </div>
  );
}
