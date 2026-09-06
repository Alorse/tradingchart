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

  // The app is guest-accessible, so nothing is gated here any more. The result
  // is deliberately discarded: this call exists only for its side effect, since
  // `getClaims()` rotates an expiring session and writes the refreshed cookies
  // out through `setAll` above. A failure just means no refresh happened.
  try {
    await supabase.auth.getClaims();
  } catch {}

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
 * `/api/trade/*` (minus exchange-info) stays matched, but note what that buys
 * now: the middleware stopped gating on the session when guest access landed,
 * so matching those routes no longer keeps a stranger from using the
 * deployment as a request-signing relay. No handler under `/api/trade/`
 * checks a session either. If that protection is wanted back it belongs in the
 * handlers (or `lib/exchanges/account.ts`), not in a matcher — an edge matcher
 * enforcing an invariant owned by eight route handlers is how it got dropped
 * by deleting a single `if`.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/yahoo|api/fred|api/coingecko|api/trade/exchange-info|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest|js|json|ico)$).*)",
  ],
};
