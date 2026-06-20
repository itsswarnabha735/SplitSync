import { describe, expect, it } from "vitest";
import { deriveDashboardBalanceTotals } from "./dashboard-balances";
import type { Friend, FriendWithBalance, GroupMember } from "./models";

const friend: Friend = {
  id: "friend-row",
  name: "Friend",
  email: "friend@example.com",
  phone: "",
  createdAt: 1,
  linkedUid: "friend-uid",
};

const members: GroupMember[] = [
  {
    id: "you-member",
    groupId: "g1",
    name: "You",
    email: "you@example.com",
    linkedUid: "you-uid",
  },
  {
    id: "friend-member",
    groupId: "g1",
    name: "Friend",
    email: "friend@example.com",
    linkedUid: "friend-uid",
  },
  {
    id: "unlinked-member",
    groupId: "g1",
    name: "Unlinked",
    email: "",
    linkedUid: "",
  },
];

describe("deriveDashboardBalanceTotals", () => {
  it("does not double-count linked friend shares in mixed group expenses", () => {
    const friendsWithBalances: FriendWithBalance[] = [
      { friend, netBalance: 20, currency: "USD" },
    ];

    const result = deriveDashboardBalanceTotals({
      uid: "you-uid",
      friends: [friend],
      friendsWithBalances,
      slices: {
        g1: {
          members,
          expenses: [
            {
              id: "e1",
              groupId: "g1",
              description: "Dinner",
              amount: 60,
              paidById: "you-member",
              splitType: "EQUAL",
              timestamp: 1,
              currency: "USD",
              splits: {
                "you-member": 20,
                "friend-member": 20,
                "unlinked-member": 20,
              },
            },
          ],
          payments: [],
        },
      },
    });

    expect(result.youAreOwed.USD).toBe(40);
    expect(result.youOwe.USD).toBeUndefined();
    expect(result.net.USD).toBe(40);
  });

  it("nets group settlements before deriving owed and owe dashboard totals", () => {
    const result = deriveDashboardBalanceTotals({
      uid: "you-uid",
      friends: [],
      friendsWithBalances: [],
      slices: {
        g1: {
          members,
          expenses: [
            {
              id: "e1",
              groupId: "g1",
              description: "Taxi",
              amount: 40,
              paidById: "unlinked-member",
              splitType: "EQUAL",
              timestamp: 1,
              currency: "USD",
              splits: {
                "you-member": 20,
                "unlinked-member": 20,
              },
            },
          ],
          payments: [
            {
              id: "p1",
              groupId: "g1",
              fromMemberId: "you-member",
              toMemberId: "unlinked-member",
              amount: 20,
              timestamp: 2,
              currency: "USD",
            },
          ],
        },
      },
    });

    expect(result.youAreOwed.USD).toBeUndefined();
    expect(result.youOwe.USD).toBeUndefined();
    expect(result.net.USD).toBe(0);
  });
});
