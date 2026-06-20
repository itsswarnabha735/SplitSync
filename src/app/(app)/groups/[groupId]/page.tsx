"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Edit3,
  Eye,
  Lightbulb,
  MoreVertical,
  Plus,
  Receipt,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react";

import type { DebtOverview, Expense, Payment } from "@/lib/models";
import { netBalance } from "@/lib/models";
import { currencySymbol, formatMoney } from "@/lib/currency";
import { getExpenseCategory } from "@/lib/expense-categories";
import { buildGroupCopilotContext } from "@/lib/settlement-copilot-context";
import {
  canDeleteGroupExpense,
  canDeleteGroupPayment,
  canEditGroupExpense,
  canEditGroupPayment,
} from "@/lib/edit-permissions";
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
import { SettlementCopilotButton } from "@/components/settlement-copilot";
import {
  EditExpenseDialog,
  EditPaymentDialog,
  ExpenseDetailDialog,
  GroupManageDialog,
  RequestStatusBadge,
  RecurringExpensesPanel,
  SettlementRequestDialog,
  matchingRequestForDebt,
  settlementRequestLabel,
} from "@/components/group-ledger-actions";

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
  editLabel,
  onView,
  onEdit,
  onDelete,
}: {
  label: string;
  deleteLabel: string;
  editLabel?: string;
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  if (!onView && !onEdit && !onDelete) return null;

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
        {onView && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              onView();
            }}
          >
            <Eye className="h-4 w-4" />
            View details
          </DropdownMenuItem>
        )}
        {onEdit && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              onEdit();
            }}
          >
            <Edit3 className="h-4 w-4" />
            {editLabel ?? "Edit"}
          </DropdownMenuItem>
        )}
        {onDelete && (
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
        )}
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
    settlementRequests,
    recurringExpenses,
    expenseComments,
    balances,
    simplifiedDebts,
    settlementError,
    totalsByCurrency,
    loading,
    error,
  } = useGroupDetail(groupId);

  const [showInvite, setShowInvite] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [settleDebt, setSettleDebt] = useState<DebtOverview | null>(null);
  const [requestDebt, setRequestDebt] = useState<DebtOverview | null>(null);
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
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

  const groupArchived = group?.status === "archived";
  const canEditExpenseRow = (expense: Expense) =>
    canEditGroupExpense({ group, members, expense, uid });
  const canEditPaymentRow = (payment: Payment) =>
    canEditGroupPayment({ group, members, payment, uid });
  const canDeleteExpenseRow = (expense: Expense) =>
    canDeleteGroupExpense({ group, members, expense, uid });
  const canDeletePaymentRow = (payment: Payment) =>
    canDeleteGroupPayment({ group, members, payment, uid });

  const activeSettlementRequests = useMemo(() => {
    return settlementRequests
      .filter(
        (request) =>
          request.status !== "dismissed" && request.status !== "settled"
      )
      .map((request) => {
        const debtor = members.find((member) => member.id === request.fromMemberId);
        const creditor = members.find((member) => member.id === request.toMemberId);
        if (!debtor || !creditor) return null;
        return {
          request,
          debt: {
            debtor,
            creditor,
            amount: request.amount,
            currency: request.currency,
          } satisfies DebtOverview,
        };
      })
      .filter(
        (entry): entry is { request: (typeof settlementRequests)[number]; debt: DebtOverview } =>
          Boolean(entry)
      );
  }, [members, settlementRequests]);

  const currentRequestForDebt = requestDebt
    ? matchingRequestForDebt(settlementRequests, requestDebt)
    : undefined;

  const originalCurrencyTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const expense of expenses) {
      if (!expense.originalAmount || !expense.originalCurrency) continue;
      totals[expense.originalCurrency] =
        (totals[expense.originalCurrency] ?? 0) + expense.originalAmount;
    }
    return totals;
  }, [expenses]);

  const groupCopilotContext = useMemo(
    () =>
      buildGroupCopilotContext({
        group,
        members,
        expenses,
        payments,
        balances,
        simplifiedDebts,
        settlementError,
        totalsByCurrency,
      }),
    [
      balances,
      expenses,
      group,
      members,
      payments,
      settlementError,
      simplifiedDebts,
      totalsByCurrency,
    ]
  );

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
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Invite member"
              onClick={() => setShowInvite(true)}
              disabled={groupArchived}
            >
              <UserPlus className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Manage group"
              onClick={() => setShowManage(true)}
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        }
      />

      <main id="main-content" className="container space-y-4 py-6">
        {groupArchived && (
          <div className="rounded-2xl border border-amber-300/60 bg-amber-50/90 px-4 py-3 text-sm font-semibold text-amber-950">
            This group is archived. Restore it from Manage group before adding
            new expenses or inviting members.
          </div>
        )}

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

        {group?.travelMode && Object.keys(originalCurrencyTotals).length > 0 && (
          <Card className="border-primary/10 p-4">
            <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
              Travel original-currency spend
            </p>
            <CurrencyTotals
              totals={originalCurrencyTotals}
              className="mt-2 text-2xl font-black"
            />
            <p className="mt-2 text-sm text-muted-foreground">
              Ledger balances still settle in{" "}
              {group.settlementCurrency ?? group.defaultCurrency ?? "the group currency"}.
            </p>
          </Card>
        )}

        <Tabs defaultValue="ledger">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="ledger">Ledger</TabsTrigger>
            <TabsTrigger value="settle">Settle up</TabsTrigger>
            <TabsTrigger value="settlements">Settled</TabsTrigger>
          </TabsList>

          {/* LEDGER */}
          <TabsContent value="ledger" className="space-y-2">
            <RecurringExpensesPanel
              group={group}
              members={members}
              recurringExpenses={recurringExpenses}
            />
            {expenses.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="No expenses logged"
                description="Use 'Add expense' below to start the group ledger."
              />
            ) : (
              expenses.map((e) => (
                (() => {
                const canEdit = canEditExpenseRow(e);
                const canDelete = canDeleteExpenseRow(e);
                return (
                    <Card
                      key={e.id}
                      className="flex items-center gap-3 border-primary/10 p-3"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                        <Receipt className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate font-bold">{e.description}</p>
                          {e.category && (
                            <CategoryBadge categorySlug={e.category} />
                          )}
                          {e.disputeStatus === "needs_clarification" && (
                            <Badge variant="destructive">Clarify</Badge>
                          )}
                        </div>
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
                        editLabel="Edit expense"
                        onView={() => setDetailExpense(e)}
                        onEdit={canEdit ? () => setEditingExpense(e) : undefined}
                        onDelete={
                          canDelete
                            ? () => setPendingDelete({ kind: "expense", item: e })
                            : undefined
                        }
                      />
                    </Card>
                  );
                })()
              ))
            )}
          </TabsContent>

          {/* SETTLE UP */}
          <TabsContent value="settle" className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <h2 className="text-base font-black">Who owes whom</h2>
                <p className="text-sm text-muted-foreground">
                  Review each member balance, then record the recommended payments
                  that clear the group.
                </p>
              </div>
              <SettlementCopilotButton
                contextType="group"
                context={groupCopilotContext}
                prompt="Explain recommended payments"
                buttonVariant="outline"
              />
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

            {activeSettlementRequests.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                  Settlement requests
                </p>
                {activeSettlementRequests.map(({ request, debt }) => (
                  <Card
                    key={request.id}
                    className="flex flex-col gap-3 border-primary/10 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold">
                          {labelForMember(debt.debtor)} pays{" "}
                          {labelForMember(debt.creditor)}
                        </p>
                        <Badge variant="outline">
                          {settlementRequestLabel(request)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatMoney(request.amount, request.currency)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRequestDebt(debt)}
                    >
                      <Lightbulb className="h-4 w-4" />
                      Update request
                    </Button>
                  </Card>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                Recommended payments
              </p>
              {settlementError ? (
                <div
                  className="flex items-start gap-2 rounded-2xl border border-destructive/15 bg-destructive/10 p-3 text-sm font-semibold text-destructive"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{settlementError}</p>
                </div>
              ) : simplifiedDebts.length === 0 ? (
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
                      Record these payments to clear the group.
                    </p>
                  </div>
                  {simplifiedDebts.map((d, i) => (
                    <Card key={i} className="space-y-3 border-primary/10 p-4">
                      <div className="flex justify-end">
                        <RequestStatusBadge
                          request={matchingRequestForDebt(settlementRequests, d)}
                        />
                      </div>
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
                      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRequestDebt(d)}
                        >
                          <Lightbulb className="h-4 w-4" />
                          {matchingRequestForDebt(settlementRequests, d)
                            ? "Update request"
                            : "Request payment"}
                        </Button>
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
                (() => {
                const canEdit = canEditPaymentRow(p);
                const canDelete = canDeletePaymentRow(p);
                return (
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
                        editLabel="Edit settlement"
                        onEdit={canEdit ? () => setEditingPayment(p) : undefined}
                        onDelete={
                          canDelete
                            ? () => setPendingDelete({ kind: "payment", item: p })
                            : undefined
                        }
                      />
                    </Card>
                  );
                })()
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
            disabled={groupArchived}
          >
            <Plus className="h-5 w-5" />
            {groupArchived ? "Group archived" : "Add expense"}
          </Button>
        </div>
      </div>

      <InviteMemberDialog
        group={group}
        open={showInvite}
        onOpenChange={setShowInvite}
      />
      <GroupManageDialog
        group={group}
        members={members}
        open={showManage}
        onOpenChange={setShowManage}
      />
      <ExpenseDetailDialog
        expense={detailExpense}
        members={members}
        comments={expenseComments}
        open={!!detailExpense}
        canEdit={detailExpense ? canEditExpenseRow(detailExpense) : false}
        canDelete={detailExpense ? canDeleteExpenseRow(detailExpense) : false}
        onOpenChange={(open) => {
          if (!open) setDetailExpense(null);
        }}
        onEdit={(expense) => {
          setDetailExpense(null);
          setEditingExpense(expense);
        }}
        onDelete={(expense) => {
          setDetailExpense(null);
          setPendingDelete({ kind: "expense", item: expense });
        }}
      />
      <EditExpenseDialog
        expense={editingExpense}
        members={members}
        open={!!editingExpense}
        onOpenChange={(open) => {
          if (!open) setEditingExpense(null);
        }}
      />
      <EditPaymentDialog
        payment={editingPayment}
        members={members}
        open={!!editingPayment}
        onOpenChange={(open) => {
          if (!open) setEditingPayment(null);
        }}
      />
      <SettlementRequestDialog
        group={group}
        members={members}
        debt={requestDebt}
        existingRequest={currentRequestForDebt}
        open={!!requestDebt}
        onOpenChange={(open) => {
          if (!open) setRequestDebt(null);
        }}
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

function CategoryBadge({ categorySlug }: { categorySlug: string }) {
  const category = getExpenseCategory(categorySlug);
  if (!category) return null;
  return (
    <span
      className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase"
      style={{
        borderColor: `${category.color}55`,
        color: category.color,
        backgroundColor: `${category.color}14`,
      }}
    >
      {category.name}
    </span>
  );
}
