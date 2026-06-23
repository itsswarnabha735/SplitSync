import { describe, expect, it } from "vitest";

const {
  gmailMessageToInput,
  parseGmailTransactionCandidate,
} = require("./transaction-radar-core.js");

describe("transaction-radar-core", () => {
  it("parses a Gmail message payload into a transaction candidate", () => {
    const body = Buffer.from(
      "Dear customer, INR 920 was spent at Uber India using card ending 1234 on 2026-06-22."
    ).toString("base64url");
    const input = gmailMessageToInput({
      id: "m1",
      threadId: "t1",
      internalDate: String(new Date("2026-06-22T10:00:00Z").getTime()),
      snippet: "INR 920 was spent at Uber India",
      payload: {
        headers: [
          { name: "Subject", value: "Card transaction alert" },
          { name: "From", value: "alerts@bank.example" },
        ],
        mimeType: "text/plain",
        body: { data: body },
      },
    });
    const candidate = parseGmailTransactionCandidate(input, {
      userId: "u1",
      now: new Date("2026-06-22T10:00:00Z").getTime(),
    });
    expect(candidate).toMatchObject({
      id: "m1",
      amount: 920,
      currency: "INR",
      candidateType: "spend",
      paymentInstrumentHint: "Card ending 1234",
    });
    expect(candidate.merchant.toLowerCase()).toContain("uber");
  });

  it("rejects OTP-like transaction emails", () => {
    const candidate = parseGmailTransactionCandidate(
      {
        messageId: "otp",
        sender: "bank@example.com",
        subject: "OTP for transaction",
        snippet: "Your OTP is 123456 for INR 1000 transaction.",
      },
      { userId: "u1", now: Date.now() }
    );
    expect(candidate).toBeNull();
  });
});
