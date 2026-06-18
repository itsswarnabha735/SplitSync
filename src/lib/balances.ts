import {
  AdHocExpense,
  AdHocPayment,
  Expense,
  Friend,
  FriendWithBalance,
  GroupMember,
  MemberBalanceInfo,
  Payment,
  YOU_ID,
} from "./models";

/**
 * Per-member, per-currency balance composition. Ported from
 * `SplitSyncRepository.calculateBalances`.
 */
export function calculateGroupBalances(
  members: GroupMember[],
  expenses: Expense[],
  payments: Payment[]
): MemberBalanceInfo[] {
  const currencies = uniqueCurrencies(
    expenses.map((e) => e.currency).concat(payments.map((p) => p.currency))
  );

  const result: MemberBalanceInfo[] = [];
  for (const cur of currencies) {
    for (const member of members) {
      const initialPaid = sum(
        expenses
          .filter((e) => e.paidById === member.id && e.currency === cur)
          .map((e) => e.amount)
      );
      const initialOwe = sum(
        expenses
          .filter((e) => e.currency === cur)
          .map((e) => e.splits[member.id] ?? 0)
      );
      const paymentsMadeAsSender = sum(
        payments
          .filter((p) => p.fromMemberId === member.id && p.currency === cur)
          .map((p) => p.amount)
      );
      const paymentsMadeAsReceiver = sum(
        payments
          .filter((p) => p.toMemberId === member.id && p.currency === cur)
          .map((p) => p.amount)
      );

      result.push({
        member,
        currency: cur,
        initialPaid,
        initialOwe,
        paymentsMadeAsSender,
        paymentsMadeAsReceiver,
      });
    }
  }
  return result;
}

/**
 * Friend balances for the ad-hoc ledger. Ported from
 * `SplitSyncRepository.getFriendsWithBalancesFlow`.
 * Positive => the friend owes you; negative => you owe the friend.
 */
export function calculateFriendBalances(
  friends: Friend[],
  expenses: AdHocExpense[],
  payments: AdHocPayment[]
): FriendWithBalance[] {
  const currencies = uniqueCurrencies(
    expenses.map((e) => e.currency).concat(payments.map((p) => p.currency))
  );

  const result: FriendWithBalance[] = [];
  for (const cur of currencies) {
    for (const friend of friends) {
      let balance = 0;
      for (const expense of expenses) {
        if (expense.currency !== cur) continue;
        if (expense.paidByFriendId === YOU_ID) {
          balance += expense.splits[friend.id] ?? 0;
        } else if (expense.paidByFriendId === friend.id) {
          balance -= expense.splits[YOU_ID] ?? 0;
        }
      }
      for (const payment of payments) {
        if (payment.currency !== cur) continue;
        if (payment.fromFriendId === friend.id && payment.toFriendId === YOU_ID) {
          balance -= payment.amount;
        } else if (
          payment.fromFriendId === YOU_ID &&
          payment.toFriendId === friend.id
        ) {
          balance += payment.amount;
        }
      }
      result.push({ friend, netBalance: balance, currency: cur });
    }
  }
  return result;
}

/** Derives flat AdHocSplit projections from embedded split maps. */
export function deriveAdHocSplits(expenses: AdHocExpense[]) {
  return expenses.flatMap((exp) =>
    Object.entries(exp.splits).map(([participantId, portion]) => ({
      id: `${exp.id}:${participantId}`,
      adhocExpenseId: exp.id,
      participantFriendId: participantId,
      amount: portion,
    }))
  );
}

function uniqueCurrencies(codes: string[]): string[] {
  const distinct = Array.from(new Set(codes));
  return distinct.length > 0 ? distinct : ["USD"];
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
