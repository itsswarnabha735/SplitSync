import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  notificationDocId,
  shouldSendChannel,
  largeExpenseTags,
  buildGroupExpenseNotification,
} = require("./notification-core.js");

describe("notification-core", () => {
  it("builds deterministic notification document ids", () => {
    expect(notificationDocId("groups/g1/expenses/e1:created", "u1")).toBe(
      notificationDocId("groups/g1/expenses/e1:created", "u1")
    );
    expect(notificationDocId("groups/g1/expenses/e1:created", "u1")).not.toBe(
      notificationDocId("groups/g1/expenses/e1:created", "u2")
    );
  });

  it("filters channels from preferences", () => {
    const prefs = {
      pushEnabled: true,
      eventChannels: {
        group_expense_created: { inApp: false, push: true },
      },
    };

    expect(shouldSendChannel(prefs, "group_expense_created", "inApp")).toBe(
      false
    );
    expect(shouldSendChannel(prefs, "group_expense_created", "push")).toBe(
      true
    );
    expect(shouldSendChannel({ pushEnabled: false }, "friend_added", "push")).toBe(
      false
    );
  });

  it("tags expenses above a configured threshold", () => {
    const prefs = { largeExpenseThresholds: { INR: 5000 } };
    expect(largeExpenseTags(prefs, 4999, "INR")).toEqual([]);
    expect(largeExpenseTags(prefs, 5000, "INR")).toEqual(["large_expense"]);
  });

  it("includes recipient share in group expense copy", () => {
    const notification = buildGroupExpenseNotification({
      expense: {
        description: "Dinner",
        amount: 2400,
        currency: "INR",
        splits: { m1: 800 },
      },
      group: { id: "g1", name: "Goa Trip" },
      payerName: "Alex",
      recipientMember: { id: "m1", name: "Sam" },
      actorDisplayName: "Alex",
    });

    expect(notification.title).toBe("New expense in Goa Trip");
    expect(notification.body).toContain("Dinner");
    expect(notification.body).toContain("Your share");
  });
});
