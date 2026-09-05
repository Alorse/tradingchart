import { NextResponse } from "next/server";
import {
  getBalance,
  getOrders,
  getPositions,
  readAccountParams,
  type Result,
} from "@/lib/exchanges/account";

/**
 * GET /api/trade/sync — batched account snapshot.
 *
 * The polling loop (`useTradingSync`) used to hit `/api/trade/balance`,
 * `/api/trade/orders` and `/api/trade/positions` separately every tick. On
 * Vercel that is three Function invocations *plus* three middleware runs, all
 * billed against Fluid Active CPU, several times a minute, for one logical
 * refresh. This route does the same work in a single invocation, fanning out
 * to the exchange in parallel.
 *
 * `orders` and `positions` are both fetched unscoped (every open order /
 * position on the account for this market type); the client derives the
 * chart-scoped position list from it, and the client-side chart overlay
 * filters orders back down to the charted symbol. Partial failure is not
 * fatal: whichever reads succeeded are returned, and the failures are
 * reported per key so the client can keep the data it still has rather than
 * blanking the whole panel over one bad response.
 */

/** Unwrap a settled read into the payload shape below. */
function unwrap<T>(r: Result<T>): { data: T | null; error: unknown | null } {
  return r.ok ? { data: r.data, error: null } : { data: null, error: r.body };
}

export async function GET(req: Request) {
  try {
    const { creds, isPerp } = readAccountParams(req);

    if (!creds.apiKey || !creds.apiSecret) {
      return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    // One round trip each, in parallel — the wall-clock cost of the whole
    // route is the slowest single call rather than the sum of three.
    //
    // Orders and positions are both fetched unscoped (every open order/position
    // for this market type, not just the charted symbol): `allPositions` feeds
    // the watchlist badges and the bottom "Trading Account" panel, and the
    // account-wide order list is what the Orders table / mobile Trade tab
    // actually need — a chart-scoped fetch here used to make "Open Orders"
    // silently drop every order for a symbol other than the one on screen.
    const [balance, orders, positions] = await Promise.all([
      getBalance(creds, isPerp),
      getOrders(creds, isPerp, ""),
      getPositions(creds, ""),
    ]);

    return NextResponse.json({
      balance: unwrap(balance),
      orders: unwrap(orders),
      positions: unwrap(positions),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
