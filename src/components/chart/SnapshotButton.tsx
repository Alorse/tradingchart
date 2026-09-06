"use client";

import { useState } from "react";
import { Camera, Check, Copy, Download, Link2, Loader2 } from "lucide-react";
import { captureChart, snapshotFilename } from "@/lib/chart/snapshot";
import { uploadSnapshot } from "@/lib/supabase/snapshots-data";
import { useAuth } from "@/lib/supabase/auth-context";
import { useChartStore } from "@/lib/store/chart-store";
import { useToastStore } from "@/lib/alerts/toast-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoginDialog } from "@/components/auth/LoginDialog";
import { cn } from "@/lib/utils";

type Busy = "link" | "image" | "file" | null;

/**
 * Chart snapshot menu: upload for a shareable link (the journal use case),
 * copy the PNG straight to the clipboard, or save it to disk.
 */
export function SnapshotButton() {
  const { user } = useAuth();
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const pushToast = useToastStore((s) => s.push);
  const [busy, setBusy] = useState<Busy>(null);
  const [copied, setCopied] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  function flashCopied() {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function fail(message: string) {
    pushToast({ variant: "alert", title: "Snapshot failed", message });
  }

  async function copyLink() {
    // Uploading needs an owner-prefixed Supabase Storage path — prompt sign-in
    // instead of letting the upload fail with an RLS error.
    if (!user) {
      setLoginOpen(true);
      return;
    }
    setBusy("link");
    try {
      const blob = await captureChart();
      if (!blob) throw new Error("Chart is not ready yet.");
      const { url } = await uploadSnapshot(blob, snapshotFilename(symbol, timeframe));
      await navigator.clipboard.writeText(url);
      flashCopied();
      pushToast({
        variant: "info",
        title: "Snapshot link copied",
        message: url,
        ttlMs: 8000,
      });
    } catch (e) {
      fail(e instanceof Error ? e.message : "Could not upload the snapshot.");
    } finally {
      setBusy(null);
    }
  }

  async function copyImage() {
    setBusy("image");
    try {
      // Hand ClipboardItem the promise rather than an awaited blob: Safari
      // drops the user-gesture permission across an await.
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": captureChart().then((b) => {
            if (!b) throw new Error("Chart is not ready yet.");
            return b;
          }),
        }),
      ]);
      flashCopied();
    } catch (e) {
      fail(
        e instanceof Error && e.message.includes("not ready")
          ? e.message
          : "Your browser blocked the clipboard. Use “Download” instead.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy("file");
    try {
      const blob = await captureChart();
      if (!blob) throw new Error("Chart is not ready yet.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = snapshotFilename(symbol, timeframe);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      fail(e instanceof Error ? e.message : "Could not save the snapshot.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Snapshot"
          title="Chart snapshot"
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-tv-panel-hover",
            copied ? "text-tv-green" : "text-tv-text-muted hover:text-tv-text",
          )}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Camera className="h-3.5 w-3.5" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52 bg-tv-panel">
          <DropdownMenuItem onClick={copyLink} className="text-xs">
            <Link2 className="h-3.5 w-3.5" />
            <span>Copy image link</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={copyImage} className="text-xs">
            <Copy className="h-3.5 w-3.5" />
            <span>Copy image</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={download} className="text-xs">
            <Download className="h-3.5 w-3.5" />
            <span>Download PNG</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </>
  );
}
