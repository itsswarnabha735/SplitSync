"use client";

import { useMemo, useState } from "react";
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
  const [pendingInviteAction, setPendingInviteAction] = useState<string | null>(
    null
  );
  const [inviteError, setInviteError] = useState<string | null>(null);

  const { groups } = useGroups();
  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);
  const { friends, friendsWithBalances } = useFriends(groupIds);
  const invites = useInvites();

  const { youAreOwed, youOwe, net } = useDashboardBalances(
    groupIds,
    friendsWithBalances,
    friends
  );

  async function handleInviteAction(
    inv: (typeof invites)[number],
    action: "accept" | "decline"
  ) {
    if (!repo) return;
    const actionId = `${action}:${inv.id}`;
    setPendingInviteAction(actionId);
    setInviteError(null);
    try {
      await runSyncing(
        () =>
          action === "accept"
            ? repo.acceptInvite(inv, displayName, user?.email ?? "")
            : repo.declineInvite(inv),
        {
          loading:
            action === "accept" ? "Accepting invite..." : "Declining invite...",
          success:
            action === "accept" ? "Invite accepted." : "Invite declined.",
          error: "Could not update invite.",
        }
      );
    } catch (err) {
      setInviteError(
        err instanceof Error ? err.message : "Could not update invite."
      );
    } finally {
      setPendingInviteAction(null);
    }
  }

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

      <main id="main-content" className="container space-y-5 py-6">
        {/* Summary */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="money-card social-gradient surface-glow p-5 text-white">
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-xs font-black uppercase opacity-85">
                <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-white/18">
                  <Wallet className="h-3.5 w-3.5" />
                </span>
                Net balance
              </div>
              <CurrencyTotals
                totals={net}
                signed
                className="mt-3 text-3xl font-black tracking-tight"
                emptyLabel="All settled"
              />
            </div>
          </Card>
          <Card className="border-success/20 bg-success/10 p-5">
            <div className="flex items-center gap-2 text-xs font-black uppercase text-muted-foreground">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-success/15 text-success">
                <TrendingUp className="h-3.5 w-3.5" />
              </span>
              You are owed
            </div>
            <CurrencyTotals
              totals={youAreOwed}
              className="mt-3 text-3xl font-black tracking-tight text-success"
            />
          </Card>
          <Card className="border-destructive/20 bg-destructive/10 p-5">
            <div className="flex items-center gap-2 text-xs font-black uppercase text-muted-foreground">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
                <TrendingDown className="h-3.5 w-3.5" />
              </span>
              You owe
            </div>
            <CurrencyTotals
              totals={youOwe}
              className="mt-3 text-3xl font-black tracking-tight text-destructive"
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
                className="flex items-center gap-3 border-primary/25 bg-primary/5 p-3"
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
                  onClick={() => handleInviteAction(inv, "decline")}
                  disabled={pendingInviteAction !== null}
                >
                  {pendingInviteAction === `decline:${inv.id}`
                    ? "Declining..."
                    : "Decline"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleInviteAction(inv, "accept")}
                  disabled={pendingInviteAction !== null}
                >
                  {pendingInviteAction === `accept:${inv.id}`
                    ? "Accepting..."
                    : "Accept"}
                </Button>
              </Card>
            ))}
            {inviteError && (
              <p
                className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
                role="alert"
              >
                {inviteError}
              </p>
            )}
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
            <Card className="space-y-4 border-primary/10 p-5">
              <div className="flex items-center gap-3">
                <div className="social-gradient surface-glow flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-black text-white">
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
