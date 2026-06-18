"use client";

import { useEffect, useState } from "react";

import type { GroupInvite } from "@/lib/models";
import { useRepository } from "@/hooks/use-repository";

export function useInvites(): GroupInvite[] {
  const repo = useRepository();
  const [invites, setInvites] = useState<GroupInvite[]>([]);

  useEffect(() => {
    if (!repo) return;
    const unsub = repo.subscribeInvites(setInvites);
    return () => unsub();
  }, [repo]);

  return invites;
}
