"use client";

import { useEffect, useState } from "react";

import type { Group } from "@/lib/models";
import { useRepository } from "@/hooks/use-repository";

export function useGroups(): { groups: Group[]; loading: boolean } {
  const repo = useRepository();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!repo) return;
    setLoading(true);
    const unsub = repo.subscribeGroups((g) => {
      setGroups(g);
      setLoading(false);
    });
    return () => unsub();
  }, [repo]);

  return { groups, loading };
}
