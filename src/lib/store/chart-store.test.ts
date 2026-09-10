import { beforeEach, describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { useChartStore, migrateChartState } from "./chart-store";

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
});
