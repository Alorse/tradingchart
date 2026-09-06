import { test } from "node:test";
import { expect } from "@/test-utils/expect";
import { utcDateKey } from "./daily-open";

test("utcDateKey formats a date as UTC YYYY-MM-DD", () => {
  expect(utcDateKey(new Date(Date.UTC(2026, 8, 5, 23, 59, 0)))).toBe("2026-09-05");
});

test("utcDateKey uses the UTC calendar day, not local wall time", () => {
  expect(utcDateKey(new Date(Date.UTC(2026, 8, 6, 0, 0, 0)))).toBe("2026-09-06");
});
