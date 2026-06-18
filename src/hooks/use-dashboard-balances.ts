"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  Expense,
  Friend,
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
  friendsWithBalances: FriendWithBalance[],
  friends: Friend[] = []
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

  // Build a Set of linkedUids for all friends so we can detect which group
  // members are already represented in friendsWithBalances.
  const linkedFriendUids = useMemo(
    () => new Set(friends.map((f) => f.linkedUid).filter(Boolean)),
    [friends]
  );

  return useMemo(() => {
    const youAreOwed: CurrencyTotals = {};
    const youOwe: CurrencyTotals = {};

    // Friend side: ad-hoc + group-derived pairwise balances (already user-scoped).
    // This already covers all group interactions with linked friends.
    for (const f of friendsWithBalances) {
      if (f.netBalance > 0) {
        youAreOwed[f.currency] = (youAreOwed[f.currency] ?? 0) + f.netBalance;
      } else if (f.netBalance < 0) {
        youOwe[f.currency] = (youOwe[f.currency] ?? 0) + -f.netBalance;
      }
    }

    // Group side: only add the net balance contribution from UNLINKED members
    // (i.e., members who don't have a linkedUid that matches any Friend).
    // Linked-friend contributions are already captured in friendsWithBalances above,
    // so including them here would double-count.
    if (uid) {
      for (const slice of Object.values(slices)) {
        const youMember = slice.members.find((m) => m.linkedUid === uid);
        if (!youMember) continue;

        // Filter to only expenses/payments where the other party is an unlinked member.
        const unlinkedExpenses = slice.expenses.filter((e) => {
          // Expense involves you on one side. The "other" payer or split recipient
          // must be an unlinked member for it to be uncovered by friendsWithBalances.
          const otherPayerId = e.paidById !== youMember.id ? e.paidById : null;
          if (otherPayerId) {
            const otherMember = slice.members.find((m) => m.id === otherPayerId);
            if (otherMember && otherMember.linkedUid && linkedFriendUids.has(otherMember.linkedUid)) {
              // Payer is a linked friend — already counted via friendsWithBalances.
              return false;
            }
          }
          // Check if ALL other split recipients (besides you) are linked friends.
          const otherSplitIds = Object.keys(e.splits).filter(
            (id) => id !== youMember.id
          );
          const allLinked = otherSplitIds.every((id) => {
            const m = slice.members.find((mem) => mem.id === id);
            return m && m.linkedUid && linkedFriendUids.has(m.linkedUid);
          });
          // Include only if NOT all linked (i.e. at least one unlinked party).
          return !allLinked;
        });

        const unlinkedPayments = slice.payments.filter((p) => {
          const otherId =
            p.fromMemberId === youMember.id ? p.toMemberId : p.fromMemberId;
          const otherMember = slice.members.find((m) => m.id === otherId);
          if (
            otherMember &&
            otherMember.linkedUid &&
            linkedFriendUids.has(otherMember.linkedUid)
          ) {
            return false; // Already counted via friendsWithBalances.
          }
          return true;
        });

        if (unlinkedExpenses.length === 0 && unlinkedPayments.length === 0)
          continue;

        const balances = calculateGroupBalances(
          slice.members,
          unlinkedExpenses,
          unlinkedPayments
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
  }, [slices, friendsWithBalances, uid, linkedFriendUids]);
}

function emptySlice(existing?: GroupSlice): GroupSlice {
  return existing ?? { members: [], expenses: [], payments: [] };
}
