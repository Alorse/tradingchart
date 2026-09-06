"use client";

import { useState } from "react";
import { Bell, LogOut, Redo2, Rewind, Settings2, Undo2 } from "lucide-react";
import { SymbolSelector } from "@/components/chart/SymbolSelector";
import { TimeframeSelector } from "@/components/chart/TimeframeSelector";
import { ChartTypeSelector } from "@/components/chart/ChartTypeSelector";
import { IndicatorMenu } from "@/components/chart/IndicatorMenu";
import { SnapshotButton } from "@/components/chart/SnapshotButton";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/supabase/auth-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDrawings } from "@/lib/supabase/use-drawings";
import { useChartStore } from "@/lib/store/chart-store";
import { useReplayStore } from "@/lib/replay/replay-store";
import { LoginDialog } from "@/components/auth/LoginDialog";

export function Header() {
  const { user, loading, signOut } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const { undo, redo } = useDrawings();
  const setChartSettingsOpen = useChartStore((s) => s.setChartSettingsOpen);
  const openAlertDialog = useChartStore((s) => s.openAlertDialog);
  const currentLivePrice = useChartStore((s) => s.currentLivePrice);
  const replayActive = useReplayStore((s) => s.active);
  const enterReplayPicking = useReplayStore((s) => s.enterPicking);

  return (
    <header className="flex h-10 items-center justify-between border-b border-tv-border bg-tv-panel px-3">
      <div className="flex items-center gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.svg"
          alt="Logo"
          width={28}
          height={28}
          className="mr-1 rounded-md"
        />
        <SymbolSelector />
        <Separator orientation="vertical" className="h-6 bg-tv-border-strong" />
        <TimeframeSelector />
        <Separator orientation="vertical" className="mx-1 h-6 bg-tv-border-strong" />
        <ChartTypeSelector />
        <Separator orientation="vertical" className="mx-1 h-6 bg-tv-border-strong" />
        <IndicatorMenu />
        <Separator orientation="vertical" className="mx-1 h-6 bg-tv-border-strong" />
        <Tooltip>
          <TooltipTrigger
            onClick={() => openAlertDialog(currentLivePrice ?? undefined)}
            aria-label="Create alert"
            className="flex h-7 items-center gap-1.5 rounded px-2 text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            <Bell className="size-5" />
            <span className="text-xs">Alert</span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <div className="font-medium">Create alert</div>
            <div className="mt-0.5 text-[10px] text-tv-text-muted">Alt+A</div>
          </TooltipContent>
        </Tooltip>
        {!replayActive && (
          <Tooltip>
            <TooltipTrigger
              onClick={enterReplayPicking}
              aria-label="Bar replay"
              className="flex h-7 items-center gap-1.5 rounded px-2 text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
            >
              <Rewind className="size-5" />
              <span className="text-xs">Replay</span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <div className="font-medium">Bar replay</div>
              <div className="mt-0.5 text-[10px] text-tv-text-muted">Step through history</div>
            </TooltipContent>
          </Tooltip>
        )}
        <Separator orientation="vertical" className="mx-1 h-6 bg-tv-border-strong" />
        <Tooltip>
          <TooltipTrigger
            onClick={() => void undo()}
            aria-label="Undo"
            className="flex h-7 w-7 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            <Undo2 className="size-5" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <div className="font-medium">Undo</div>
            <div className="mt-0.5 text-[10px] text-tv-text-muted">Ctrl+Z</div>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            onClick={() => void redo()}
            aria-label="Redo"
            className="flex h-7 w-7 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            <Redo2 className="size-5" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <div className="font-medium">Redo</div>
            <div className="mt-0.5 text-[10px] text-tv-text-muted">Ctrl+Shift+Z</div>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-center gap-2">
        <SnapshotButton />
        <Tooltip>
          <TooltipTrigger
            onClick={() => setChartSettingsOpen(true)}
            aria-label="Chart settings"
            className="flex h-7 w-7 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            <Settings2 className="size-5" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Chart settings
          </TooltipContent>
        </Tooltip>
        {user ? (
          <>
            <Separator orientation="vertical" className="h-6 bg-tv-border-strong" />
            <div className="flex items-center gap-2">
              <span className="max-w-[140px] truncate text-xs text-tv-text-muted">
                {user.email}
              </span>
              <Tooltip>
                <TooltipTrigger
                  onClick={signOut}
                  className="flex h-7 w-7 items-center justify-center rounded text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-red"
                >
                  <LogOut className="size-5" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Sign out
                </TooltipContent>
              </Tooltip>
            </div>
          </>
        ) : (
          !loading && (
            <>
              <Separator orientation="vertical" className="h-6 bg-tv-border-strong" />
              <button
                onClick={() => setLoginOpen(true)}
                className="rounded px-2 py-1 text-xs font-medium text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
              >
                Login
              </button>
            </>
          )
        )}
      </div>
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </header>
  );
}
