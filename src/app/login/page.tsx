"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";

/**
 * `/auth/callback` redirects here with `?error=auth` when the code exchange
 * fails (expired or already-used magic link, mostly). Nothing used to read the
 * param, so the user landed on a blank sign-in screen with no idea why they
 * weren't signed in.
 */
const ERROR_MESSAGES: Record<string, string> = {
  auth: "Authentication failed — that sign-in link may have expired or already been used. Please try again.",
};

function LoginPanel() {
  const router = useRouter();
  const error = useSearchParams().get("error");

  return (
    <LoginForm
      onSuccess={() => router.push("/")}
      notice={
        error
          ? (ERROR_MESSAGES[error] ?? "Authentication failed — please try again.")
          : undefined
      }
    />
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-tv-bg">
      <div className="w-full max-w-sm px-6">
        {/* `useSearchParams` client-side renders the tree up to the nearest
            boundary, and a static page without one fails the production
            build outright. */}
        <Suspense fallback={<LoginForm />}>
          <LoginPanel />
        </Suspense>
      </div>
    </div>
  );
}
