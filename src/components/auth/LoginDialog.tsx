"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { LoginForm } from "@/components/auth/LoginForm";
import { useAuth } from "@/lib/supabase/auth-context";

/**
 * Login as a closable overlay — guests can dismiss it (X, backdrop, Esc) and
 * keep browsing the chart; it never blocks access. Self-contained and mounted
 * once in `providers.tsx`: call `useAuth().promptLogin()` to open it.
 */
export function LoginDialog() {
  const { loginPromptOpen, closeLoginPrompt } = useAuth();

  return (
    <Dialog open={loginPromptOpen} onOpenChange={(open) => !open && closeLoginPrompt()}>
      <DialogContent>
        <LoginForm onSuccess={closeLoginPrompt} />
      </DialogContent>
    </Dialog>
  );
}
