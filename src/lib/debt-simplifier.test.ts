import { describe, expect, it } from "vitest";
import { simplifyDebts } from "./debt-simplifier";
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

  it("greedily matches the largest debtor with the largest creditor", () => {
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
});
