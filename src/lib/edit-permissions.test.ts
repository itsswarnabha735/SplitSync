import { describe, expect, it } from "vitest";

import {
  canDeleteAdHocExpense,
  canDeleteAdHocPayment,
  canDeleteGroupExpense,
  canDeleteGroupPayment,
  canDeleteRecurringExpense,
  canDeleteSettlementRequest,
  canEditAdHocExpense,
  canEditAdHocPayment,
  canEditGroupExpense,
  canEditGroupPayment,
  canEditGroupProfile,
  canEditRecurringExpense,
} from "./edit-permissions";
import type { Group, GroupMember } from "./models";
import { YOU_ID } from "./models";

const group: Group = {
  id: "group-1",
  name: "Trip",
  description: "",
  createdAt: 1,
  createdBy: "creator-uid",
  memberUids: ["creator-uid", "payer-uid", "other-uid"],
};

const members: GroupMember[] = [
  {
    id: "creator-member",
    groupId: group.id,
    name: "Creator",
    email: "",
    linkedUid: "creator-uid",
  },
  {
    id: "payer-member",
    groupId: group.id,
    name: "Payer",
    email: "",
    linkedUid: "payer-uid",
  },
  {
    id: "other-member",
    groupId: group.id,
    name: "Other",
    email: "",
    linkedUid: "other-uid",
  },
];

describe("edit permissions", () => {
  it("lets a group member edit group profile/settings", () => {
    expect(canEditGroupProfile(group, "payer-uid")).toBe(true);
    expect(canEditGroupProfile(group, "stranger-uid")).toBe(false);
  });

  it("lets an expense creator or payer edit the expense", () => {
    const expense = {
      createdByUid: "creator-uid",
      paidById: "payer-member",
    };

    expect(canEditGroupExpense({ group, members, expense, uid: "creator-uid" })).toBe(true);
    expect(canEditGroupExpense({ group, members, expense, uid: "payer-uid" })).toBe(true);
    expect(canEditGroupExpense({ group, members, expense, uid: "other-uid" })).toBe(false);
    expect(canDeleteGroupExpense({ group, members, expense, uid: "creator-uid" })).toBe(true);
    expect(canDeleteGroupExpense({ group, members, expense, uid: "payer-uid" })).toBe(true);
    expect(canDeleteGroupExpense({ group, members, expense, uid: "other-uid" })).toBe(false);
  });

  it("lets the group creator or payer edit legacy group rows without createdByUid", () => {
    const expense = {
      paidById: "payer-member",
    };

    expect(canEditGroupExpense({ group, members, expense, uid: "creator-uid" })).toBe(true);
    expect(canEditGroupExpense({ group, members, expense, uid: "payer-uid" })).toBe(true);
    expect(canEditGroupExpense({ group, members, expense, uid: "other-uid" })).toBe(false);
    expect(canDeleteGroupExpense({ group, members, expense, uid: "creator-uid" })).toBe(true);
    expect(canDeleteGroupExpense({ group, members, expense, uid: "payer-uid" })).toBe(true);
    expect(canDeleteGroupExpense({ group, members, expense, uid: "other-uid" })).toBe(false);
  });

  it("uses the from member as the payer for settlement edits", () => {
    const payment = {
      createdByUid: "creator-uid",
      fromMemberId: "payer-member",
    };

    expect(canEditGroupPayment({ group, members, payment, uid: "payer-uid" })).toBe(true);
    expect(canEditGroupPayment({ group, members, payment, uid: "other-uid" })).toBe(false);
    expect(canDeleteGroupPayment({ group, members, payment, uid: "creator-uid" })).toBe(true);
    expect(canDeleteGroupPayment({ group, members, payment, uid: "payer-uid" })).toBe(true);
    expect(canDeleteGroupPayment({ group, members, payment, uid: "other-uid" })).toBe(false);
  });

  it("uses paidById for recurring expense edits", () => {
    const recurring = {
      createdByUid: "creator-uid",
      paidById: "payer-member",
    };

    expect(canEditRecurringExpense({ group, members, recurring, uid: "payer-uid" })).toBe(true);
    expect(canEditRecurringExpense({ group, members, recurring, uid: "other-uid" })).toBe(false);
    expect(canDeleteRecurringExpense({ group, members, recurring, uid: "creator-uid" })).toBe(true);
    expect(canDeleteRecurringExpense({ group, members, recurring, uid: "payer-uid" })).toBe(true);
    expect(canDeleteRecurringExpense({ group, members, recurring, uid: "other-uid" })).toBe(false);
  });

  it("uses requester or from member as settlement request delete authority", () => {
    const request = {
      requestedByUid: "creator-uid",
      fromMemberId: "payer-member",
    };

    expect(canDeleteSettlementRequest({ group, members, request, uid: "creator-uid" })).toBe(true);
    expect(canDeleteSettlementRequest({ group, members, request, uid: "payer-uid" })).toBe(true);
    expect(canDeleteSettlementRequest({ group, members, request, uid: "other-uid" })).toBe(false);
  });

  it("lets ad-hoc expense creators and payer-side mirrors be edited", () => {
    expect(
      canEditAdHocExpense(
        { createdByUid: "creator-uid", paidByFriendId: "friend-uid" },
        "creator-uid"
      )
    ).toBe(true);
    expect(
      canEditAdHocExpense(
        { createdByUid: "creator-uid", paidByFriendId: YOU_ID },
        "payer-uid"
      )
    ).toBe(true);
    expect(
      canEditAdHocExpense(
        { createdByUid: "creator-uid", paidByFriendId: "friend-uid" },
        "other-uid"
      )
    ).toBe(false);
    expect(
      canDeleteAdHocExpense(
        { createdByUid: "creator-uid", paidByFriendId: "friend-uid" },
        "creator-uid"
      )
    ).toBe(true);
    expect(
      canDeleteAdHocExpense(
        { createdByUid: "creator-uid", paidByFriendId: YOU_ID },
        "payer-uid"
      )
    ).toBe(true);
    expect(
      canDeleteAdHocExpense(
        { createdByUid: "creator-uid", paidByFriendId: "friend-uid" },
        "other-uid"
      )
    ).toBe(false);
  });

  it("lets ad-hoc settlement creators and payer-side mirrors be edited or deleted", () => {
    expect(
      canEditAdHocPayment(
        { createdByUid: "creator-uid", fromFriendId: "friend-uid" },
        "creator-uid"
      )
    ).toBe(true);
    expect(
      canEditAdHocPayment(
        { createdByUid: "creator-uid", fromFriendId: YOU_ID },
        "payer-uid"
      )
    ).toBe(true);
    expect(
      canEditAdHocPayment(
        { createdByUid: "creator-uid", fromFriendId: "friend-uid" },
        "other-uid"
      )
    ).toBe(false);
    expect(
      canDeleteAdHocPayment(
        { createdByUid: "creator-uid", fromFriendId: "friend-uid" },
        "creator-uid"
      )
    ).toBe(true);
    expect(
      canDeleteAdHocPayment(
        { createdByUid: "creator-uid", fromFriendId: YOU_ID },
        "payer-uid"
      )
    ).toBe(true);
    expect(
      canDeleteAdHocPayment(
        { createdByUid: "creator-uid", fromFriendId: "friend-uid" },
        "other-uid"
      )
    ).toBe(false);
  });

  it("lets legacy source ad-hoc rows without creator metadata be deleted", () => {
    expect(
      canDeleteAdHocExpense(
        { paidByFriendId: "friend-uid" },
        "owner-uid"
      )
    ).toBe(true);
    expect(
      canDeleteAdHocPayment(
        { fromFriendId: "friend-uid" },
        "owner-uid"
      )
    ).toBe(true);
    expect(
      canDeleteAdHocExpense(
        { paidByFriendId: "friend-uid", mirroredFromPath: "users/u/adhocExpenses/e" },
        "owner-uid"
      )
    ).toBe(false);
  });
});
