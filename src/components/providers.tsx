"use client";

import { AuthProvider } from "@/lib/supabase/auth-context";
import { useCloudSync } from "@/lib/supabase/use-cloud-sync";
import { useDrawingsSync } from "@/lib/supabase/use-drawings-sync";
import { usePaperAccountSync } from "@/lib/supabase/use-paper-account-sync";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useTradingSync } from "@/hooks/useTradingSync";
import { useBybitSymbols } from "@/hooks/useBybitSymbols";
import { usePaperExposureFeed } from "@/hooks/usePaperExposureFeed";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AlertsToast } from "@/components/alerts/AlertsToast";
import { PaperTradeToasts } from "@/components/trading/PaperTradeToasts";

function CloudSyncInner({ children }: { children: React.ReactNode }) {
  useCloudSync();
  useDrawingsSync();
  usePaperAccountSync();
  useKeyboardShortcuts();
  useTradingSync();
  useBybitSymbols();
  usePaperExposureFeed();
  return (
    <>
      {children}
      <AlertsToast />
      <PaperTradeToasts />
    </>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <TooltipProvider delay={150}>
        <CloudSyncInner>{children}</CloudSyncInner>
      </TooltipProvider>
    </AuthProvider>
  );
}
