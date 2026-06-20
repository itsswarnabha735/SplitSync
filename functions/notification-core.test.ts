import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  notificationDocId,
  shouldSendChannel,
  largeExpenseTags,
  buildGroupExpenseNotification,
  buildMirroredAdHocExpense,
  buildSourceAdHocExpenseFromMirror,
  shouldHandleSourceAdHocDelete,
  sourcePathForAdHocMirrorDelete,
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

  it("mirrors ad-hoc expenses into the linked payer ledger", () => {
    const mirrored = buildMirroredAdHocExpense(
      {
        id: "expense-1",
        description: "Cab",
        paidByFriendId: "friend-uid",
        splits: { self: 100, "friend-uid": 100 },
      },
      {
        mirrorId: "owner-uid_expense-1",
        sourceOwnerUid: "owner-uid",
        sourceExpenseId: "expense-1",
        sourceFriendId: "friend-uid",
      }
    );

    expect(mirrored).toMatchObject({
      id: "owner-uid_expense-1",
      paidByFriendId: "self",
      splits: { "owner-uid": 100, self: 100 },
      mirroredFromPath: "users/owner-uid/adhocExpenses/expense-1",
      mirroredFromUid: "owner-uid",
      originalId: "expense-1",
    });
  });

  it("maps payer-side mirror edits back to the source ledger", () => {
    const source = buildSourceAdHocExpenseFromMirror(
      {
        id: "owner-uid_expense-1",
        description: "Cab updated",
        paidByFriendId: "self",
        splits: { "owner-uid": 80, self: 120 },
        mirroredFromPath: "users/owner-uid/adhocExpenses/expense-1",
        mirroredFromUid: "owner-uid",
        originalId: "expense-1",
      },
      {
        sourceOwnerUid: "owner-uid",
        sourceExpenseId: "expense-1",
        sourceFriendId: "friend-uid",
      }
    );

    expect(source).toMatchObject({
      id: "expense-1",
      description: "Cab updated",
      paidByFriendId: "friend-uid",
      splits: { self: 80, "friend-uid": 120 },
    });
    expect(source.mirroredFromPath).toBeUndefined();
  });

  it("resolves mirrored ad-hoc expense deletes to the source path", () => {
    expect(
      sourcePathForAdHocMirrorDelete(
        {
          mirroredFromPath: "users/owner-uid/adhocExpenses/expense-1",
          mirroredFromUid: "owner-uid",
          originalId: "expense-1",
        },
        "adhocExpenses"
      )
    ).toBe("users/owner-uid/adhocExpenses/expense-1");
  });

  it("resolves mirrored ad-hoc payment deletes to the source path", () => {
    expect(
      sourcePathForAdHocMirrorDelete(
        {
          mirroredFromPath: "users/owner-uid/adhocPayments/payment-1",
          mirroredFromUid: "owner-uid",
          originalId: "payment-1",
        },
        "adhocPayments"
      )
    ).toBe("users/owner-uid/adhocPayments/payment-1");
  });

  it("rejects source delete handling for mirror docs", () => {
    expect(shouldHandleSourceAdHocDelete({ id: "source-1" })).toBe(true);
    expect(
      shouldHandleSourceAdHocDelete({
        id: "mirror-1",
        mirroredFromPath: "users/owner-uid/adhocExpenses/source-1",
      })
    ).toBe(false);
  });
});
