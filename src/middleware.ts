import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // `getClaims()` verifies the session JWT locally (falling back to a network
  // call only when it genuinely can't, e.g. an expired token that needs a
  // refresh), whereas `getUser()` always round-trips to Supabase's auth
  // server. At one middleware run per request that round trip dominated the
  // wall-clock — and therefore the billed compute — of every single request.
  // Any unexpected failure is treated as "not authenticated", so the worst
  // case is a redirect to /login rather than an open door.
  let authenticated = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    authenticated = !error && !!data?.claims?.sub;
  } catch {
    authenticated = false;
  }

  // Redirect to /login unless authenticated or already on /login or /auth/*
  if (
    !authenticated &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

/**
 * Every matched request runs this middleware as its own serverless invocation,
 * *before* Vercel's CDN cache is consulted — so a matched path can never be
 * served purely from cache, no matter what `Cache-Control` its route sets.
 *
 * The public data proxies below serve identical, credential-free market data
 * to everyone and set long `Cache-Control` headers precisely so the CDN can
 * answer repeat hits without running any function. Excluding them here is what
 * actually makes that work; gating them behind auth bought nothing anyway,
 * since the data they return is public.
 *
 * `/api/trade/*` (minus exchange-info) deliberately stays matched: those
 * routes sign requests against a real exchange, and the session check keeps
 * the deployment from being used as an open proxy by a stranger.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/yahoo|api/fred|api/coingecko|api/trade/exchange-info|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest|js|json|ico)$).*)",
  ],
};
