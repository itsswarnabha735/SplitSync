import { describe, expect, it } from "vitest";

import { centsToMoney, parseMoneyInputToCents } from "./money";

describe("money input helpers", () => {
  it("parses positive decimal input into cents", () => {
    expect(parseMoneyInputToCents("12.34")).toBe(1234);
  });

  it("rejects empty, non-numeric, and non-positive inputs", () => {
    expect(parseMoneyInputToCents("")).toBeNull();
    expect(parseMoneyInputToCents("12abc")).toBeNull();
    expect(parseMoneyInputToCents("0")).toBeNull();
    expect(parseMoneyInputToCents("-1")).toBeNull();
  });

  it("rounds through cents before storing money", () => {
    expect(centsToMoney(parseMoneyInputToCents("10.004")!)).toBe(10);
    expect(centsToMoney(parseMoneyInputToCents("10.005")!)).toBe(10.01);
  });
});
