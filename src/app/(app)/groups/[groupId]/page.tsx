"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Lightbulb,
  MoreVertical,
  Plus,
  Receipt,
  Trash2,
  UserPlus,
} from "lucide-react";

import type { DebtOverview, Expense, Payment } from "@/lib/models";
import { netBalance } from "@/lib/models";
import { currencySymbol, formatMoney } from "@/lib/currency";
import { useAuth } from "@/hooks/use-auth";
import { useGroupDetail } from "@/hooks/use-group-detail";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import { AppHeader } from "@/components/app-header";
import { EmptyState } from "@/components/empty-state";
import { CurrencyTotals } from "@/components/currency-totals";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InviteMemberDialog } from "@/components/dialogs/invite-member-dialog";
import { SettleGroupDialog } from "@/components/dialogs/settle-group-dialog";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function RowActions({
  label,
  deleteLabel,
  onDelete,
}: {
  label: string;
  deleteLabel: string;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label={`Actions for ${label}`}
        >
          <MoreVertical className="h-5 w-5 text-muted-foreground" />
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
          {deleteLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type PendingDelete =
  | { kind: "expense"; item: Expense }
  | { kind: "payment"; item: Payment };

export default function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  const router = useRouter();
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const { user } = useAuth();

  const {
    group,
    members,
    expenses,
    payments,
    balances,
    simplifiedDebts,
    totalsByCurrency,
    loading,
    error,
  } = useGroupDetail(groupId);

  const [showInvite, setShowInvite] = useState(false);
  const [settleDebt, setSettleDebt] = useState<DebtOverview | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const uid = user?.uid;
  const labelForMember = useMemo(() => {
    return (m: { name: string; linkedUid: string }) =>
      m.linkedUid && m.linkedUid === uid ? "You" : m.name;
  }, [uid]);

  const memberName = useMemo(() => {
    const map = new Map(
      members.map((m) => [m.id, m.linkedUid && m.linkedUid === uid ? "You" : m.name])
    );
    return (id: string) => map.get(id) ?? "Unknown";
  }, [members, uid]);

  async function confirmDelete() {
    if (!repo || !pendingDelete) return;
    const next = pendingDelete;
    setDeleting(true);
    setDeleteError(null);
    try {
      await runSyncing(
        () =>
          next.kind === "expense"
            ? repo.deleteExpense(next.item)
            : repo.deletePayment(next.item),
        {
          loading:
            next.kind === "expense"
              ? "Deleting expense..."
              : "Deleting settlement...",
          success:
            next.kind === "expense"
              ? "Expense deleted."
              : "Settlement deleted.",
          error:
            next.kind === "expense"
              ? "Could not delete expense."
              : "Could not delete settlement.",
        }
      );
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Could not delete this item."
      );
    } finally {
      setDeleting(false);
    }
  }

  const deleteSummary = pendingDelete
    ? pendingDelete.kind === "expense"
      ? {
          title: "Delete expense?",
          primary: pendingDelete.item.description,
          secondary: `${formatMoney(
            pendingDelete.item.amount,
            pendingDelete.item.currency
          )} · Paid by ${memberName(pendingDelete.item.paidById)}`,
          body: "This removes the expense from the ledger and recalculates every member balance. This cannot be undone.",
          action: "Delete expense",
        }
      : {
          title: "Delete settlement?",
          primary: `${memberName(pendingDelete.item.fromMemberId)} paid ${memberName(
            pendingDelete.item.toMemberId
          )}`,
          secondary: `${formatMoney(
            pendingDelete.item.amount,
            pendingDelete.item.currency
          )} · ${formatDate(pendingDelete.item.timestamp)}`,
          body: "This removes the settlement and restores the outstanding balance it had cleared. This cannot be undone.",
          action: "Delete settlement",
        }
    : null;

  if (!loading && !group) {
    return (
      <div>
        <AppHeader title="Group" showBack onBack={() => router.push("/dashboard")} />
        <main id="main-content" className="container py-10">
          <EmptyState
            icon={Receipt}
            title={error ? "Cannot load group" : "Group not found"}
            description={
              error ||
              "It may have been deleted, or you no longer have access."
            }
          />
        </main>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <AppHeader
        title={group?.name ?? "Group"}
        subtitle={group?.description || undefined}
        showBack
        onBack={() => router.push("/dashboard")}
        actions={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Invite member"
            onClick={() => setShowInvite(true)}
          >
            <UserPlus className="h-5 w-5" />
          </Button>
        }
      />

      <main id="main-content" className="container space-y-4 py-6">
        <Card className="money-card social-gradient surface-glow p-5 text-white">
          <div className="relative z-10">
            <p className="text-xs font-black uppercase opacity-85">
              Total group spend
            </p>
            <CurrencyTotals
              totals={totalsByCurrency}
              className="mt-2 text-3xl font-black tracking-tight"
              emptyLabel="$0.00"
            />
          </div>
        </Card>

        <Tabs defaultValue="ledger">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="ledger">Ledger</TabsTrigger>
            <TabsTrigger value="settle">Settle up</TabsTrigger>
            <TabsTrigger value="settlements">Settled</TabsTrigger>
          </TabsList>

          {/* LEDGER */}
          <TabsContent value="ledger" className="space-y-2">
            {expenses.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="No expenses logged"
                description="Use 'Add expense' below to start the group ledger."
              />
            ) : (
              expenses.map((e) => (
                <Card
                  key={e.id}
                  className="flex items-center gap-3 border-primary/10 p-3"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                    <Receipt className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{e.description}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Paid by {memberName(e.paidById)} · {e.splitType} ·{" "}
                      {formatDate(e.timestamp)}
                    </p>
                  </div>
                  <span className="font-black">
                    {formatMoney(e.amount, e.currency)}
                  </span>
                  <RowActions
                    label={e.description}
                    deleteLabel="Delete expense"
                    onDelete={() => setPendingDelete({ kind: "expense", item: e })}
                  />
                </Card>
              ))
            )}
          </TabsContent>

          {/* SETTLE UP */}
          <TabsContent value="settle" className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-black">Who owes whom</h2>
              <p className="text-sm text-muted-foreground">
                Review each member balance, then record the recommended payments
                that clear the group.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                Member balances
              </p>
              {balances.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="No balances yet"
                  description="Add an expense to see who paid and who owes."
                />
              ) : (
                balances.map((b) => {
                  const net = netBalance(b);
                  const isOwed = net > 0.01;
                  const settled = Math.abs(net) <= 0.01;
                  const totalVol = b.initialPaid + b.initialOwe;
                  const ratio =
                    totalVol > 0.1 ? (b.initialPaid / totalVol) * 100 : 0;
                  const symbol = currencySymbol(b.currency);
                  return (
                    <Card
                      key={`${b.member.id}-${b.currency}`}
                      className="flex items-center justify-between gap-3 border-primary/10 p-4"
                    >
                      <div className="min-w-0 space-y-1.5">
                        <p className="font-bold">
                          {labelForMember(b.member)}{" "}
                          <span className="text-xs font-medium text-muted-foreground">
                            ({b.currency})
                          </span>
                        </p>
                        <div className="flex flex-wrap gap-3 text-xs">
                          <span className="font-bold text-success">
                            Paid {symbol}
                            {b.initialPaid.toFixed(2)}
                          </span>
                          <span className="text-muted-foreground">
                            Share {symbol}
                            {b.initialOwe.toFixed(2)}
                          </span>
                        </div>
                        <Progress
                          value={Math.min(100, Math.max(0, ratio))}
                          className="h-1.5 w-32"
                          indicatorClassName={
                            isOwed ? "bg-success" : "bg-primary"
                          }
                        />
                      </div>
                      <Badge
                        variant={
                          settled ? "muted" : isOwed ? "success" : "destructive"
                        }
                      >
                        {settled
                          ? "Settled"
                          : isOwed
                            ? `gets ${symbol}${net.toFixed(2)}`
                            : `owes ${symbol}${Math.abs(net).toFixed(2)}`}
                      </Badge>
                    </Card>
                  );
                })
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                Recommended payments
              </p>
              {simplifiedDebts.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="All settled up"
                  description="Everyone is square. No payment is needed."
                />
              ) : (
                <>
                  <div className="flex items-start gap-2 rounded-2xl border border-primary/15 bg-primary/10 p-3 text-sm text-primary">
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
                    <p className="font-semibold">
                      These payments minimize the number of transfers needed to
                      clear the group.
                    </p>
                  </div>
                  {simplifiedDebts.map((d, i) => (
                    <Card key={i} className="space-y-3 border-primary/10 p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 rounded-2xl bg-destructive/10 px-3 py-2 text-center">
                          <p className="text-[10px] font-bold text-destructive">
                            PAYS
                          </p>
                          <p className="font-bold">{labelForMember(d.debtor)}</p>
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="font-black text-primary">
                            {formatMoney(d.amount, d.currency)}
                          </span>
                          <ArrowRight className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 rounded-2xl bg-success/15 px-3 py-2 text-center">
                          <p className="text-[10px] font-bold text-success">
                            RECEIVES
                          </p>
                          <p className="font-bold">
                            {labelForMember(d.creditor)}
                          </p>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button size="sm" onClick={() => setSettleDebt(d)}>
                          <CheckCircle2 className="h-4 w-4" />
                          Record payment
                        </Button>
                      </div>
                    </Card>
                  ))}
                </>
              )}
            </div>
          </TabsContent>

          {/* SETTLEMENTS */}
          <TabsContent value="settlements" className="space-y-2">
            {payments.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No settlements yet"
                description="Record payments from the Settle up tab to clear balances."
              />
            ) : (
              payments.map((p) => (
                <Card
                  key={p.id}
                  className="flex items-center gap-3 border-success/15 p-3"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-success/15 text-success">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">
                      {memberName(p.fromMemberId)} paid{" "}
                      {memberName(p.toMemberId)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(p.timestamp)}
                    </p>
                  </div>
                  <span className="font-black text-success">
                    {formatMoney(p.amount, p.currency)}
                  </span>
                  <RowActions
                    label={`${memberName(p.fromMemberId)} paid ${memberName(
                      p.toMemberId
                    )}`}
                    deleteLabel="Delete settlement"
                    onDelete={() => setPendingDelete({ kind: "payment", item: p })}
                  />
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-border/60 bg-background/85 p-4 shadow-[0_-18px_42px_-34px_hsl(var(--foreground)/0.45)] backdrop-blur-xl">
        <div className="container">
          <Button
            className="w-full"
            size="lg"
            onClick={() => router.push(`/groups/${groupId}/add-expense`)}
          >
            <Plus className="h-5 w-5" />
            Add expense
          </Button>
        </div>
      </div>

      <InviteMemberDialog
        group={group}
        open={showInvite}
        onOpenChange={setShowInvite}
      />
      <SettleGroupDialog
        groupId={groupId}
        debt={settleDebt}
        onClose={() => setSettleDebt(null)}
      />
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deleteSummary?.title}</DialogTitle>
          </DialogHeader>
          {deleteSummary && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-primary/10 bg-muted/50 px-3 py-2">
                <p className="font-bold">{deleteSummary.primary}</p>
                <p className="text-sm text-muted-foreground">
                  {deleteSummary.secondary}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {deleteSummary.body}
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
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : deleteSummary?.action ?? "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
