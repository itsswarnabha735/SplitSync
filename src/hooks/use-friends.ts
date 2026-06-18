"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  AdHocExpense,
  AdHocPayment,
  Expense,
  Friend,
  GroupMember,
  Payment,
} from "@/lib/models";
import {
  calculateFriendBalances,
  calculateFriendGroupBalances,
  deriveAdHocSplits,
  mergeFriendBalances,
} from "@/lib/balances";
import { useRepository } from "@/hooks/use-repository";

interface GroupSlice {
  members: GroupMember[];
  expenses: Expense[];
  payments: Payment[];
}

/**
 * Subscribes to the ad-hoc peer-to-peer ledger and derives friend balances +
 * flat split projections via `useMemo` (replaces the Kotlin `combine`).
 *
 * When `groupIds` are provided, also subscribes to group-level data and merges
 * group-derived pairwise balances into each friend's totals.
 */
export function useFriends(groupIds: string[] = []) {
  const repo = useRepository();
  const uid = repo?.uid ?? null;
  const [friends, setFriends] = useState<Friend[]>([]);
  const [adHocExpenses, setAdHocExpenses] = useState<AdHocExpense[]>([]);
  const [adHocPayments, setAdHocPayments] = useState<AdHocPayment[]>([]);
  const [groupSlices, setGroupSlices] = useState<Record<string, GroupSlice>>(
    {}
  );

  // Subscribe to ad-hoc data.
  useEffect(() => {
    if (!repo) return;
    const unsubs = [
      repo.subscribeFriends(setFriends),
      repo.subscribeAdHocExpenses(setAdHocExpenses),
      repo.subscribeAdHocPayments(setAdHocPayments),
    ];
    return () => unsubs.forEach((u) => u());
  }, [repo]);

  // Subscribe to group-level data (members, expenses, payments per group).
  // Stable key so the effect only re-subscribes when the set of groups changes.
  const idsKey = useMemo(() => [...groupIds].sort().join(","), [groupIds]);

  useEffect(() => {
    if (!repo) return;
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0 || (ids.length === 1 && ids[0] === "")) {
      setGroupSlices({});
      return;
    }

    const emptySlice = (existing?: GroupSlice): GroupSlice =>
      existing ?? { members: [], expenses: [], payments: [] };

    const unsubs = ids.flatMap((gid) => [
      repo.subscribeMembers(gid, (members) =>
        setGroupSlices((prev) => ({
          ...prev,
          [gid]: { ...emptySlice(prev[gid]), members },
        }))
      ),
      repo.subscribeExpenses(gid, (expenses) =>
        setGroupSlices((prev) => ({
          ...prev,
          [gid]: { ...emptySlice(prev[gid]), expenses },
        }))
      ),
      repo.subscribePayments(gid, (payments) =>
        setGroupSlices((prev) => ({
          ...prev,
          [gid]: { ...emptySlice(prev[gid]), payments },
        }))
      ),
    ]);

    return () => unsubs.forEach((u) => u());
  }, [repo, idsKey]);

  // Compute merged friend balances (ad-hoc + group-derived).
  const friendsWithBalances = useMemo(() => {
    const adHocBalances = calculateFriendBalances(
      friends,
      adHocExpenses,
      adHocPayments
    );

    if (!uid || Object.keys(groupSlices).length === 0) {
      return adHocBalances;
    }

    const groupBalances = calculateFriendGroupBalances(
      friends,
      uid,
      Object.values(groupSlices)
    );

    return mergeFriendBalances(adHocBalances, groupBalances);
  }, [friends, adHocExpenses, adHocPayments, uid, groupSlices]);

  const adHocSplits = useMemo(
    () => deriveAdHocSplits(adHocExpenses),
    [adHocExpenses]
  );

  return {
    friends,
    adHocExpenses,
    adHocPayments,
    friendsWithBalances,
    adHocSplits,
  };
}
