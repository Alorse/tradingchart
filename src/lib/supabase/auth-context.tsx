"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./client";

interface AuthContext {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /**
   * Whether the sign-in overlay is showing. The app is guest-accessible, so
   * every entry point (header button, mobile menu, an action that needs an
   * account) only asks for the prompt — the single `LoginDialog` mounted in
   * `providers.tsx` renders it, the way `chart-store`'s dialog flags work.
   */
  loginPromptOpen: boolean;
  promptLogin: () => void;
  closeLoginPrompt: () => void;
}

const AuthCtx = createContext<AuthContext>({
  user: null,
  loading: true,
  signOut: async () => {},
  loginPromptOpen: false,
  promptLogin: () => {},
  closeLoginPrompt: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthCtx.Provider
      value={{
        user,
        loading,
        signOut,
        loginPromptOpen,
        promptLogin: () => setLoginPromptOpen(true),
        closeLoginPrompt: () => setLoginPromptOpen(false),
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
