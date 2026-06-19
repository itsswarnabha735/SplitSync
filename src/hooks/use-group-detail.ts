"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  Expense,
  Group,
  GroupMember,
  Payment,
} from "@/lib/models";
import { calculateGroupBalances } from "@/lib/balances";
import { simplifyDebts } from "@/lib/debt-simplifier";
import { useRepository } from "@/hooks/use-repository";

/**
 * Subscribes to a single group's doc + members + expenses + payments and
 * derives member balances and simplified debts. Replaces the Kotlin
 * `combine(group, members, expenses, payments)` flows.
 */
export function useGroupDetail(groupId: string | null) {
  const repo = useRepository();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGroup(null);
    setMembers([]);
    setExpenses([]);
    setPayments([]);
    setError(null);

    if (!repo || !groupId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    let gotGroup = false;
    let active = true;
    const handleError = (err: Error) => {
      if (!active) return;
      setGroup(null);
      setMembers([]);
      setExpenses([]);
      setPayments([]);
      setError(err.message || "Unable to load this group.");
      setLoading(false);
    };

    const unsubs = [
      repo.subscribeGroup(groupId, (g) => {
        if (!active) return;
        setGroup(g);
        gotGroup = true;
        setLoading(false);
      }, handleError),
      repo.subscribeMembers(
        groupId,
        (nextMembers) => {
          if (active) setMembers(nextMembers);
        },
        handleError
      ),
      repo.subscribeExpenses(
        groupId,
        (nextExpenses) => {
          if (active) setExpenses(nextExpenses);
        },
        handleError
      ),
      repo.subscribePayments(
        groupId,
        (nextPayments) => {
          if (active) setPayments(nextPayments);
        },
        handleError
      ),
    ];
    // Failsafe in case the group doc listener is slow.
    const t = setTimeout(() => {
      if (active && !gotGroup) setLoading(false);
    }, 4000);
    return () => {
      active = false;
      clearTimeout(t);
      unsubs.forEach((u) => u());
    };
  }, [repo, groupId]);

  const balances = useMemo(
    () => calculateGroupBalances(members, expenses, payments),
    [members, expenses, payments]
  );

  const simplifiedDebts = useMemo(
    () => simplifyDebts(balances),
    [balances]
  );

  const totalsByCurrency = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const e of expenses) {
      totals[e.currency] = (totals[e.currency] ?? 0) + e.amount;
    }
    return totals;
  }, [expenses]);

  return {
    group,
    members,
    expenses,
    payments,
    balances,
    simplifiedDebts,
    totalsByCurrency,
    loading,
    error,
  };
}
