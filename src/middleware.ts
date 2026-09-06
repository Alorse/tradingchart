import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSignedTradeRoute } from "@/lib/auth/trade-routes";

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

  // The app is guest-accessible (see LoginDialog / Header), so *page* routes
  // aren't gated. This call still runs on every matched request for two
  // reasons: it rotates an expiring session and writes the refreshed cookies
  // out through `setAll` above, and its result is the auth gate for the signed
  // `/api/trade/*` routes below.
  //
  // `getClaims()` verifies the session JWT locally (falling back to a network
  // call only when it genuinely can't, e.g. an expired token that needs a
  // refresh), whereas `getUser()` always round-trips to Supabase's auth
  // server; at one middleware run per request that round trip dominated the
  // wall-clock — and therefore the billed compute — of every request.
  //
  // Any error counts as unauthenticated: a failure must close the door on the
  // trade routes, not open it.
  let authenticated = false;
  try {
    const { data } = await supabase.auth.getClaims();
    authenticated = !!data?.claims?.sub;
  } catch {}

  // `/api/trade/*` (minus exchange-info) signs requests with the caller's
  // exchange API key and forwards them to Binance/Bybit. This is the only
  // thing standing between the deployment and being used as an anonymous
  // request-signing relay, so it answers 401 rather than redirecting: these
  // are fetch() calls from the client, and an HTML login page would just be
  // parsed as a garbage response body.
  if (!authenticated && isSignedTradeRoute(request.nextUrl.pathname)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
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
 * routes sign requests against a real exchange, and the 401 above is the only
 * session check they get — no handler under `/api/trade/` checks one itself.
 * Unmatching one of them silently reopens the request-signing relay.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/yahoo|api/fred|api/coingecko|api/trade/exchange-info|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest|js|json|ico)$).*)",
  ],
};
