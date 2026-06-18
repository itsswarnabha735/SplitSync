"use client";

import { useMemo } from "react";

import { useAuth } from "@/hooks/use-auth";
import { makeRepository, type Repository } from "@/services/repository";

/**
 * Returns a memoized repository bound to the current user's uid.
 */
export function useRepository(): Repository | null {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  return useMemo(() => (uid ? makeRepository(uid) : null), [uid]);
}
