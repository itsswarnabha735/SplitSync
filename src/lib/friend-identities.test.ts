import { describe, expect, it } from "vitest";

import { calculateFriendBalances } from "./balances";
import {
  buildFriendIdentityIndex,
  canonicalizeAdHocExpenses,
} from "./friend-identities";
import type { AdHocExpense, Friend } from "./models";
import { YOU_ID } from "./models";

function friend(overrides: Partial<Friend> & Pick<Friend, "id" | "name">): Friend {
  return {
    email: "",
    phone: "",
    createdAt: 1,
    linkedUid: "",
    ...overrides,
  };
}

function expense(overrides: Partial<AdHocExpense>): AdHocExpense {
  return {
    id: "expense",
    description: "Expense",
    amount: 1,
    paidByFriendId: YOU_ID,
    splitType: "EXACT",
    timestamp: 1,
    currency: "USD",
    splits: { [YOU_ID]: 1 },
    ...overrides,
  };
}

describe("friend identity canonicalization", () => {
  it("merges registered friends with legacy name-only placeholders for balances", () => {
    const friends = [
      friend({ id: "legacy-swarn", name: "Swarn" }),
      friend({
        id: "swarn-uid",
        name: "Swarn",
        email: "swarn@example.com",
        linkedUid: "swarn-uid",
        createdAt: 2,
      }),
      friend({
        id: "swarn-2-uid",
        name: "Swarn 2",
        email: "swarn2@example.com",
        linkedUid: "swarn-2-uid",
        createdAt: 2,
      }),
      friend({ id: "legacy-swarn-2", name: "Swarn 2" }),
    ];

    const index = buildFriendIdentityIndex(friends);
    const canonicalExpenses = canonicalizeAdHocExpenses(
      [
        expense({
          id: "legacy-swarn-expense",
          amount: 3282.5,
          splits: { [YOU_ID]: 0, "legacy-swarn": 3282.5 },
        }),
        expense({
          id: "linked-swarn-expense",
          amount: 9493.5,
          splits: { [YOU_ID]: 0, "swarn-uid": 9493.5 },
        }),
        expense({
          id: "legacy-swarn-2-expense",
          amount: 561.5,
          splits: { [YOU_ID]: 0, "legacy-swarn-2": 561.5 },
        }),
        expense({
          id: "linked-swarn-2-paid",
          amount: 1225,
          paidByFriendId: "swarn-2-uid",
          splits: { [YOU_ID]: 1225, "swarn-2-uid": 0 },
        }),
      ],
      index.aliasToCanonicalId
    );

    expect(index.friends.map((f) => f.id)).toEqual([
      "swarn-uid",
      "swarn-2-uid",
    ]);
    expect(index.aliasToCanonicalId.get("legacy-swarn")).toBe("swarn-uid");
    expect(index.aliasToCanonicalId.get("legacy-swarn-2")).toBe("swarn-2-uid");

    const balances = calculateFriendBalances(
      index.friends,
      canonicalExpenses,
      []
    );
    expect(
      balances.find((b) => b.friend.id === "swarn-uid")?.netBalance
    ).toBe(12776);
    expect(
      balances.find((b) => b.friend.id === "swarn-2-uid")?.netBalance
    ).toBe(-663.5);
  });

  it("does not merge a name-only placeholder when the display name is ambiguous", () => {
    const index = buildFriendIdentityIndex([
      friend({ id: "legacy-sam", name: "Sam" }),
      friend({ id: "sam-1", name: "Sam", linkedUid: "sam-1" }),
      friend({ id: "sam-2", name: "Sam", linkedUid: "sam-2" }),
    ]);

    expect(index.friends.map((f) => f.id).sort()).toEqual([
      "legacy-sam",
      "sam-1",
      "sam-2",
    ]);
    expect(index.aliasToCanonicalId.get("legacy-sam")).toBe("legacy-sam");
  });

  it("sums split amounts when alias and canonical ids both appear", () => {
    const index = buildFriendIdentityIndex([
      friend({
        id: "legacy-friend",
        name: "Friend",
        email: "friend@example.com",
      }),
      friend({
        id: "friend-uid",
        name: "Friend",
        email: "friend@example.com",
        linkedUid: "friend-uid",
      }),
    ]);

    const [canonical] = canonicalizeAdHocExpenses(
      [
        expense({
          splits: {
            [YOU_ID]: 15,
            "legacy-friend": 10,
            "friend-uid": 5,
          },
        }),
      ],
      index.aliasToCanonicalId
    );

    expect(canonical.splits).toEqual({
      [YOU_ID]: 15,
      "friend-uid": 15,
    });
  });
});
