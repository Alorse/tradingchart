import { describe, it } from "node:test";
import { expect } from "@/test-utils/expect";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps a same-origin absolute path", () => {
    expect(safeNext("/chart")).toBe("/chart");
    expect(safeNext("/chart?symbol=BTCUSDT.P")).toBe("/chart?symbol=BTCUSDT.P");
  });

  it("defaults to the root when absent", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  it("rejects the userinfo bypass that `${origin}${next}` would allow", () => {
    // `https://app.com` + `@evil.com/phish` parses as host evil.com.
    expect(safeNext("@evil.com/phish")).toBe("/");
  });

  it("rejects protocol-relative and absolute URLs", () => {
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("http://evil.com")).toBe("/");
  });

  it("rejects backslash variants browsers treat as slashes", () => {
    expect(safeNext("\\\\evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
  });

  it("rejects control characters that could split the Location header", () => {
    expect(safeNext("/ok\nLocation: https://evil.com")).toBe("/");
    expect(safeNext("/ok\r\nSet-Cookie: x=1")).toBe("/");
  });

  it("allows an @ that is genuinely part of the path", () => {
    expect(safeNext("/users/@alfredo")).toBe("/users/@alfredo");
  });
});
