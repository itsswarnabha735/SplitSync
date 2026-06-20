import { describe, expect, it } from "vitest";

import type {
  AdHocExpense,
  Expense,
  Friend,
  Group,
  GroupMember,
} from "./models";
import { YOU_ID } from "./models";
import {
  deriveSpendEntries,
  filterSpendEntries,
  summarizeSpendByCurrency,
  type SpendGroupSlice,
} from "./spend-analysis";

const uid = "user-1";

function groupExpense(overrides: Partial<Expense>): Expense {
  return {
    id: "expense-1",
    groupId: "group-1",
    description: "Dinner",
    amount: 120,
    paidById: "member-1",
    splitType: "EXACT",
    timestamp: new Date(2026, 0, 15).getTime(),
    currency: "INR",
    splits: { "member-1": 40, "member-2": 80 },
    category: "food-dining",
    ...overrides,
  };
}

function adHocExpense(overrides: Partial<AdHocExpense>): AdHocExpense {
  return {
    id: "adhoc-1",
    description: "Cab",
    amount: 50,
    paidByFriendId: "friend-1",
    splitType: "EQUAL",
    timestamp: new Date(2026, 0, 16).getTime(),
    currency: "INR",
    splits: { [YOU_ID]: 25, "friend-1": 25 },
    category: "transport",
    ...overrides,
  };
}

const groups: Group[] = [
  {
    id: "group-1",
    name: "Goa",
    description: "",
    createdAt: 1,
    createdBy: uid,
    memberUids: [uid],
  },
];

const members: GroupMember[] = [
  {
    id: "member-1",
    groupId: "group-1",
    name: "Me",
    email: "",
    linkedUid: uid,
  },
  {
    id: "member-2",
    groupId: "group-1",
    name: "Asha",
    email: "",
    linkedUid: "",
  },
];

const friends: Friend[] = [
  {
    id: "friend-1",
    name: "Ravi",
    email: "",
    phone: "",
    createdAt: 1,
    linkedUid: "",
  },
];

function entries(params: {
  groupExpenses?: Expense[];
  adHocExpenses?: AdHocExpense[];
}) {
  const groupSlices: Record<string, SpendGroupSlice> = {
    "group-1": {
      members,
      expenses: params.groupExpenses ?? [],
      payments: [],
    },
  };
  return deriveSpendEntries({
    uid,
    groups,
    groupSlices,
    friends,
    adHocExpenses: params.adHocExpenses ?? [],
  });
}

describe("spend analysis", () => {
  it("uses the signed-in user's split share as personal spend", () => {
    const [entry] = entries({
      groupExpenses: [groupExpense({ amount: 120, splits: { "member-1": 40 } })],
    });

    expect(entry?.fullAmount).toBe(120);
    expect(entry?.myShare).toBe(40);
    expect(entry?.paidUpfront).toBe(120);
  });

  it("normalizes ad-hoc expenses and tracks who paid", () => {
    const [entry] = entries({
      adHocExpenses: [adHocExpense({ paidByFriendId: "friend-1" })],
    });

    expect(entry?.source).toBe("friend");
    expect(entry?.scopeName).toBe("Ravi");
    expect(entry?.myShare).toBe(25);
    expect(entry?.paidByMe).toBe(false);
  });

  it("excludes income and transfers from filtered spend", () => {
    const all = entries({
      adHocExpenses: [
        adHocExpense({ id: "cab", category: "transport" }),
        adHocExpense({ id: "refund", category: "transfers" }),
        adHocExpense({ id: "salary", category: "income" }),
      ],
    });

    expect(filterSpendEntries(all, {}).map((entry) => entry.category)).toEqual([
      "transport",
    ]);
  });

  it("summarizes imported rows needing review by currency", () => {
    const summary = summarizeSpendByCurrency(
      entries({
        adHocExpenses: [
          adHocExpense({
            sourceType: "statement-import",
            parserConfidence: 0.5,
            category: "other",
          }),
        ],
      })
    );

    expect(summary.INR.mySpend).toBe(25);
    expect(summary.INR.importedNeedsReviewCount).toBe(1);
    expect(summary.INR.uncategorizedCount).toBe(1);
  });

  it("adds an editable target to group expenses the user can edit", () => {
    const [entry] = entries({
      groupExpenses: [
        groupExpense({
          id: "group-expense-1",
          createdByUid: uid,
        }),
      ],
    });

    expect(entry?.editableTarget).toEqual({
      kind: "groupExpense",
      groupId: "group-1",
      expenseId: "group-expense-1",
    });
    expect(entry?.deletableTarget).toEqual({
      kind: "groupExpense",
      groupId: "group-1",
      expenseId: "group-expense-1",
    });
  });

  it("adds an editable target to ad-hoc expenses the user can edit", () => {
    const [entry] = entries({
      adHocExpenses: [
        adHocExpense({
          id: "adhoc-expense-1",
          createdByUid: uid,
        }),
      ],
    });

    expect(entry?.editableTarget).toEqual({
      kind: "adHocExpense",
      expenseId: "adhoc-expense-1",
    });
    expect(entry?.deletableTarget).toEqual({
      kind: "adHocExpense",
      expenseId: "adhoc-expense-1",
    });
  });

  it("omits editable targets for group expenses by unrelated members", () => {
    const [entry] = entries({
      groupExpenses: [
        groupExpense({
          createdByUid: "other-uid",
          paidById: "member-2",
        }),
      ],
    });

    expect(entry?.editableTarget).toBeUndefined();
    expect(entry?.deletableTarget).toBeUndefined();
  });
});
