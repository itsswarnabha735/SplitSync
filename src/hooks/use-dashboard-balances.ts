"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  Friend,
  FriendWithBalance,
} from "@/lib/models";
import {
  deriveDashboardBalanceTotals,
  type DashboardGroupSlice,
} from "@/lib/dashboard-balances";
import { useRepository } from "@/hooks/use-repository";

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
  const [slices, setSlices] = useState<Record<string, DashboardGroupSlice>>({});

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

  return useMemo(
    () =>
      deriveDashboardBalanceTotals({
        slices,
        friendsWithBalances,
        friends,
        uid,
      }),
    [slices, friendsWithBalances, friends, uid]
  );
}

function emptySlice(existing?: DashboardGroupSlice): DashboardGroupSlice {
  return existing ?? { members: [], expenses: [], payments: [] };
}
