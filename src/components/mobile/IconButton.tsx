"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Icon-only button sized to the 44px touch-target minimum via padding, while
 * the icon itself stays small (`size-5`) — use this instead of a bare
 * `<button>` for any tap target on mobile screens.
 */
export function IconButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "flex min-h-11 min-w-11 items-center justify-center rounded",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
