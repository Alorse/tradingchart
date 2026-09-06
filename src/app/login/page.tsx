"use client";

import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-tv-bg">
      <div className="w-full max-w-sm px-6">
        <LoginForm onSuccess={() => router.push("/")} />
      </div>
    </div>
  );
}
