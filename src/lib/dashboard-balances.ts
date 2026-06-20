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
  const signedNet: CurrencyTotals = {};

  for (const f of friendsWithBalances) {
    addNet(signedNet, f.currency, f.netBalance);
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
              addNet(signedNet, expense.currency, share);
            }
          }
        } else if (isUnlinkedCounterparty(expense.paidById)) {
          addNet(
            signedNet,
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
          addNet(signedNet, payment.currency, payment.amount);
        } else if (
          payment.toMemberId === youMember.id &&
          isUnlinkedCounterparty(payment.fromMemberId)
        ) {
          addNet(signedNet, payment.currency, -payment.amount);
        }
      }
    }
  }

  const youAreOwed: CurrencyTotals = {};
  const youOwe: CurrencyTotals = {};
  const net: CurrencyTotals = {};
  for (const [cur, amount] of Object.entries(signedNet)) {
    net[cur] = amount;
    if (amount > 0) {
      youAreOwed[cur] = amount;
    } else if (amount < 0) {
      youOwe[cur] = -amount;
    }
  }

  return { youAreOwed, youOwe, net };
}

function addNet(
  totals: CurrencyTotals,
  currency: string,
  amount: number
) {
  totals[currency] = (totals[currency] ?? 0) + amount;
}
