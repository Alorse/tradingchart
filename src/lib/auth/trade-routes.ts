/**
 * Which `/api/trade/*` paths require an authenticated session.
 *
 * Dependency-free leaf module so the middleware (Edge runtime) and the unit
 * tests can both use it without dragging Supabase in.
 *
 * Everything under `/api/trade` signs a request with the caller's exchange API
 * key and forwards it to Binance/Bybit, so an unauthenticated caller would be
 * using the deployment as a free request-signing relay. The one exception is
 * `exchange-info`, which returns public, credential-free instrument metadata
 * and is deliberately left open (and excluded from the middleware matcher) so
 * the CDN can serve it without invoking anything — including for guests, who
 * need it to render the chart.
 */
const TRADE_PREFIX = "/api/trade";
const PUBLIC_TRADE_PATHS = new Set(["/api/trade/exchange-info"]);

/**
 * True when `pathname` addresses a credential-signing trade route, i.e. one
 * that must 401 without a session.
 */
export function isSignedTradeRoute(pathname: string): boolean {
  // Lowercase and drop a trailing slash so neither casing nor `/order/` can
  // slip a request past the check on its way to the same route handler.
  let p = pathname.toLowerCase();
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p !== TRADE_PREFIX && !p.startsWith(`${TRADE_PREFIX}/`)) return false;
  return !PUBLIC_TRADE_PATHS.has(p);
}
