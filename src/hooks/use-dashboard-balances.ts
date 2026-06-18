"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  Expense,
  FriendWithBalance,
  GroupMember,
  Payment,
} from "@/lib/models";
import { netBalance } from "@/lib/models";
import { calculateGroupBalances } from "@/lib/balances";
import { useRepository } from "@/hooks/use-repository";

interface GroupSlice {
  members: GroupMember[];
  expenses: Expense[];
  payments: Payment[];
}

type CurrencyTotals = Record<string, number>;

/**
 * Cross-group aggregation for the dashboard "You are owed" / "You owe" totals.
 * Replaces the Kotlin `getAllGroupBalancesFlow` (flatMapLatest over all groups).
 * Only the signed-in user's rows (member.linkedUid === uid) count toward the
 * group side; friend balances are already user-scoped.
 */
export function useDashboardBalances(
  groupIds: string[],
  friendsWithBalances: FriendWithBalance[]
) {
  const repo = useRepository();
  const uid = repo?.uid ?? null;
  const [slices, setSlices] = useState<Record<string, GroupSlice>>({});

  // Stable key so the effect only re-subscribes when the set of groups changes.
  const idsKey = useMemo(() => [...groupIds].sort().join(","), [groupIds]);

  useEffect(() => {
    if (!repo) return;
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) {
      setSlices({});
      return;
    }

    const unsubs = ids.flatMap((gid) => [
      repo.subscribeMembers(gid, (members) =>
        setSlices((prev) => ({
          ...prev,
          [gid]: { ...emptySlice(prev[gid]), members },
        }))
      ),
      repo.subscribeExpenses(gid, (expenses) =>
        setSlices((prev) => ({
          ...prev,
          [gid]: { ...emptySlice(prev[gid]), expenses },
        }))
      ),
      repo.subscribePayments(gid, (payments) =>
        setSlices((prev) => ({
          ...prev,
          [gid]: { ...emptySlice(prev[gid]), payments },
        }))
      ),
    ]);

    return () => unsubs.forEach((u) => u());
  }, [repo, idsKey]);

  return useMemo(() => {
    const youAreOwed: CurrencyTotals = {};
    const youOwe: CurrencyTotals = {};

    // Friend side (already user-scoped).
    for (const f of friendsWithBalances) {
      if (f.netBalance > 0) {
        youAreOwed[f.currency] = (youAreOwed[f.currency] ?? 0) + f.netBalance;
      } else if (f.netBalance < 0) {
        youOwe[f.currency] = (youOwe[f.currency] ?? 0) + -f.netBalance;
      }
    }

    // Group side: only the "you" member rows.
    if (uid) {
      for (const slice of Object.values(slices)) {
        const balances = calculateGroupBalances(
          slice.members,
          slice.expenses,
          slice.payments
        );
        for (const b of balances) {
          if (b.member.linkedUid !== uid) continue;
          const net = netBalance(b);
          if (net > 0) {
            youAreOwed[b.currency] = (youAreOwed[b.currency] ?? 0) + net;
          } else if (net < 0) {
            youOwe[b.currency] = (youOwe[b.currency] ?? 0) + -net;
          }
        }
      }
    }

    const net: CurrencyTotals = {};
    for (const cur of new Set([
      ...Object.keys(youAreOwed),
      ...Object.keys(youOwe),
    ])) {
      net[cur] = (youAreOwed[cur] ?? 0) - (youOwe[cur] ?? 0);
    }

    return { youAreOwed, youOwe, net };
  }, [slices, friendsWithBalances, uid]);
}

function emptySlice(existing?: GroupSlice): GroupSlice {
  return existing ?? { members: [], expenses: [], payments: [] };
}
