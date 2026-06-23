"use client";

import { useEffect, useState } from "react";

import type {
  TransactionCandidate,
  TransactionRadarSettings,
  TransactionRule,
} from "@/lib/models";
import { useRepository } from "@/hooks/use-repository";

export function useTransactionRadar() {
  const repo = useRepository();
  const [candidates, setCandidates] = useState<TransactionCandidate[]>([]);
  const [rules, setRules] = useState<TransactionRule[]>([]);
  const [settings, setSettings] = useState<TransactionRadarSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!repo) return;
    setLoading(true);
    let settled = 0;
    const markSettled = () => {
      settled += 1;
      if (settled >= 3) setLoading(false);
    };
    const unsubs = [
      repo.subscribeTransactionCandidates((items) => {
        setCandidates(items);
        markSettled();
      }),
      repo.subscribeTransactionRules((items) => {
        setRules(items);
        markSettled();
      }),
      repo.subscribeTransactionRadarSettings((value) => {
        setSettings(value);
        markSettled();
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [repo]);

  return { candidates, rules, settings, loading };
}
