"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Edit3, HandCoins, Receipt, Trash2 } from "lucide-react";

import type { AdHocExpense, AdHocPayment, Friend } from "@/lib/models";
import { YOU_ID } from "@/lib/models";
import { formatMoney } from "@/lib/currency";
import {
  canDeleteAdHocExpense,
  canDeleteAdHocPayment,
  canEditAdHocExpense,
  canEditAdHocPayment,
} from "@/lib/edit-permissions";
import { useAuth } from "@/hooks/use-auth";
import { useFriends } from "@/hooks/use-friends";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import { AppHeader } from "@/components/app-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EditAdHocExpenseDialog } from "@/components/dialogs/add-adhoc-expense-dialog";
import { EditAdHocPaymentDialog } from "@/components/dialogs/settle-adhoc-dialog";

type FriendActivity =
  | {
      kind: "expense";
      id: string;
      timestamp: number;
      title: string;
      meta: string;
      amount: number;
      currency: string;
      item: AdHocExpense;
    }
  | {
      kind: "payment";
      id: string;
      timestamp: number;
      title: string;
      meta: string;
      amount: number;
      currency: string;
      item: AdHocPayment;
    };

type PendingDelete =
  | { kind: "expense"; item: AdHocExpense; title: string }
  | { kind: "payment"; item: AdHocPayment; title: string };

export default function FriendTransactionsPage() {
  const params = useParams<{ friendId: string }>();
  const friendId = params.friendId;
  const { user } = useAuth();
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const { friends, adHocExpenses, adHocPayments } = useFriends();

  const [editingExpense, setEditingExpense] = useState<AdHocExpense | null>(
    null
  );
  const [editingPayment, setEditingPayment] = useState<AdHocPayment | null>(
    null
  );
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const friend = useMemo(
    () => friends.find((item) => item.id === friendId) ?? null,
    [friendId, friends]
  );

  const activities = useMemo(() => {
    if (!friend) return [];
    const expenses: FriendActivity[] = adHocExpenses
      .filter(
        (expense) =>
          expense.paidByFriendId === friend.id || friend.id in expense.splits
      )
      .map((expense) => ({
        kind: "expense",
        id: expense.id,
        timestamp: expense.timestamp,
        title: expense.description,
        meta:
          expense.paidByFriendId === YOU_ID
            ? "Paid by you"
            : `Paid by ${friend.name}`,
        amount: expense.amount,
        currency: expense.currency,
        item: expense,
      }));
    const payments: FriendActivity[] = adHocPayments
      .filter(
        (payment) =>
          payment.fromFriendId === friend.id || payment.toFriendId === friend.id
      )
      .map((payment) => ({
        kind: "payment",
        id: payment.id,
        timestamp: payment.timestamp,
        title: `${participantName(payment.fromFriendId, friend)} paid ${participantName(
          payment.toFriendId,
          friend
        )}`,
        meta: "Settlement",
        amount: payment.amount,
        currency: payment.currency,
        item: payment,
      }));
    return [...expenses, ...payments].sort((a, b) => b.timestamp - a.timestamp);
  }, [adHocExpenses, adHocPayments, friend]);

  async function confirmDelete() {
    if (!repo || !pendingDelete) return;
    const target = pendingDelete;
    setDeleting(true);
    setDeleteError(null);
    try {
      await runSyncing(
        () =>
          target.kind === "expense"
            ? repo.deleteAdHocExpense(target.item)
            : repo.deleteAdHocPayment(target.item),
        {
          loading:
            target.kind === "expense"
              ? "Deleting expense..."
              : "Deleting settlement...",
          success:
            target.kind === "expense"
              ? "Expense deleted."
              : "Settlement deleted.",
          error:
            target.kind === "expense"
              ? "Could not delete expense."
              : "Could not delete settlement.",
        }
      );
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Could not delete transaction."
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="pb-16">
      <AppHeader
        title={friend ? `${friend.name} transactions` : "Transactions"}
        subtitle="Ad hoc expenses and settlements"
        showBack
      />

      <main
        id="main-content"
        className="container space-y-4 py-4 sm:space-y-5 sm:py-6"
      >
        {friend ? (
          <>
            <Card className="flex items-center gap-3 border-primary/10 p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent font-black text-accent-foreground shadow-inner shadow-white/50">
                {friend.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-black">{friend.name}</p>
                <p className="text-sm text-muted-foreground">
                  {activities.length} transaction
                  {activities.length === 1 ? "" : "s"}
                </p>
              </div>
            </Card>

            {activities.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No transactions yet"
                description="Ad hoc expenses and settlements with this friend will appear here."
              />
            ) : (
              <div className="space-y-2">
                {activities.map((activity) => (
                  <TransactionRow
                    key={`${activity.kind}:${activity.id}`}
                    activity={activity}
                    friend={friend}
                    uid={user?.uid ?? null}
                    onEditExpense={setEditingExpense}
                    onEditPayment={setEditingPayment}
                    onDelete={setPendingDelete}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={Receipt}
            title="Friend not found"
            description="Go back to the Friends tab and choose a friend again."
          />
        )}
      </main>

      <EditAdHocExpenseDialog
        expense={editingExpense}
        friends={friends}
        open={!!editingExpense}
        onOpenChange={(open) => {
          if (!open) setEditingExpense(null);
        }}
      />
      <EditAdHocPaymentDialog
        payment={editingPayment}
        friend={friend}
        open={!!editingPayment}
        onOpenChange={(open) => {
          if (!open) setEditingPayment(null);
        }}
      />
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (deleting) return;
          if (!open) {
            setPendingDelete(null);
            setDeleteError(null);
          }
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
                <p className="font-black">{pendingDelete.title}</p>
                <p className="text-sm text-muted-foreground">
                  {formatMoney(
                    pendingDelete.item.amount,
                    pendingDelete.item.currency
                  )}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                This removes the transaction and recalculates balances. This
                cannot be undone.
              </p>
              {deleteError && (
                <p
                  className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
                  role="alert"
                >
                  {deleteError}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setPendingDelete(null);
                setDeleteError(null);
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TransactionRow({
  activity,
  friend,
  uid,
  onEditExpense,
  onEditPayment,
  onDelete,
}: {
  activity: FriendActivity;
  friend: Friend;
  uid: string | null;
  onEditExpense: (expense: AdHocExpense) => void;
  onEditPayment: (payment: AdHocPayment) => void;
  onDelete: (target: PendingDelete) => void;
}) {
  const canEdit =
    activity.kind === "expense"
      ? canEditAdHocExpense(activity.item, uid)
      : canEditAdHocPayment(activity.item, uid);
  const canDelete =
    activity.kind === "expense"
      ? canDeleteAdHocExpense(activity.item, uid)
      : canDeleteAdHocPayment(activity.item, uid);

  return (
    <Card className="rounded-2xl border-primary/10 px-3 py-3 sm:flex sm:items-center sm:gap-3 sm:py-2">
      <div className="flex min-w-0 items-start gap-3 sm:flex-1 sm:items-center">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground sm:mt-0">
          {activity.kind === "expense" ? (
            <Receipt className="h-4 w-4" />
          ) : (
            <HandCoins className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{activity.title}</p>
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
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                className="h-11 w-11 px-0 sm:h-9 sm:w-auto sm:px-3"
                onClick={() => {
                  if (activity.kind === "expense") {
                    onEditExpense(activity.item);
                  } else {
                    onEditPayment(activity.item);
                  }
                }}
                aria-label={`Edit ${activity.title}`}
              >
                <Edit3 className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">Edit</span>
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="h-11 w-11 px-0 text-destructive hover:text-destructive sm:h-9 sm:w-auto sm:px-3"
                onClick={() =>
                  onDelete({
                    kind: activity.kind,
                    item: activity.item,
                    title: activity.title,
                  } as PendingDelete)
                }
                aria-label={`Delete ${activity.title}`}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">Delete</span>
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function participantName(participantId: string, friend: Friend): string {
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
