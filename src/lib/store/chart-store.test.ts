import { beforeEach, describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import {
  useChartStore,
  migrateChartState,
  isSubPaneKey,
  DEFAULT_DMI_TRADE_ZONE_STYLE,
} from "./chart-store";

beforeEach(() => {
  useChartStore.setState({ favoriteTools: [] });
});

describe("chart-store favorites", () => {
  it("toggles a tool on then off", () => {
    useChartStore.getState().toggleFavoriteTool("trendline");
    expect(useChartStore.getState().favoriteTools).toContain("trendline");
    useChartStore.getState().toggleFavoriteTool("trendline");
    expect(useChartStore.getState().favoriteTools).not.toContain("trendline");
  });

  it("keeps multiple favorites in insertion order", () => {
    useChartStore.getState().toggleFavoriteTool("trendline");
    useChartStore.getState().toggleFavoriteTool("text");
    useChartStore.getState().toggleFavoriteTool("arrow");
    expect(useChartStore.getState().favoriteTools).toEqual(["trendline", "text", "arrow"]);
  });

  it("removing a middle favorite preserves the rest", () => {
    useChartStore.getState().toggleFavoriteTool("trendline");
    useChartStore.getState().toggleFavoriteTool("text");
    useChartStore.getState().toggleFavoriteTool("arrow");
    useChartStore.getState().toggleFavoriteTool("text");
    expect(useChartStore.getState().favoriteTools).toEqual(["trendline", "arrow"]);
  });
});

describe("chart-store visibleBars default and migration", () => {
  it("defaults to 0 (auto to TradingView's own density)", () => {
    expect(useChartStore.getState().visibleBars).toBe(0);
  });

  it("migrates a pre-v10 persisted default of exactly 150 to 0 (auto)", () => {
    const migrated = migrateChartState({ visibleBars: 150 }, 9) as { visibleBars: number };
    expect(migrated.visibleBars).toBe(0);
  });

  it("leaves a real pre-v10 zoom (any value other than 150) untouched", () => {
    const migrated = migrateChartState({ visibleBars: 300 }, 9) as { visibleBars: number };
    expect(migrated.visibleBars).toBe(300);
  });

  it("leaves an already-migrated 0 untouched", () => {
    const migrated = migrateChartState({ visibleBars: 0 }, 10) as { visibleBars: number };
    expect(migrated.visibleBars).toBe(0);
  });

  it("does not touch visibleBars when it was never persisted", () => {
    const migrated = migrateChartState({}, 9) as { visibleBars?: number };
    expect(migrated.visibleBars).toBe(undefined);
  });

  it("heals the pre-v10 fitContent() artifact: a persisted 1000 (full load size) resets to auto", () => {
    const migrated = migrateChartState({ visibleBars: 1000 }, 9) as { visibleBars: number };
    expect(migrated.visibleBars).toBe(0);
  });

  it("resets exactly the 995 threshold to auto", () => {
    const migrated = migrateChartState({ visibleBars: 995 }, 9) as { visibleBars: number };
    expect(migrated.visibleBars).toBe(0);
  });

  it("leaves a real measured TradingView-density zoom (236) untouched", () => {
    const migrated = migrateChartState({ visibleBars: 236 }, 9) as { visibleBars: number };
    expect(migrated.visibleBars).toBe(236);
  });

  it("also heals the fitContent() artifact for a user who already migrated through v10", () => {
    const migrated = migrateChartState({ visibleBars: 1000 }, 10) as { visibleBars: number };
    expect(migrated.visibleBars).toBe(0);
  });

  it("leaves an already-auto 0 untouched at v11", () => {
    const migrated = migrateChartState({ visibleBars: 0 }, 10) as { visibleBars: number };
    expect(migrated.visibleBars).toBe(0);
  });
});

describe("chart-store DMI Trade Zone migration (v12)", () => {
  it("adds the dmitz key to a persisted indicators/hidden map that predates it", () => {
    const migrated = migrateChartState(
      { indicators: { rsi: true, volume: true }, hidden: { rsi: false } },
      11,
    ) as { indicators: Record<string, boolean>; hidden: Record<string, boolean> };
    expect(migrated.indicators.dmitz).toBe(false);
    expect(migrated.hidden.dmitz).toBe(false);
  });

  it("keeps every indicator the user already had on", () => {
    const migrated = migrateChartState(
      { indicators: { rsi: true, macd: true, adx: true, volume: false } },
      11,
    ) as { indicators: Record<string, boolean> };
    expect(migrated.indicators.rsi).toBe(true);
    expect(migrated.indicators.macd).toBe(true);
    expect(migrated.indicators.adx).toBe(true);
    expect(migrated.indicators.volume).toBe(false);
  });

  it("fills in the DMI Trade Zone inputs with Pine's defaults", () => {
    const migrated = migrateChartState({ config: { rsi: 21 } }, 11) as {
      config: Record<string, unknown>;
    };
    expect(migrated.config.dmiTzDiLen).toBe(14);
    expect(migrated.config.dmiTzAdxLen).toBe(14);
    expect(migrated.config.dmiTzKeyLevel).toBe(23);
    expect(migrated.config.dmiTzPlotDi).toBe(false);
  });

  it("does not touch a customised period the user already persisted", () => {
    const migrated = migrateChartState({ config: { rsi: 21, adx: 20, adxKeyLevel: 25 } }, 11) as {
      config: Record<string, unknown>;
    };
    expect(migrated.config.rsi).toBe(21);
    expect(migrated.config.adx).toBe(20);
    expect(migrated.config.adxKeyLevel).toBe(25);
  });

  it("seeds the style slice with the Pine colours and widths", () => {
    const migrated = migrateChartState({}, 11) as {
      dmiTradeZoneStyle: Record<string, unknown>;
    };
    expect(migrated.dmiTradeZoneStyle).toEqual({ ...DEFAULT_DMI_TRADE_ZONE_STYLE });
  });

  it("leaves an existing dmiTradeZoneStyle alone while filling any missing field", () => {
    const migrated = migrateChartState(
      { dmiTradeZoneStyle: { adxUpColor: "#123456", showZone: false } },
      11,
    ) as { dmiTradeZoneStyle: Record<string, unknown> };
    expect(migrated.dmiTradeZoneStyle.adxUpColor).toBe("#123456");
    expect(migrated.dmiTradeZoneStyle.showZone).toBe(false);
    expect(migrated.dmiTradeZoneStyle.adxLineWidth).toBe(DEFAULT_DMI_TRADE_ZONE_STYLE.adxLineWidth);
    expect(migrated.dmiTradeZoneStyle.shadowColor).toBe(DEFAULT_DMI_TRADE_ZONE_STYLE.shadowColor);
  });

  it("does not re-run for state already at v12", () => {
    const migrated = migrateChartState({ indicators: { rsi: true } }, 12) as {
      indicators: Record<string, boolean>;
      dmiTradeZoneStyle?: unknown;
    };
    expect(migrated.indicators.dmitz).toBe(undefined);
    expect(migrated.dmiTradeZoneStyle).toBe(undefined);
  });
});

describe("chart-store DMI Trade Zone defaults", () => {
  it("starts off, in its own sub-pane, with Pine's inputs", () => {
    const s = useChartStore.getState();
    expect(s.indicators.dmitz).toBe(false);
    expect(s.config.dmiTzDiLen).toBe(14);
    expect(s.config.dmiTzAdxLen).toBe(14);
    expect(s.config.dmiTzKeyLevel).toBe(23);
    expect(s.config.dmiTzPlotDi).toBe(false);
    expect(isSubPaneKey("dmitz")).toBe(true);
  });

  it("patches its style slice without disturbing the rest", () => {
    useChartStore.getState().setDmiTradeZoneStyle({ showZone: false });
    expect(useChartStore.getState().dmiTradeZoneStyle.showZone).toBe(false);
    expect(useChartStore.getState().dmiTradeZoneStyle.adxUpColor).toBe(
      DEFAULT_DMI_TRADE_ZONE_STYLE.adxUpColor,
    );
    useChartStore.getState().setDmiTradeZoneStyle({ showZone: true });
  });
});
