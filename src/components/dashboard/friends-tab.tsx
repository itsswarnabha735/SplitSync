"use client";

import { useMemo, useState } from "react";
import {
  Edit3,
  Plus,
  Trash2,
  UserPlus,
  Receipt,
  HandCoins,
  Loader2,
  MoreVertical,
} from "lucide-react";

import type {
  AdHocExpense,
  AdHocPayment,
  Friend,
  FriendWithBalance,
} from "@/lib/models";
import { YOU_ID } from "@/lib/models";
import { formatMoney } from "@/lib/currency";
import { buildFriendCopilotContext } from "@/lib/settlement-copilot-context";
import {
  canDeleteAdHocExpense,
  canDeleteAdHocPayment,
  canEditAdHocExpense,
} from "@/lib/edit-permissions";
import { useAuth } from "@/hooks/use-auth";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { AddFriendDialog } from "@/components/dialogs/add-friend-dialog";
import {
  AddAdHocExpenseDialog,
  EditAdHocExpenseDialog,
} from "@/components/dialogs/add-adhoc-expense-dialog";
import { SettleAdHocDialog } from "@/components/dialogs/settle-adhoc-dialog";
import { SettlementCopilotButton } from "@/components/settlement-copilot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type PendingAdHocDelete =
  | { kind: "expense"; item: AdHocExpense }
  | { kind: "payment"; item: AdHocPayment };

export function FriendsTab({
  friends,
  friendsWithBalances,
  adHocExpenses,
  adHocPayments,
}: {
  friends: Friend[];
  friendsWithBalances: FriendWithBalance[];
  adHocExpenses: AdHocExpense[];
  adHocPayments: AdHocPayment[];
}) {
  const { user } = useAuth();
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);

  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [settleTarget, setSettleTarget] = useState<FriendWithBalance | null>(
    null
  );
  const [editingExpense, setEditingExpense] = useState<AdHocExpense | null>(
    null
  );
  const [pendingDelete, setPendingDelete] = useState<PendingAdHocDelete | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [deletingFriendId, setDeletingFriendId] = useState<string | null>(null);
  const [deletingTransaction, setDeletingTransaction] = useState(false);

  // Group balances by friend so each friend shows one row (with per-currency).
  const byFriend = useMemo(() => {
    const map = new Map<string, { friend: Friend; balances: FriendWithBalance[] }>();
    for (const f of friends) map.set(f.id, { friend: f, balances: [] });
    for (const fb of friendsWithBalances) {
      const entry = map.get(fb.friend.id);
      if (entry) entry.balances.push(fb);
    }
    return Array.from(map.values());
  }, [friends, friendsWithBalances]);

  async function handleDeleteFriend(friend: Friend) {
    if (!repo) return;
    setError(null);
    setDeletingFriendId(friend.id);
    try {
      await runSyncing(() => repo.deleteFriend(friend), {
        loading: "Deleting friend...",
        success: "Friend deleted.",
        error: "Could not delete friend.",
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete this friend."
      );
    } finally {
      setDeletingFriendId(null);
    }
  }

  async function confirmDeleteTransaction() {
    if (!repo || !pendingDelete) return;
    const next = pendingDelete;
    setError(null);
    setDeletingTransaction(true);
    try {
      await runSyncing(
        () =>
          next.kind === "expense"
            ? repo.deleteAdHocExpense(next.item)
            : repo.deleteAdHocPayment(next.item),
        {
          loading:
            next.kind === "expense"
              ? "Deleting friend expense..."
              : "Deleting friend settlement...",
          success:
            next.kind === "expense"
              ? "Friend expense deleted."
              : "Friend settlement deleted.",
          error:
            next.kind === "expense"
              ? "Could not delete friend expense."
              : "Could not delete friend settlement.",
        }
      );
      setPendingDelete(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete this transaction."
      );
    } finally {
      setDeletingTransaction(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Friends
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button
            size="sm"
            variant="outline"
            className="h-11 w-full sm:h-9 sm:w-auto"
            onClick={() => setShowAddFriend(true)}
          >
            <UserPlus className="h-4 w-4" />
            Add friend
          </Button>
          <Button
            size="sm"
            className="h-11 w-full sm:h-9 sm:w-auto"
            onClick={() => setShowAddExpense(true)}
            disabled={friends.length === 0}
          >
            <Plus className="h-4 w-4" />
            Add expense
          </Button>
        </div>
      </div>

      {error && (
        <p
          className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {friends.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No friends yet"
          description="Add a friend to start tracking one-on-one expenses and IOUs."
          action={
            <Button size="sm" onClick={() => setShowAddFriend(true)}>
              <UserPlus className="h-4 w-4" />
              Add a friend
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {byFriend.map(({ friend, balances }) => {
            const nonZero = balances.filter(
              (b) => Math.abs(b.netBalance) > 0.01
            );
            const primary = nonZero[0];
            const friendExpenses = adHocExpenses.filter(
              (expense) =>
                expense.paidByFriendId === friend.id ||
                friend.id in expense.splits
            );
            const friendPayments = adHocPayments.filter(
              (payment) =>
                payment.fromFriendId === friend.id ||
                payment.toFriendId === friend.id
            );
            const copilotContext = buildFriendCopilotContext({
              friend,
              balances,
              expenses: friendExpenses,
              payments: friendPayments,
            });
            return (
              <Card key={friend.id} className="space-y-3 border-primary/10 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 items-start gap-3 sm:flex-1 sm:items-center">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent font-black text-accent-foreground shadow-inner shadow-white/50">
                      {friend.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{friend.name}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 sm:mt-0.5">
                        {nonZero.length === 0 ? (
                          <Badge
                            variant="muted"
                            className="rounded-xl sm:rounded-full"
                          >
                            Settled up
                          </Badge>
                        ) : (
                          nonZero.map((b) => (
                            <Badge
                              key={b.currency}
                              variant={
                                b.netBalance > 0 ? "success" : "destructive"
                              }
                              className="max-w-full rounded-xl text-left leading-tight sm:rounded-full"
                            >
                              {b.netBalance > 0
                                ? `owes you ${formatMoney(b.netBalance, b.currency)}`
                                : `you owe ${formatMoney(-b.netBalance, b.currency)}`}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="sm:hidden">
                      <FriendRowActions
                        friendName={friend.name}
                        deleting={deletingFriendId === friend.id}
                        disabled={!repo || deletingFriendId === friend.id}
                        onDelete={() => handleDeleteFriend(friend)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                    {primary && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-11 w-full sm:h-9 sm:w-auto"
                        onClick={() => setSettleTarget(primary)}
                      >
                        <HandCoins className="h-4 w-4" />
                        Settle
                      </Button>
                    )}
                    <SettlementCopilotButton
                      contextType="friend"
                      context={copilotContext}
                      prompt="Summarize this balance"
                      label="Ask"
                      buttonVariant="outline"
                      className={
                        primary
                          ? "h-11 w-full sm:h-9 sm:w-auto"
                          : "col-span-2 h-11 w-full sm:col-span-1 sm:h-9 sm:w-auto"
                      }
                    />
                  </div>
                  <div className="hidden sm:block">
                    <FriendRowActions
                      friendName={friend.name}
                      deleting={deletingFriendId === friend.id}
                      disabled={!repo || deletingFriendId === friend.id}
                      onDelete={() => handleDeleteFriend(friend)}
                    />
                  </div>
                </div>
                {(friendExpenses.length > 0 || friendPayments.length > 0) && (
                  <div className="space-y-2 border-t border-border/60 pt-3">
                    {[
                      ...friendExpenses.map((expense) => ({
                        kind: "expense" as const,
                        id: expense.id,
                        timestamp: expense.timestamp,
                        label: expense.description,
                        meta:
                          expense.paidByFriendId === YOU_ID
                            ? "Paid by you"
                            : `Paid by ${friend.name}`,
                        amount: expense.amount,
                        currency: expense.currency,
                        item: expense,
                      })),
                      ...friendPayments.map((payment) => ({
                        kind: "payment" as const,
                        id: payment.id,
                        timestamp: payment.timestamp,
                        label: `${paymentName(payment.fromFriendId, friend)} paid ${paymentName(
                          payment.toFriendId,
                          friend
                        )}`,
                        meta: "Settlement",
                        amount: payment.amount,
                        currency: payment.currency,
                        item: payment,
                      })),
                    ]
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .slice(0, 3)
                      .map((activity) => {
                      const canEdit =
                        activity.kind === "expense" &&
                        canEditAdHocExpense(activity.item, user?.uid);
                      const canDelete =
                        activity.kind === "expense"
                          ? canDeleteAdHocExpense(activity.item, user?.uid)
                          : canDeleteAdHocPayment(activity.item, user?.uid);
                      return (
                        <div
                          key={`${activity.kind}:${activity.id}`}
                          className="rounded-xl border border-border/70 px-3 py-3 sm:flex sm:items-center sm:gap-3 sm:py-2"
                        >
                          <div className="flex min-w-0 items-start gap-3 sm:flex-1 sm:items-center">
                            {activity.kind === "expense" ? (
                              <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground sm:mt-0" />
                            ) : (
                              <HandCoins className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground sm:mt-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-bold">
                                {activity.label}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {formatDate(activity.timestamp)} · {activity.meta}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 flex min-w-0 items-center justify-between gap-2 border-t border-border/60 pt-3 sm:mt-0 sm:border-0 sm:pt-0">
                            <p className="min-w-0 truncate text-sm font-black">
                              {formatMoney(activity.amount, activity.currency)}
                            </p>
                            {(canEdit || canDelete) && (
                              <div className="flex shrink-0 gap-1">
                                {canEdit && activity.kind === "expense" && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-11 w-11 px-0 sm:h-9 sm:w-auto sm:px-3"
                                    onClick={() => setEditingExpense(activity.item)}
                                    aria-label={`Edit ${activity.label}`}
                                  >
                                    <Edit3 className="h-4 w-4" />
                                    <span className="sr-only sm:not-sr-only">
                                      Edit
                                    </span>
                                  </Button>
                                )}
                                {canDelete && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-11 w-11 px-0 text-destructive hover:text-destructive sm:h-9 sm:w-auto sm:px-3"
                                    onClick={() => {
                                      if (activity.kind === "expense") {
                                        setPendingDelete({
                                          kind: "expense",
                                          item: activity.item,
                                        });
                                      } else {
                                        setPendingDelete({
                                          kind: "payment",
                                          item: activity.item,
                                        });
                                      }
                                    }}
                                    aria-label={`Delete ${activity.label}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    <span className="sr-only sm:not-sr-only">
                                      Delete
                                    </span>
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <AddFriendDialog open={showAddFriend} onOpenChange={setShowAddFriend} />
      <AddAdHocExpenseDialog
        open={showAddExpense}
        onOpenChange={setShowAddExpense}
        friends={friends}
        adHocExpenses={adHocExpenses}
      />
      <EditAdHocExpenseDialog
        expense={editingExpense}
        friends={friends}
        open={!!editingExpense}
        onOpenChange={(open) => {
          if (!open) setEditingExpense(null);
        }}
      />
      <SettleAdHocDialog
        target={settleTarget}
        onClose={() => setSettleTarget(null)}
      />
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (deletingTransaction) return;
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {pendingDelete?.kind === "payment" ? "settlement" : "expense"}?
            </DialogTitle>
          </DialogHeader>
          {pendingDelete && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3">
                <p className="font-black">
                  {pendingDelete.kind === "expense"
                    ? pendingDelete.item.description
                    : "Friend settlement"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatMoney(pendingDelete.item.amount, pendingDelete.item.currency)}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                This removes the transaction and recalculates balances. This
                cannot be undone.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
              disabled={deletingTransaction}
            >
              Cancel
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={confirmDeleteTransaction}
              disabled={deletingTransaction}
            >
              {deletingTransaction ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function paymentName(participantId: string, friend: Friend): string {
  if (participantId === YOU_ID) return "You";
  if (participantId === friend.id) return friend.name;
  return "Friend";
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function FriendRowActions({
  friendName,
  deleting,
  disabled,
  onDelete,
}: {
  friendName: string;
  deleting: boolean;
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label={`Actions for ${friendName}`}
          disabled={disabled}
        >
          {deleting ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <MoreVertical className="h-5 w-5 text-muted-foreground" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={(event) => {
            event.preventDefault();
            onDelete();
          }}
        >
          <Trash2 className="h-4 w-4" />
          Delete friend
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
