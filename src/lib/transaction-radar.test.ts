import { describe, expect, it } from "vitest";

import {
  detectCandidateDuplicate,
  enrichCandidateContext,
  parseGmailTransactionCandidate,
} from "./transaction-radar";
import type { GroupContextSlice } from "./transaction-radar";
import type { AdHocExpense, Friend, Group, GroupMember } from "./models";

const now = new Date("2026-06-22T10:00:00.000Z").getTime();

describe("transaction radar", () => {
  it("parses a transaction email into a private Gmail candidate", () => {
    const candidate = parseGmailTransactionCandidate(
      {
        messageId: "gmail-1",
        sender: "alerts@hdfcbank.net",
        subject: "Card transaction alert",
        snippet:
          "Dear customer, INR 920.00 was spent at Uber India using card ending 1234 on 2026-06-22.",
        receivedAt: now,
      },
      { userId: "u1", now }
    );

    expect(candidate).toMatchObject({
      id: "gmail-1",
      userId: "u1",
      source: "gmail",
      amount: 920,
      currency: "INR",
      candidateType: "spend",
      paymentInstrumentHint: "Card ending 1234",
    });
    expect(candidate?.merchant.toLowerCase()).toContain("uber");
    expect(candidate?.rawSnippetRedacted).not.toContain("1234567890");
  });

  it("ignores OTP and promotional emails", () => {
    expect(
      parseGmailTransactionCandidate(
        {
          messageId: "otp",
          sender: "bank@example.com",
          subject: "OTP for transaction",
          snippet: "Your OTP is 123456 for INR 1000 transaction.",
          receivedAt: now,
        },
        { userId: "u1", now }
      )
    ).toBeNull();

    expect(
      parseGmailTransactionCandidate(
        {
          messageId: "promo",
          sender: "offers@bank.example",
          subject: "Cashback offer",
          snippet: "Get offer on payment of INR 5000 this weekend.",
          receivedAt: now,
        },
        { userId: "u1", now }
      )
    ).toBeNull();
  });

  it("boosts active trip groups and suggests equal group split", () => {
    const candidate = parseGmailTransactionCandidate(
      {
        messageId: "gmail-trip",
        sender: "alerts@bank.example",
        subject: "Payment alert",
        snippet: "You paid ₹1850 at Cafe Mondegar on 22 Jun 2026.",
        receivedAt: now,
      },
      { userId: "u1", now }
    );
    expect(candidate).not.toBeNull();

    const enriched = enrichCandidateContext({
      candidate: candidate!,
      groupSlices: [goaTrip()],
      friends: [],
      adHocExpenses: [],
      rules: [],
    });

    expect(enriched.suggestedTarget).toMatchObject({
      kind: "group",
      targetId: "g1",
    });
    expect(enriched.suggestedTarget?.reasonCodes).toContain("active_trip_dates");
    expect(enriched.suggestedSplit?.participantIds).toEqual(["m1", "m2", "m3"]);
    expect(enriched.status).toBe("suggested");
  });

  it("marks hard duplicates when a matching expense already exists", () => {
    const candidate = parseGmailTransactionCandidate(
      {
        messageId: "gmail-dupe",
        sender: "alerts@bank.example",
        subject: "Payment alert",
        snippet: "INR 920 was spent at Uber India on 2026-06-22.",
        receivedAt: now,
      },
      { userId: "u1", now }
    );
    expect(candidate).not.toBeNull();

    const duplicate = detectCandidateDuplicate(candidate!, [goaTrip()], []);
    expect(duplicate.duplicateConfidence).toBeGreaterThan(0.5);
    expect(duplicate.status).toBe("duplicate");
  });

  it("can suggest a friend from recent ad-hoc merchant behavior", () => {
    const candidate = parseGmailTransactionCandidate(
      {
        messageId: "gmail-friend",
        sender: "receipts@bigbasket.com",
        subject: "Payment receipt",
        snippet: "Payment of INR 1400 paid to BigBasket.",
        receivedAt: now,
      },
      { userId: "u1", now }
    );
    const friend: Friend = {
      id: "f1",
      name: "Riya",
      email: "",
      phone: "",
      createdAt: now,
      linkedUid: "",
    };
    const adHocExpense: AdHocExpense = {
      id: "a1",
      description: "BigBasket groceries",
      amount: 1200,
      paidByFriendId: "self",
      splitType: "EQUAL",
      timestamp: now - 2 * 24 * 60 * 60 * 1000,
      currency: "INR",
      splits: { self: 600, f1: 600 },
    };

    const enriched = enrichCandidateContext({
      candidate: candidate!,
      groupSlices: [],
      friends: [friend],
      adHocExpenses: [adHocExpense],
      rules: [],
    });

    expect(enriched.suggestedTarget).toMatchObject({
      kind: "friend",
      targetId: "f1",
    });
  });
});

function goaTrip(): GroupContextSlice {
  const group: Group = {
    id: "g1",
    name: "Goa Trip",
    description: "",
    createdAt: new Date("2026-06-20T00:00:00.000Z").getTime(),
    createdBy: "u1",
    memberUids: ["u1", "u2", "u3"],
    status: "active",
    template: "trip",
    defaultCurrency: "INR",
    settlementCurrency: "INR",
    travelMode: true,
    tripStartAt: new Date("2026-06-21T00:00:00.000Z").getTime(),
    tripEndAt: new Date("2026-06-28T00:00:00.000Z").getTime(),
  };
  const members: GroupMember[] = [
    { id: "m1", groupId: "g1", name: "You", email: "", linkedUid: "u1" },
    { id: "m2", groupId: "g1", name: "Aman", email: "", linkedUid: "u2" },
    { id: "m3", groupId: "g1", name: "Riya", email: "", linkedUid: "u3" },
  ];
  return {
    group,
    members,
    expenses: [
      {
        id: "e1",
        description: "Uber India",
        amount: 920,
        currency: "INR",
        timestamp: now,
        paidById: "m1",
        splits: { m1: 306.67, m2: 306.67, m3: 306.66 },
        transactionFingerprint: "2026-06-22|uber india|92000|INR",
      },
    ],
  };
}
