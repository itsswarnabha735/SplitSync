"use client";

import { useMemo } from "react";
import { LogOut, Mail, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useGroups } from "@/hooks/use-groups";
import { useFriends } from "@/hooks/use-friends";
import { useInvites } from "@/hooks/use-invites";
import { useDashboardBalances } from "@/hooks/use-dashboard-balances";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import { signOut } from "@/services/auth";
import { AppHeader } from "@/components/app-header";
import { CurrencyTotals } from "@/components/currency-totals";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GroupsTab } from "@/components/dashboard/groups-tab";
import { FriendsTab } from "@/components/dashboard/friends-tab";

export default function DashboardPage() {
  const { user, displayName } = useAuth();
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);

  const { groups } = useGroups();
  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);
  const { friends, friendsWithBalances } = useFriends(groupIds);
  const invites = useInvites();

  const { youAreOwed, youOwe, net } = useDashboardBalances(
    groupIds,
    friendsWithBalances,
    friends
  );

  return (
    <div className="pb-16">
      <AppHeader
        title={`Hi, ${displayName}`}
        subtitle="Here's where your money stands"
        actions={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            onClick={() => signOut()}
          >
            <LogOut className="h-5 w-5" />
          </Button>
        }
      />

      <main className="container space-y-5 py-5">
        {/* Summary */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="brand-gradient p-4 text-white">
            <div className="flex items-center gap-2 text-xs font-bold uppercase opacity-80">
              <Wallet className="h-3.5 w-3.5" />
              Net balance
            </div>
            <CurrencyTotals
              totals={net}
              signed
              className="mt-1 text-2xl font-black"
              emptyLabel="All settled"
            />
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5 text-success" />
              You are owed
            </div>
            <CurrencyTotals
              totals={youAreOwed}
              className="mt-1 text-2xl font-black text-success"
            />
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground">
              <TrendingDown className="h-3.5 w-3.5 text-destructive" />
              You owe
            </div>
            <CurrencyTotals
              totals={youOwe}
              className="mt-1 text-2xl font-black text-destructive"
            />
          </Card>
        </div>

        {/* Pending invites */}
        {invites.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Pending invites
            </h2>
            {invites.map((inv) => (
              <Card
                key={inv.id}
                className="flex items-center gap-3 border-primary/30 bg-primary/5 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{inv.groupName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Invited by {inv.invitedByName}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    repo && runSyncing(() => repo.declineInvite(inv))
                  }
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    repo &&
                    runSyncing(() =>
                      repo.acceptInvite(inv, displayName, user?.email ?? "")
                    )
                  }
                >
                  Accept
                </Button>
              </Card>
            ))}
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="groups">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="groups">Groups</TabsTrigger>
            <TabsTrigger value="friends">Friends</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="groups">
            <GroupsTab groups={groups} />
          </TabsContent>

          <TabsContent value="friends">
            <FriendsTab
              friends={friends}
              friendsWithBalances={friendsWithBalances}
            />
          </TabsContent>

          <TabsContent value="settings">
            <Card className="space-y-4 p-5">
              <div className="flex items-center gap-3">
                <div className="brand-gradient flex h-12 w-12 items-center justify-center rounded-full text-lg font-black text-white">
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-bold">{displayName}</p>
                  <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    {user?.email}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => signOut()}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
