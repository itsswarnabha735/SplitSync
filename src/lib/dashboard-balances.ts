import type {
  Expense,
  Friend,
  FriendWithBalance,
  GroupMember,
  Payment,
} from "./models";

export interface DashboardGroupSlice {
  members: GroupMember[];
  expenses: Expense[];
  payments: Payment[];
}

type CurrencyTotals = Record<string, number>;

export interface DashboardBalanceTotals {
  youAreOwed: CurrencyTotals;
  youOwe: CurrencyTotals;
  net: CurrencyTotals;
}

export function deriveDashboardBalanceTotals(params: {
  slices: Record<string, DashboardGroupSlice>;
  friendsWithBalances: FriendWithBalance[];
  friends: Friend[];
  uid: string | null;
}): DashboardBalanceTotals {
  const { slices, friendsWithBalances, friends, uid } = params;
  const youAreOwed: CurrencyTotals = {};
  const youOwe: CurrencyTotals = {};

  for (const f of friendsWithBalances) {
    addSignedBalance(youAreOwed, youOwe, f.currency, f.netBalance);
  }

  if (uid) {
    const linkedFriendUids = new Set(
      friends.map((f) => f.linkedUid).filter(Boolean)
    );

    for (const slice of Object.values(slices)) {
      const youMember = slice.members.find((m) => m.linkedUid === uid);
      if (!youMember) continue;

      const memberById = new Map(slice.members.map((m) => [m.id, m]));
      const isUnlinkedCounterparty = (memberId: string) => {
        const member = memberById.get(memberId);
        return (
          !!member &&
          member.id !== youMember.id &&
          !(member.linkedUid && linkedFriendUids.has(member.linkedUid))
        );
      };

      for (const expense of slice.expenses) {
        if (expense.paidById === youMember.id) {
          for (const [memberId, share] of Object.entries(expense.splits)) {
            if (isUnlinkedCounterparty(memberId)) {
              addSignedBalance(youAreOwed, youOwe, expense.currency, share);
            }
          }
        } else if (isUnlinkedCounterparty(expense.paidById)) {
          addSignedBalance(
            youAreOwed,
            youOwe,
            expense.currency,
            -(expense.splits[youMember.id] ?? 0)
          );
        }
      }

      for (const payment of slice.payments) {
        if (
          payment.fromMemberId === youMember.id &&
          isUnlinkedCounterparty(payment.toMemberId)
        ) {
          addSignedBalance(youAreOwed, youOwe, payment.currency, payment.amount);
        } else if (
          payment.toMemberId === youMember.id &&
          isUnlinkedCounterparty(payment.fromMemberId)
        ) {
          addSignedBalance(
            youAreOwed,
            youOwe,
            payment.currency,
            -payment.amount
          );
        }
      }
    }
  }

  const net: CurrencyTotals = {};
  for (const cur of new Set([...Object.keys(youAreOwed), ...Object.keys(youOwe)])) {
    net[cur] = (youAreOwed[cur] ?? 0) - (youOwe[cur] ?? 0);
  }

  return { youAreOwed, youOwe, net };
}

function addSignedBalance(
  owed: CurrencyTotals,
  owe: CurrencyTotals,
  currency: string,
  amount: number
) {
  if (amount > 0) {
    owed[currency] = (owed[currency] ?? 0) + amount;
  } else if (amount < 0) {
    owe[currency] = (owe[currency] ?? 0) + -amount;
  }
}
