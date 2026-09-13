import assert from "node:assert/strict";

/**
 * Tiny Jest/Vitest-style `expect` over node:assert, so the offline `node --test`
 * suite reads like the matchers everyone knows. Only the matchers the suite
 * actually uses are implemented.
 */
export function expect(actual: unknown) {
  const base = {
    toBe(expected: unknown) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected: unknown) {
      assert.deepStrictEqual(actual, expected);
    },
    toContain(item: unknown) {
      assert.ok(
        Array.isArray(actual) || typeof actual === "string",
        "toContain expects an array or string",
      );
      assert.ok(
        (actual as unknown[] | string).includes(item as never),
        `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`,
      );
    },
    toHaveLength(n: number) {
      assert.strictEqual((actual as { length: number }).length, n);
    },
    toBeCloseTo(expected: number, digits = 2) {
      const tol = Math.pow(10, -digits) / 2 + 1e-9;
      assert.ok(
        Math.abs((actual as number) - expected) < tol,
        `expected ${actual} to be close to ${expected} (±${tol})`,
      );
    },
    toBeGreaterThan(n: number) {
      assert.ok((actual as number) > n, `expected ${actual} > ${n}`);
    },
    toBeLessThan(n: number) {
      assert.ok((actual as number) < n, `expected ${actual} < ${n}`);
    },
    toBeNull() {
      assert.strictEqual(actual, null);
    },
  };
  return {
    ...base,
    not: {
      toBe(expected: unknown) {
        assert.notStrictEqual(actual, expected);
      },
      toContain(item: unknown) {
        assert.ok(
          !(actual as unknown[] | string).includes(item as never),
          `expected ${JSON.stringify(actual)} not to contain ${JSON.stringify(item)}`,
        );
      },
    },
  };
}
