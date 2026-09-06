"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { LoginForm } from "@/components/auth/LoginForm";

/**
 * Login as a closable overlay — guests can dismiss it (X, backdrop, Esc) and
 * keep browsing the chart; it never blocks access.
 */
export function LoginDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <LoginForm onSuccess={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
