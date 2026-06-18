"use client";

import { useEffect, useMemo, useState } from "react";

import type { AdHocExpense, AdHocPayment, Friend } from "@/lib/models";
import {
  calculateFriendBalances,
  deriveAdHocSplits,
} from "@/lib/balances";
import { useRepository } from "@/hooks/use-repository";

/**
 * Subscribes to the ad-hoc peer-to-peer ledger and derives friend balances +
 * flat split projections via `useMemo` (replaces the Kotlin `combine`).
 */
export function useFriends() {
  const repo = useRepository();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [adHocExpenses, setAdHocExpenses] = useState<AdHocExpense[]>([]);
  const [adHocPayments, setAdHocPayments] = useState<AdHocPayment[]>([]);

  useEffect(() => {
    if (!repo) return;
    const unsubs = [
      repo.subscribeFriends(setFriends),
      repo.subscribeAdHocExpenses(setAdHocExpenses),
      repo.subscribeAdHocPayments(setAdHocPayments),
    ];
    return () => unsubs.forEach((u) => u());
  }, [repo]);

  const friendsWithBalances = useMemo(
    () => calculateFriendBalances(friends, adHocExpenses, adHocPayments),
    [friends, adHocExpenses, adHocPayments]
  );

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
