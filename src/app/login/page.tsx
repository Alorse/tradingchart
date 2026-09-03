"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TrendingUp } from "lucide-react";

type Mode = "magic" | "password" | "signup";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError("");

    if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
        setStatus("error");
      } else {
        setStatus("sent");
      }
      return;
    }

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
        setStatus("error");
      } else {
        setStatus("sent");
      }
      return;
    }

    // password login
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setStatus("error");
    } else {
      location.href = "/";
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#131722]">
      <div className="w-full max-w-sm space-y-8 px-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2962ff]/15">
            <TrendingUp className="h-6 w-6 text-[#2962ff]" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-[#d1d4dc]">TradingView Free</h1>
            <p className="mt-1 text-sm text-[#787b86]">Real-time crypto charts</p>
          </div>
        </div>

        {status === "sent" ? (
          <div className="rounded-lg border border-[#26a69a]/30 bg-[#26a69a]/10 p-4 text-center text-sm text-[#26a69a]">
            {mode === "magic"
              ? "Check your email — we sent you a sign-in link."
              : "Account created. Check your email to confirm."}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Mode tabs */}
            <div className="flex rounded-lg border border-[#2a2e39] bg-[#1e222d] p-1">
              {(["magic", "password", "signup"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError(""); setStatus("idle"); }}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                    mode === m
                      ? "bg-[#2962ff] text-white"
                      : "text-[#787b86] hover:text-[#d1d4dc]"
                  }`}
                >
                  {m === "magic" ? "Magic Link" : m === "password" ? "Password" : "Sign up"}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                required
                className="w-full rounded-lg border border-[#2a2e39] bg-[#1e222d] px-3 py-2.5 text-sm text-[#d1d4dc] placeholder-[#787b86] outline-none focus:border-[#2962ff] transition-colors"
              />

              {(mode === "password" || mode === "signup") && (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                  minLength={6}
                  className="w-full rounded-lg border border-[#2a2e39] bg-[#1e222d] px-3 py-2.5 text-sm text-[#d1d4dc] placeholder-[#787b86] outline-none focus:border-[#2962ff] transition-colors"
                />
              )}
            </div>

            {error && (
              <p className="text-xs text-[#ef5350]">{error}</p>
            )}

            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full rounded-lg bg-[#2962ff] py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {status === "loading"
                ? "Loading…"
                : mode === "magic"
                ? "Send link"
                : mode === "signup"
                ? "Create account"
                : "Sign in"}
            </button>
          </form>
        )}

        <p className="text-center text-[10px] text-[#787b86]">
          Free · No card · No ads
        </p>
      </div>
    </div>
  );
}
