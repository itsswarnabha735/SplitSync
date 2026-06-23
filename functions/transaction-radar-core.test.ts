import { describe, expect, it } from "vitest";

const {
  gmailMessageToInput,
  parseGmailTransactionCandidate,
  recognizeGmailExpenseCandidate,
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

  it("omits undefined optional fields when no payment instrument hint is found", () => {
    const candidate = parseGmailTransactionCandidate(
      {
        messageId: "no-card",
        sender: "receipts@example.com",
        subject: "Payment receipt",
        snippet: "Payment of INR 450 paid to Cafe Mondegar on 2026-06-22.",
      },
      { userId: "u1", now: new Date("2026-06-22T10:00:00Z").getTime() }
    );

    expect(candidate).not.toBeNull();
    expect(candidate).not.toHaveProperty("paymentInstrumentHint");
    expect(Object.values(candidate!)).not.toContain(undefined);
  });

  it("recognizes a clear bank debit alert as a high-confidence AI candidate", async () => {
    const input = {
      messageId: "ai-bank-debit",
      threadId: "thread-bank-debit",
      sender: "alerts@bank.example",
      subject: "Card transaction alert",
      snippet:
        "INR 920 was debited at Uber India using card ending 1234 on 2026-06-22.",
      body:
        "Dear customer, INR 920 was debited at Uber India using card ending 1234 on 2026-06-22. Transaction successful.",
      receivedAt: new Date("2026-06-22T10:00:00Z").getTime(),
    };

    const candidate = await recognizeGmailExpenseCandidate(input, {
      userId: "u1",
      now: new Date("2026-06-22T10:05:00Z").getTime(),
      aiRecognize: async () =>
        JSON.stringify({
          isExpense: true,
          expenseKind: "completed_spend",
          merchant: "Uber India",
          amount: 920,
          currency: "INR",
          transactionAt: "2026-06-22T10:00:00Z",
          paymentInstrumentHint: "Card ending 1234",
          category: "transport",
          confidence: 0.94,
          evidence: {
            amountText: "INR 920",
            merchantText: "Uber India",
            dateText: "2026-06-22",
            completionText: "Transaction successful",
          },
          rejectionReasonCodes: [],
        }),
    });

    expect(candidate).toMatchObject({
      id: "ai-bank-debit",
      merchant: "Uber India",
      amount: 920,
      currency: "INR",
      status: "suggested",
      recognitionMode: "ai",
      recognitionEvidence: {
        amountText: "INR 920",
        merchantText: "Uber India",
        completionText: "Transaction successful",
      },
    });
    expect(candidate).not.toHaveProperty("body");
  });

  it("stores medium-confidence AI spends as Needs Context without push-ready status", async () => {
    const candidate = await recognizeGmailExpenseCandidate(
      {
        messageId: "ai-medium",
        sender: "receipts@zomato.example",
        subject: "Payment receipt",
        snippet: "Payment of INR 740 paid to Zomato on 2026-06-22.",
        body: "Payment of INR 740 paid to Zomato on 2026-06-22.",
        receivedAt: new Date("2026-06-22T12:00:00Z").getTime(),
      },
      {
        userId: "u1",
        now: new Date("2026-06-22T12:01:00Z").getTime(),
        aiRecognize: async () => ({
          isExpense: true,
          expenseKind: "completed_spend",
          merchant: "Zomato",
          amount: 740,
          currency: "INR",
          transactionAt: "2026-06-22T12:00:00Z",
          paymentInstrumentHint: null,
          category: "food-dining",
          confidence: 0.76,
          evidence: {
            amountText: "INR 740",
            merchantText: "Zomato",
            dateText: "2026-06-22",
            completionText: "paid to Zomato",
          },
          rejectionReasonCodes: [],
        }),
      }
    );

    expect(candidate).toMatchObject({
      status: "new",
      sourceWarnings: ["medium-confidence-ai-recognition"],
    });
  });

  it("does not call AI for obvious bill, promo, or security emails", async () => {
    let calls = 0;
    const samples = [
      {
        subject: "Your credit card statement generated",
        snippet: "Total due INR 5000. Due date 2026-06-30.",
      },
      {
        subject: "OTP for transaction",
        snippet: "Your OTP is 123456 for INR 1000 transaction.",
      },
      {
        subject: "Cashback offer",
        snippet: "Get INR 250 cashback on your next payment.",
      },
    ];

    for (const [index, sample] of samples.entries()) {
      const candidate = await recognizeGmailExpenseCandidate(
        {
          messageId: `reject-${index}`,
          sender: "bank@example.com",
          subject: sample.subject,
          snippet: sample.snippet,
          body: sample.snippet,
          receivedAt: Date.now(),
        },
        {
          userId: "u1",
          aiRecognize: async () => {
            calls += 1;
            return {};
          },
        }
      );
      expect(candidate).toBeNull();
    }
    expect(calls).toBe(0);
  });

  it("rejects refund AI output for v1 shared expense candidates", async () => {
    const candidate = await recognizeGmailExpenseCandidate(
      {
        messageId: "refund",
        sender: "merchant@example.com",
        subject: "Refund processed",
        snippet: "Refund of INR 920 was credited by Uber.",
        body: "Refund of INR 920 was credited by Uber.",
        receivedAt: Date.now(),
      },
      {
        userId: "u1",
        aiRecognize: async () => ({
          isExpense: false,
          expenseKind: "refund",
          merchant: "Uber",
          amount: 920,
          currency: "INR",
          transactionAt: null,
          paymentInstrumentHint: null,
          category: "transport",
          confidence: 0.92,
          evidence: {
            amountText: "INR 920",
            merchantText: "Uber",
            dateText: null,
            completionText: "credited",
          },
          rejectionReasonCodes: ["refund"],
        }),
      }
    );

    expect(candidate).toBeNull();
  });

  it("uses AI evidence to avoid random numbers in multi-number receipts", async () => {
    const candidate = await recognizeGmailExpenseCandidate(
      {
        messageId: "multi-number",
        sender: "orders@swiggy.example",
        subject: "Order 847392 paid",
        snippet:
          "Order 847392 for 260 reward points. Paid INR 612.40 to Swiggy.",
        body:
          "Phone [phone]. Order 847392. Discount INR 80. Tax INR 31.20. Paid INR 612.40 to Swiggy using UPI.",
        receivedAt: Date.now(),
      },
      {
        userId: "u1",
        aiRecognize: async () => ({
          isExpense: true,
          expenseKind: "completed_spend",
          merchant: "Swiggy",
          amount: 612.4,
          currency: "INR",
          transactionAt: "2026-06-22",
          paymentInstrumentHint: "UPI",
          category: "food-dining",
          confidence: 0.91,
          evidence: {
            amountText: "Paid INR 612.40",
            merchantText: "Swiggy",
            dateText: "2026-06-22",
            completionText: "Paid INR 612.40 to Swiggy using UPI",
          },
          rejectionReasonCodes: [],
        }),
      }
    );

    expect(candidate).toMatchObject({
      merchant: "Swiggy",
      amount: 612.4,
      currency: "INR",
    });
  });

  it("does not create a regex fallback when AI returns malformed or low-confidence output", async () => {
    const input = {
      messageId: "bad-ai",
      sender: "alerts@bank.example",
      subject: "Payment receipt",
      snippet: "Payment of INR 450 paid to Cafe Mondegar on 2026-06-22.",
      body: "Payment of INR 450 paid to Cafe Mondegar on 2026-06-22.",
      receivedAt: Date.now(),
    };

    const malformed = await recognizeGmailExpenseCandidate(input, {
      userId: "u1",
      aiRecognize: async () => "not json",
    });
    const lowConfidence = await recognizeGmailExpenseCandidate(input, {
      userId: "u1",
      aiRecognize: async () => ({
        isExpense: true,
        expenseKind: "completed_spend",
        merchant: "Cafe Mondegar",
        amount: 450,
        currency: "INR",
        transactionAt: "2026-06-22",
        paymentInstrumentHint: null,
        category: "food-dining",
        confidence: 0.52,
        evidence: {
          amountText: "INR 450",
          merchantText: "Cafe Mondegar",
          dateText: "2026-06-22",
          completionText: "paid to Cafe Mondegar",
        },
        rejectionReasonCodes: [],
      }),
    });

    expect(malformed).toBeNull();
    expect(lowConfidence).toBeNull();
  });
});
