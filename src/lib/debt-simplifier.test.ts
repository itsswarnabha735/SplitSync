import { describe, expect, it } from "vitest";
import {
  DebtSimplificationError,
  simplifyDebts,
} from "./debt-simplifier";
import { GroupMember, MemberBalanceInfo } from "./models";

function member(id: string, name: string): GroupMember {
  return { id, groupId: "g", name, email: "", linkedUid: "" };
}

function balance(
  m: GroupMember,
  paid: number,
  owe: number,
  currency = "USD"
): MemberBalanceInfo {
  return {
    member: m,
    currency,
    initialPaid: paid,
    initialOwe: owe,
    paymentsMadeAsSender: 0,
    paymentsMadeAsReceiver: 0,
  };
}

function balanceFromNet(
  m: GroupMember,
  net: number,
  currency = "USD"
): MemberBalanceInfo {
  return net >= 0
    ? balance(m, net, 0, currency)
    : balance(m, 0, -net, currency);
}

function applyTransactions(
  startingNet: Record<string, number>,
  result: ReturnType<typeof simplifyDebts>
) {
  const next = { ...startingNet };
  for (const transaction of result) {
    next[transaction.debtor.id] =
      (next[transaction.debtor.id] ?? 0) + transaction.amount;
    next[transaction.creditor.id] =
      (next[transaction.creditor.id] ?? 0) - transaction.amount;
  }
  return next;
}

describe("simplifyDebts", () => {
  it("returns no transactions when everyone is settled", () => {
    const a = member("a", "A");
    const b = member("b", "B");
    const result = simplifyDebts([balance(a, 50, 50), balance(b, 50, 50)]);
    expect(result).toEqual([]);
  });

  it("settles a simple two-person debt", () => {
    const a = member("a", "Alice");
    const b = member("b", "Bob");
    // Alice paid 100, owes 50 (+50). Bob paid 0, owes 50 (-50).
    const result = simplifyDebts([balance(a, 100, 50), balance(b, 0, 50)]);
    expect(result).toHaveLength(1);
    expect(result[0].debtor.id).toBe("b");
    expect(result[0].creditor.id).toBe("a");
    expect(result[0].amount).toBe(50);
    expect(result[0].currency).toBe("USD");
  });

  it("settles one debtor across multiple creditors", () => {
    const a = member("a", "A"); // +60
    const b = member("b", "B"); // +30
    const c = member("c", "C"); // -90
    const result = simplifyDebts([
      balance(a, 60, 0),
      balance(b, 30, 0),
      balance(c, 0, 90),
    ]);
    // C owes 90 total; should pay A 60 then B 30.
    expect(result).toHaveLength(2);
    const total = result.reduce((s, t) => s + t.amount, 0);
    expect(total).toBeCloseTo(90, 2);
    expect(result.every((t) => t.debtor.id === "c")).toBe(true);
  });

  it("minimizes transfers when greedy matching is not optimal", () => {
    const a = member("a", "A"); // +6
    const b = member("b", "B"); // +4
    const c = member("c", "C"); // -4
    const d = member("d", "D"); // -3
    const e = member("e", "E"); // -3
    const startingNet = { a: 6, b: 4, c: -4, d: -3, e: -3 };

    const result = simplifyDebts([
      balanceFromNet(a, startingNet.a),
      balanceFromNet(b, startingNet.b),
      balanceFromNet(c, startingNet.c),
      balanceFromNet(d, startingNet.d),
      balanceFromNet(e, startingNet.e),
    ]);

    expect(result).toHaveLength(3);
    expect(Object.values(applyTransactions(startingNet, result))).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });

  it("keeps currencies separate", () => {
    const a = member("a", "A");
    const b = member("b", "B");
    const result = simplifyDebts([
      balance(a, 100, 50, "USD"),
      balance(b, 0, 50, "USD"),
      balance(a, 0, 40, "EUR"),
      balance(b, 80, 40, "EUR"),
    ]);
    expect(result).toHaveLength(2);
    const usd = result.find((t) => t.currency === "USD")!;
    const eur = result.find((t) => t.currency === "EUR")!;
    expect(usd.debtor.id).toBe("b");
    expect(eur.debtor.id).toBe("a");
  });

  it("ignores sub-cent imbalances", () => {
    const a = member("a", "A");
    const b = member("b", "B");
    const result = simplifyDebts([
      balance(a, 100.004, 100),
      balance(b, 100, 100.004),
    ]);
    expect(result).toEqual([]);
  });

  it("throws when a currency bucket does not conserve value", () => {
    const a = member("a", "A");
    const b = member("b", "B");

    expect(() =>
      simplifyDebts([balanceFromNet(a, 10), balanceFromNet(b, -4)])
    ).toThrow(DebtSimplificationError);
  });
});
