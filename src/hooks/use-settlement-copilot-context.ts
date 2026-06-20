"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";

import { useGroups } from "@/hooks/use-groups";
import { useFriends } from "@/hooks/use-friends";
import { useGroupDetail } from "@/hooks/use-group-detail";
import { useRepository } from "@/hooks/use-repository";
import { deriveDashboardBalanceTotals } from "@/lib/dashboard-balances";
import {
  buildDashboardCopilotContext,
  buildGroupCopilotContext,
} from "@/lib/settlement-copilot-context";
import type {
  SettlementCopilotContext,
  SettlementCopilotContextType,
} from "@/lib/settlement-copilot";

export function useSettlementCopilotContext(): {
  contextType: SettlementCopilotContextType;
  context: SettlementCopilotContext;
} {
  const pathname = usePathname();
  const repo = useRepository();
  const uid = repo?.uid ?? null;
  const groupId = routeGroupId(pathname);
  const { groups } = useGroups();
  const groupIds = useMemo(() => groups.map((group) => group.id), [groups]);
  const { friends, friendsWithBalances, groupSlices } = useFriends(groupIds);
  const groupDetail = useGroupDetail(groupId);

  const dashboardTotals = useMemo(
    () =>
      deriveDashboardBalanceTotals({
        slices: groupSlices,
        friendsWithBalances,
        friends,
        uid,
      }),
    [friends, friendsWithBalances, groupSlices, uid]
  );

  return useMemo(() => {
    if (groupId && groupDetail.group) {
      return {
        contextType: "group",
        context: buildGroupCopilotContext({
          group: groupDetail.group,
          members: groupDetail.members,
          expenses: groupDetail.expenses,
          payments: groupDetail.payments,
          balances: groupDetail.balances,
          simplifiedDebts: groupDetail.simplifiedDebts,
          settlementError: groupDetail.settlementError,
          totalsByCurrency: groupDetail.totalsByCurrency,
        }),
      };
    }

    return {
      contextType: "dashboard",
      context: buildDashboardCopilotContext({
        groups,
        groupSlices,
        friends,
        friendsWithBalances,
        dashboardTotals,
      }),
    };
  }, [
    dashboardTotals,
    friends,
    friendsWithBalances,
    groupDetail.balances,
    groupDetail.expenses,
    groupDetail.group,
    groupDetail.members,
    groupDetail.payments,
    groupDetail.settlementError,
    groupDetail.simplifiedDebts,
    groupDetail.totalsByCurrency,
    groupId,
    groupSlices,
    groups,
  ]);
}

function routeGroupId(pathname: string): string | null {
  const match = pathname.match(/^\/groups\/([^/]+)/);
  if (!match) return null;
  const id = decodeURIComponent(match[1] ?? "");
  return id && id !== "create" ? id : null;
}
