"use client";

import { useEffect, useRef } from "react";
import {
  useChartStore,
  DEFAULT_CONFIG,
  ALL_INDICATORS_FALSE,
} from "@/lib/store/chart-store";
import {
  loadChartSettings,
  saveChartSettings,
  loadWatchlists,
  saveWatchlists,
} from "./user-data";
import { useAuth } from "./auth-context";

const DEBOUNCE_MS = 1500;

/** The debounced saves are fire-and-forget, but a rejected one still has to
 *  say so — otherwise a cloud write that never landed looks exactly like one
 *  that did. Same helper, same reason, as `usePaperAccountSync`. */
function logSaveFailure(err: unknown) {
  console.error("Failed to save chart settings/watchlists to Supabase", err);
}

export function useCloudSync() {
  const { user } = useAuth();
  /** Load *attempted* — guards the one-shot init effect against re-running. */
  const initializedRef = useRef(false);
  /**
   * Load *succeeded* — gates both debounced saves below. Separate from
   * `initializedRef` because that one flips synchronously at the top of the
   * init effect: sharing it would let a load slower than `DEBOUNCE_MS` (or one
   * that fails outright) upsert this device's localStorage state over a cloud
   * row it never read. Same split, and same reasoning, as `usePaperAccountSync`.
   */
  const loadedRef = useRef(false);
  /**
   * Id of the user the two refs above describe.
   *
   * The guards used to key on `user` merely being *present*, and the reset
   * below only fired on `!user`. `onAuthStateChange` can hand us a new session
   * with no intervening `null` — a direct account switch, or another tab's
   * sign-in broadcast — and on that transition `initializedRef` stayed `true`,
   * so user B's data was never loaded, while `loadedRef` stayed `true`, so B's
   * very next store mutation debounce-upserted *A's* chart settings and all of
   * A's watchlists into B's row. Keyed on the id instead, mirroring
   * `usePaperAccountSync`'s `prevUserIdRef`.
   */
  const prevUserIdRef = useRef<string | null>(null);

  // ── Fields synced to the cloud ───────────────────────────────────────────
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const indicators = useChartStore((s) => s.indicators);
  const hidden = useChartStore((s) => s.hidden);
  const config = useChartStore((s) => s.config);
  const chartColors = useChartStore((s) => s.chartColors);
  const adxStyle = useChartStore((s) => s.adxStyle);
  const squeezeStyle = useChartStore((s) => s.squeezeStyle);
  const bollingerStyle = useChartStore((s) => s.bollingerStyle);
  const vwapStyle = useChartStore((s) => s.vwapStyle);
  const volumeProfile = useChartStore((s) => s.volumeProfile);
  const keyLevels = useChartStore((s) => s.keyLevels);
  const userEMAs = useChartStore((s) => s.userEMAs);
  const chartType = useChartStore((s) => s.chartType);
  const watchlists = useChartStore((s) => s.watchlists);
  const activeWatchlistId = useChartStore((s) => s.activeWatchlistId);

  const setSymbol = useChartStore((s) => s.setSymbol);
  const setTimeframe = useChartStore((s) => s.setTimeframe);

  // ── Initial load on sign-in, reset on sign-out / user switch ─────────────
  // One effect, not two: the reset has to run *ahead of* the load's early
  // return. As a separate effect declared below this one it ran too late — on
  // a direct A -> B switch the load effect had already bailed on the stale
  // `initializedRef`, so B never loaded at all.
  useEffect(() => {
    const userId = user?.id ?? null;
    if (prevUserIdRef.current !== userId) {
      prevUserIdRef.current = userId;
      initializedRef.current = false;
      loadedRef.current = false;
    }

    if (!userId || initializedRef.current) return;
    initializedRef.current = true;

    /** The signed-in user changed while this load was in flight. Its result
     *  describes whoever was signed in when it started, so applying it (or
     *  flipping `loadedRef` off the back of it) would drop one user's cloud
     *  state into another's session — and the switch has already queued a
     *  fresh load for the current user. */
    const isStale = () => prevUserIdRef.current !== userId;

    // `userId` is passed in rather than closed over: it is narrowed to a
    // string by the early return above, but a hoisted function declaration
    // doesn't inherit that narrowing.
    async function init(uid: string) {
      const [settings, wl] = await Promise.all([
        loadChartSettings(),
        loadWatchlists(),
      ]);
      if (isStale()) return;

      if (settings) {
        setSymbol(settings.symbol);
        setTimeframe(settings.timeframe);
        // A row written before an indicator existed has no key for it, and an
        // undefined slot would leave `indicators`/`config` incomplete — so
        // every load is merged onto the current defaults, never assigned raw.
        useChartStore.setState({
          indicators: { ...ALL_INDICATORS_FALSE, ...settings.indicators },
          hidden: { ...ALL_INDICATORS_FALSE, ...settings.hidden },
          config: { ...DEFAULT_CONFIG, ...(settings.config ?? {}) },
        });

        // Visual settings: colors, indicator styles, EMAs, chartType
        const vs = settings.visual_settings;
        if (vs) {
          useChartStore.setState({
            ...(vs.chartColors   && { chartColors:   vs.chartColors }),
            ...(vs.adxStyle      && { adxStyle:      vs.adxStyle }),
            ...(vs.squeezeStyle  && { squeezeStyle:  vs.squeezeStyle }),
            ...(vs.bollingerStyle && { bollingerStyle: vs.bollingerStyle }),
            ...(vs.vwapStyle     && { vwapStyle:     vs.vwapStyle }),
            ...(vs.volumeProfile && { volumeProfile: vs.volumeProfile }),
            ...(vs.keyLevels     && { keyLevels:     vs.keyLevels }),
            ...(vs.userEMAs      !== undefined && { userEMAs: vs.userEMAs }),
            ...(vs.chartType     && { chartType:     vs.chartType }),
          });
        }
      }

      // Watchlists: cloud wins, wholesale. Every named list now lives in the
      // row, so a partial merge into the local active list would be merging
      // two complete pictures of the same thing — the cloud copy is the more
      // recently-written device and simply replaces what this one has. A row
      // predating migration 06 arrives here already folded into a single
      // "Default" list by `rowToWatchlists`, so it takes the same path.
      if (wl) {
        useChartStore.setState({
          watchlists: wl.lists,
          activeWatchlistId: wl.activeId,
        });
      } else {
        // No watchlist data in the cloud at all (first sign-in on this
        // account): seed the row from this device instead of waiting for the
        // user to happen to edit a list.
        const { watchlists: local, activeWatchlistId: localActive } =
          useChartStore.getState();
        // Awaited, not fire-and-forget: a rejected seed used to escape the
        // `.catch` below while `loadedRef` flipped `true` anyway, so the
        // session carried on debounce-saving against a row that was never
        // created. Letting it reject leaves the flag matching reality.
        await saveWatchlists(uid, local, localActive);
      }
    }

    init(userId)
      .then(() => {
        if (isStale()) return;
        loadedRef.current = true;
      })
      .catch((err) => {
        // Leave `loadedRef` false so the debounced saves stay gated off for
        // the rest of this sign-in: better to sync nothing than to upsert
        // local state over a cloud row the load never actually read. Which
        // load failed, and why, is the loader's to say — `loadWatchlists`
        // names its own migration dependency (an unapplied migration 06 lands
        // here, since it selects columns that don't exist yet).
        console.error(
          "Failed to load settings/watchlists from Supabase; skipping cloud sync this session",
          err,
        );
      });
  }, [user, setSymbol, setTimeframe]);

  // ── Debounced settings sync (indicators + visual) ────────────────────────
  // No timer ref: React runs an effect's cleanup before the next run of that
  // same effect, so the pending timeout is always cleared by the line below
  // and a local handle is enough.
  useEffect(() => {
    if (!user || !loadedRef.current) return;
    const timer = setTimeout(() => {
      saveChartSettings(user.id, {
        symbol,
        timeframe,
        indicators,
        hidden,
        config,
        visual_settings: {
          chartColors,
          adxStyle,
          squeezeStyle,
          bollingerStyle,
          vwapStyle,
          volumeProfile,
          keyLevels,
          userEMAs,
          chartType,
        },
      }).catch(logSaveFailure);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    user,
    symbol, timeframe, indicators, hidden, config,
    chartColors, adxStyle, squeezeStyle, bollingerStyle, vwapStyle, volumeProfile,
    keyLevels, userEMAs, chartType,
  ]);

  // ── Debounced watchlist sync (every named list, not just the active one) ──
  useEffect(() => {
    if (!user || !loadedRef.current) return;
    const timer = setTimeout(() => {
      saveWatchlists(user.id, watchlists, activeWatchlistId).catch(logSaveFailure);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [user, watchlists, activeWatchlistId]);
}
