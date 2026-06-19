import { describe, expect, it } from "vitest";

import { dateInputToLocalTimestamp, toDateInputValue } from "./dates";

describe("date input helpers", () => {
  it("formats a Date using local calendar fields", () => {
    expect(toDateInputValue(new Date(2026, 5, 9, 23, 30))).toBe(
      "2026-06-09"
    );
  });

  it("parses a date input value as local midnight", () => {
    const timestamp = dateInputToLocalTimestamp("2026-06-19");
    expect(timestamp).not.toBeNull();

    const date = new Date(timestamp!);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(5);
    expect(date.getDate()).toBe(19);
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });

  it("rejects invalid calendar dates", () => {
    expect(dateInputToLocalTimestamp("2026-02-30")).toBeNull();
    expect(dateInputToLocalTimestamp("not-a-date")).toBeNull();
  });
});
