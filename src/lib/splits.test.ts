import { describe, expect, it } from "vitest";
import { buildSplits, splitsToMap } from "./splits";

describe("buildSplits - EQUAL", () => {
  it("splits evenly when divisible", () => {
    const res = buildSplits({
      splitType: "EQUAL",
      amount: 90,
      equalParticipantIds: ["a", "b", "c"],
      exactDistribution: {},
    });
    expect(res.ok).toBe(true);
    expect(res.splits).toEqual([
      ["a", 30],
      ["b", 30],
      ["c", 30],
    ]);
  });

  it("distributes rounding remainder by cents", () => {
    const res = buildSplits({
      splitType: "EQUAL",
      amount: 100,
      equalParticipantIds: ["a", "b", "c"],
      exactDistribution: {},
    });
    expect(res.ok).toBe(true);
    const total = res.splits.reduce((s, [, amt]) => s + amt, 0);
    expect(total).toBeCloseTo(100, 2);
    // 33.34 / 33.33 / 33.33 in some order
    const amounts = res.splits.map(([, amt]) => amt).sort();
    expect(amounts).toEqual([33.33, 33.33, 33.34]);
  });

  it("errors when no participants selected", () => {
    const res = buildSplits({
      splitType: "EQUAL",
      amount: 10,
      equalParticipantIds: [],
      exactDistribution: {},
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("at least one");
  });
});

describe("buildSplits - EXACT", () => {
  it("accepts portions that sum to the total", () => {
    const res = buildSplits({
      splitType: "EXACT",
      amount: 50,
      equalParticipantIds: [],
      exactDistribution: { a: 20, b: 30 },
    });
    expect(res.ok).toBe(true);
    expect(splitsToMap(res.splits)).toEqual({ a: 20, b: 30 });
  });

  it("rejects portions that do not sum to the total", () => {
    const res = buildSplits({
      splitType: "EXACT",
      amount: 50,
      equalParticipantIds: [],
      exactDistribution: { a: 20, b: 20 },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("must equal total");
  });

  it("drops zero portions but errors if all are zero", () => {
    const res = buildSplits({
      splitType: "EXACT",
      amount: 0,
      equalParticipantIds: [],
      exactDistribution: { a: 0, b: 0 },
    });
    expect(res.ok).toBe(false);
  });
});
