"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useGroups } from "@/hooks/use-groups";
import { useFriends } from "@/hooks/use-friends";
import { useInvites } from "@/hooks/use-invites";
import { useDashboardBalances } from "@/hooks/use-dashboard-balances";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import { signOut } from "@/services/auth";
import type { AdHocExpense } from "@/lib/models";
import { formatMoney } from "@/lib/currency";
import { deriveSpendEntries, type SpendEntry } from "@/lib/spend-analysis";
import { AppHeader } from "@/components/app-header";
import { CurrencyTotals } from "@/components/currency-totals";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GroupsTab } from "@/components/dashboard/groups-tab";
import { FriendsTab } from "@/components/dashboard/friends-tab";
import { SpendTab } from "@/components/dashboard/spend-tab";
import { ReviewCenter } from "@/components/dashboard/review-center";
import { EditAdHocExpenseDialog } from "@/components/dialogs/add-adhoc-expense-dialog";

export default function DashboardPage() {
  const router = useRouter();
  const { user, displayName } = useAuth();
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const [pendingInviteAction, setPendingInviteAction] = useState<string | null>(
    null
  );
  const [activeTab, setActiveTab] = useState("groups");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [editingAdHocExpense, setEditingAdHocExpense] =
    useState<AdHocExpense | null>(null);
  const [pendingDeleteEntry, setPendingDeleteEntry] =
    useState<SpendEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState(false);
  const [deleteEntryError, setDeleteEntryError] = useState<string | null>(null);

  const { groups } = useGroups();
  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);
  const { friends, friendsWithBalances, adHocExpenses, adHocPayments, groupSlices } =
    useFriends(groupIds);
  const invites = useInvites();

  const { youAreOwed, youOwe, net } = useDashboardBalances(
    groupIds,
    friendsWithBalances,
    friends
  );
  const spendEntries = useMemo(
    () =>
      deriveSpendEntries({
        uid: user?.uid ?? null,
        groups,
        groupSlices,
        friends,
        adHocExpenses,
      }),
    [user?.uid, groups, groupSlices, friends, adHocExpenses]
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

  function handleEditSpendEntry(entry: SpendEntry) {
    const target = entry.editableTarget;
    if (!target) return;
    if (target.kind === "groupExpense") {
      router.push(`/groups/${target.groupId}`);
      return;
    }
    const expense = adHocExpenses.find((item) => item.id === target.expenseId);
    if (expense) {
      setEditingAdHocExpense(expense);
    } else {
      setActiveTab("friends");
    }
  }

  async function confirmDeleteSpendEntry() {
    const target = pendingDeleteEntry?.deletableTarget;
    if (!repo || !pendingDeleteEntry || !target) return;
    const entry = pendingDeleteEntry;
    setDeletingEntry(true);
    setDeleteEntryError(null);
    try {
      await runSyncing(
        () => {
          if (target.kind === "groupExpense") {
            const expense = groupSlices[target.groupId]?.expenses.find(
              (item) => item.id === target.expenseId
            );
            if (!expense) throw new Error("Could not find this group expense.");
            return repo.deleteExpense(expense);
          }
          const expense = adHocExpenses.find((item) => item.id === target.expenseId);
          if (!expense) throw new Error("Could not find this friend expense.");
          return repo.deleteAdHocExpense(expense);
        },
        {
          loading: "Deleting transaction...",
          success: "Transaction deleted.",
          error: "Could not delete transaction.",
        }
      );
      setPendingDeleteEntry(null);
    } catch (err) {
      setDeleteEntryError(
        err instanceof Error ? err.message : "Could not delete this transaction."
      );
    } finally {
      setDeletingEntry(false);
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
            className="h-11 w-11 sm:h-10 sm:w-10"
            aria-label="Sign out"
            onClick={() => signOut()}
          >
            <LogOut className="h-5 w-5" />
          </Button>
        }
      />

      <main
        id="main-content"
        className="container space-y-4 py-4 sm:space-y-5 sm:py-6"
      >
        {/* Summary */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
          <Card className="money-card social-gradient surface-glow col-span-2 p-4 text-white sm:col-span-1 sm:p-5">
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase leading-tight opacity-85 sm:text-xs">
                <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-white/18">
                  <Wallet className="h-3.5 w-3.5" />
                </span>
                Net balance
              </div>
              <CurrencyTotals
                totals={net}
                signed
                className="mt-3 flex-col gap-y-1 text-[1.75rem] font-black leading-none sm:flex-row sm:text-3xl"
                emptyLabel="All settled"
              />
            </div>
          </Card>
          <Card className="border-success/20 bg-success/10 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-[11px] font-black uppercase leading-tight text-muted-foreground sm:text-xs">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-success/15 text-success">
                <TrendingUp className="h-3.5 w-3.5" />
              </span>
              You are owed
            </div>
            <CurrencyTotals
              totals={youAreOwed}
              className="mt-2 flex-col gap-y-1 text-[1.55rem] font-black leading-tight text-success sm:mt-3 sm:text-3xl"
            />
          </Card>
          <Card className="border-destructive/20 bg-destructive/10 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-[11px] font-black uppercase leading-tight text-muted-foreground sm:text-xs">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
                <TrendingDown className="h-3.5 w-3.5" />
              </span>
              You owe
            </div>
            <CurrencyTotals
              totals={youOwe}
              className="mt-2 flex-col gap-y-1 text-[1.55rem] font-black leading-tight text-destructive sm:mt-3 sm:text-3xl"
            />
          </Card>
        </div>

        <ReviewCenter
          entries={spendEntries}
          outstandingNet={net}
          onOpenSpend={() => setActiveTab("spend")}
          onOpenBalances={() => setActiveTab("groups")}
          onEditEntry={handleEditSpendEntry}
          onDeleteEntry={setPendingDeleteEntry}
        />

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
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid h-12 w-full grid-cols-3 rounded-xl sm:h-11 sm:rounded-2xl">
            <TabsTrigger value="groups" className="rounded-lg sm:rounded-xl">
              Groups
            </TabsTrigger>
            <TabsTrigger value="friends" className="rounded-lg sm:rounded-xl">
              Friends
            </TabsTrigger>
            <TabsTrigger value="spend" className="rounded-lg sm:rounded-xl">
              Spend
            </TabsTrigger>
          </TabsList>

          <TabsContent value="groups">
            <GroupsTab groups={groups} />
          </TabsContent>

          <TabsContent value="friends">
            <FriendsTab
              friends={friends}
              friendsWithBalances={friendsWithBalances}
              adHocExpenses={adHocExpenses}
              adHocPayments={adHocPayments}
            />
          </TabsContent>

          <TabsContent value="spend">
            <SpendTab
              entries={spendEntries}
              outstandingNet={net}
              onEditEntry={handleEditSpendEntry}
              onDeleteEntry={setPendingDeleteEntry}
            />
          </TabsContent>
        </Tabs>
        <Dialog
          open={!!pendingDeleteEntry}
          onOpenChange={(open) => {
            if (deletingEntry) return;
            if (!open) {
              setPendingDeleteEntry(null);
              setDeleteEntryError(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete transaction?</DialogTitle>
            </DialogHeader>
            {pendingDeleteEntry && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3">
                  <p className="font-black">{pendingDeleteEntry.scopeName}</p>
                  <p className="text-sm text-muted-foreground">
                    {pendingDeleteEntry.categoryName} ·{" "}
                    {formatMoney(
                      pendingDeleteEntry.fullAmount,
                      pendingDeleteEntry.currency
                    )}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  This removes the transaction from the ledger and recalculates
                  balances. This cannot be undone.
                </p>
                {deleteEntryError && (
                  <p
                    className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
                    role="alert"
                  >
                    {deleteEntryError}
                  </p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setPendingDeleteEntry(null);
                  setDeleteEntryError(null);
                }}
                disabled={deletingEntry}
              >
                Cancel
              </Button>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={confirmDeleteSpendEntry}
                disabled={deletingEntry}
              >
                {deletingEntry ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <EditAdHocExpenseDialog
          expense={editingAdHocExpense}
          friends={friends}
          open={!!editingAdHocExpense}
          onOpenChange={(open) => {
            if (!open) setEditingAdHocExpense(null);
          }}
        />
      </main>
    </div>
  );
}
