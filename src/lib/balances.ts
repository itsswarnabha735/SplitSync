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

/**
 * Per-friend balances derived from **group** transactions. For each group slice,
 * finds the "you" member (where `member.linkedUid === uid`) and each friend
 * member (where `member.linkedUid` matches a `Friend.linkedUid`). Then computes
 * pairwise (you ↔ friend) balances from group expenses and payments.
 *
 * Positive => the friend owes you; negative => you owe the friend.
 */
export function calculateFriendGroupBalances(
  friends: Friend[],
  uid: string,
  groupSlices: {
    members: GroupMember[];
    expenses: Expense[];
    payments: Payment[];
  }[]
): FriendWithBalance[] {
  // Build a lookup: linkedUid -> Friend (for friends that have a linkedUid).
  const friendByLinkedUid = new Map<string, Friend>();
  for (const f of friends) {
    if (f.linkedUid) friendByLinkedUid.set(f.linkedUid, f);
  }

  // Accumulate balances keyed by `${friend.id}::${currency}`.
  const accum = new Map<string, { friend: Friend; currency: string; net: number }>();

  for (const slice of groupSlices) {
    // Find the "you" member in this group.
    const youMember = slice.members.find((m) => m.linkedUid === uid);
    if (!youMember) continue;

    // Map group member IDs to Friends for linked members.
    const memberIdToFriend = new Map<string, Friend>();
    for (const m of slice.members) {
      if (m.id === youMember.id) continue;
      if (!m.linkedUid) continue;
      const friend = friendByLinkedUid.get(m.linkedUid);
      if (friend) memberIdToFriend.set(m.id, friend);
    }

    if (memberIdToFriend.size === 0) continue;

    // Collect all currencies in this group's transactions.
    const currencies = uniqueCurrencies(
      slice.expenses
        .map((e) => e.currency)
        .concat(slice.payments.map((p) => p.currency))
    );

    for (const cur of currencies) {
      for (const [memberId, friend] of memberIdToFriend) {
        let balance = 0;

        for (const expense of slice.expenses) {
          if (expense.currency !== cur) continue;
          // If "you" paid, the friend owes you their split share.
          if (expense.paidById === youMember.id) {
            balance += expense.splits[memberId] ?? 0;
          }
          // If the friend paid, you owe them your split share.
          if (expense.paidById === memberId) {
            balance -= expense.splits[youMember.id] ?? 0;
          }
        }

        for (const payment of slice.payments) {
          if (payment.currency !== cur) continue;
          // Friend paid you (settled what they owed).
          if (
            payment.fromMemberId === memberId &&
            payment.toMemberId === youMember.id
          ) {
            balance -= payment.amount;
          }
          // You paid the friend (settled what you owed).
          if (
            payment.fromMemberId === youMember.id &&
            payment.toMemberId === memberId
          ) {
            balance += payment.amount;
          }
        }

        const key = `${friend.id}::${cur}`;
        const existing = accum.get(key);
        if (existing) {
          existing.net += balance;
        } else {
          accum.set(key, { friend, currency: cur, net: balance });
        }
      }
    }
  }

  return Array.from(accum.values()).map((entry) => ({
    friend: entry.friend,
    netBalance: entry.net,
    currency: entry.currency,
  }));
}

/**
 * Merges two `FriendWithBalance[]` arrays (typically ad-hoc + group-derived),
 * summing `netBalance` for matching `(friend.id, currency)` pairs.
 */
export function mergeFriendBalances(
  ...sources: FriendWithBalance[][]
): FriendWithBalance[] {
  const map = new Map<
    string,
    { friend: Friend; currency: string; net: number }
  >();

  for (const balances of sources) {
    for (const b of balances) {
      const key = `${b.friend.id}::${b.currency}`;
      const existing = map.get(key);
      if (existing) {
        existing.net += b.netBalance;
      } else {
        map.set(key, {
          friend: b.friend,
          currency: b.currency,
          net: b.netBalance,
        });
      }
    }
  }

  return Array.from(map.values()).map((entry) => ({
    friend: entry.friend,
    netBalance: entry.net,
    currency: entry.currency,
  }));
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
