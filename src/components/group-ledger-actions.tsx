"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Bell,
  CheckCircle2,
  Clipboard,
  CreditCard,
  Edit3,
  History,
  Loader2,
  MessageSquare,
  Repeat,
  RotateCcw,
  Save,
} from "lucide-react";

import type {
  DebtOverview,
  Expense,
  ExpenseComment,
  Group,
  GroupMember,
  GroupTemplate,
  PaymentMethod,
  Payment,
  RecurringExpense,
  RecurringFrequency,
  SettlementRequest,
  SettlementRequestStatus,
} from "@/lib/models";
import type { DraftSplitMethod } from "@/lib/splits";
import { buildSplitsForMethod } from "@/lib/splits";
import { EXPENSE_CATEGORIES, getExpenseCategory } from "@/lib/expense-categories";
import type { ExpenseCategorySlug } from "@/lib/expense-categories";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { dateInputToLocalTimestamp, toDateInputValue } from "@/lib/dates";
import { GROUP_TEMPLATE_OPTIONS } from "@/lib/group-templates";
import {
  canDeleteRecurringExpense,
  canDeleteSettlementRequest,
  canEditRecurringExpense,
} from "@/lib/edit-permissions";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { SplitEditor, type SplitState } from "@/components/split-editor";
import { SplitTypeToggle } from "@/components/dialogs/add-adhoc-expense-dialog";

function formatDate(ts: number | undefined): string {
  if (!ts) return "Not recorded";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function memberName(members: GroupMember[], memberId: string): string {
  return members.find((member) => member.id === memberId)?.name ?? "Unknown";
}

function splitStateFromExpense(
  members: GroupMember[],
  expense: Expense | null
): SplitState {
  return {
    equalSelections: Object.fromEntries(
      members.map((member) => [member.id, expense ? (expense.splits[member.id] ?? 0) > 0 : true])
    ),
    exactInputs: expense
      ? Object.fromEntries(
          Object.entries(expense.splits).map(([memberId, amount]) => [
            memberId,
            amount.toFixed(2),
          ])
        )
      : {},
    shareInputs: {},
    percentInputs: {},
    adjustmentInputs: {},
  };
}

function parseInputs(inputs: Record<string, string> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(inputs ?? {})) {
    const value = Number(raw);
    if (!Number.isNaN(value)) out[id] = value;
  }
  return out;
}

function requestTone(status: SettlementRequestStatus | undefined): {
  label: string;
  variant: "outline" | "success" | "muted" | "destructive";
} {
  if (status === "settled") return { label: "Settled", variant: "success" };
  if (status === "dismissed") return { label: "Dismissed", variant: "muted" };
  if (status === "reminded") return { label: "Reminder queued", variant: "outline" };
  return { label: "Requested", variant: "outline" };
}

const RECURRING_FREQUENCIES: Array<{
  value: RecurringFrequency;
  label: string;
}> = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "upi", label: "UPI" },
  { value: "bank", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

export function ExpenseDetailDialog({
  expense,
  members,
  comments,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = canEdit,
}: {
  expense: Expense | null;
  members: GroupMember[];
  comments: ExpenseComment[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const { displayName } = useAuth();
  const [commentBody, setCommentBody] = useState("");
  const [disputeNote, setDisputeNote] = useState("");
  const [savingDiscussion, setSavingDiscussion] = useState(false);
  const [discussionError, setDiscussionError] = useState<string | null>(null);
  const category = expense?.category ? getExpenseCategory(expense.category) : null;
  const expenseComments = expense
    ? comments.filter((comment) => comment.expenseId === expense.id)
    : [];
  const shares = expense
    ? Object.entries(expense.splits).map(([memberId, amount]) => ({
        memberId,
        name: memberName(members, memberId),
        amount,
      }))
    : [];

  useEffect(() => {
    if (!open) return;
    setCommentBody("");
    setDisputeNote(expense?.disputeNote ?? "");
    setDiscussionError(null);
  }, [expense?.disputeNote, open]);

  async function addComment() {
    if (!repo || !expense || !commentBody.trim()) return;
    setSavingDiscussion(true);
    setDiscussionError(null);
    try {
      await runSyncing(
        () =>
          repo.addExpenseComment({
            groupId: expense.groupId,
            expenseId: expense.id,
            body: commentBody,
            createdByName: displayName,
          }),
        {
          loading: "Adding comment...",
          success: "Comment added.",
          error: "Could not add comment.",
        }
      );
      setCommentBody("");
    } catch (err) {
      setDiscussionError(
        err instanceof Error ? err.message : "Could not add comment."
      );
    } finally {
      setSavingDiscussion(false);
    }
  }

  async function setDispute(status: "needs_clarification" | "resolved") {
    if (!repo || !expense) return;
    setSavingDiscussion(true);
    setDiscussionError(null);
    try {
      await runSyncing(
        () =>
          repo.updateExpenseDispute(expense.groupId, expense.id, {
            disputeStatus: status,
            disputeNote,
          }),
        {
          loading:
            status === "resolved" ? "Resolving expense..." : "Flagging expense...",
          success:
            status === "resolved" ? "Expense resolved." : "Clarification flagged.",
          error: "Could not update clarification state.",
        }
      );
    } catch (err) {
      setDiscussionError(
        err instanceof Error ? err.message : "Could not update clarification state."
      );
    } finally {
      setSavingDiscussion(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Expense details</DialogTitle>
        </DialogHeader>
        {expense && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-primary/10 bg-muted/40 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-black">{expense.description}</p>
                  <p className="text-sm text-muted-foreground">
                    Paid by {memberName(members, expense.paidById)} on{" "}
                    {formatDate(expense.timestamp)}
                  </p>
                </div>
                <p className="text-xl font-black">
                  {formatMoney(expense.amount, expense.currency)}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">{expense.splitType}</Badge>
                {expense.disputeStatus === "needs_clarification" && (
                  <Badge variant="destructive">Needs clarification</Badge>
                )}
                {expense.disputeStatus === "resolved" && (
                  <Badge variant="success">Resolved</Badge>
                )}
                {category && (
                  <span
                    className="rounded-full border px-2 py-0.5 text-xs font-black"
                    style={{
                      borderColor: `${category.color}55`,
                      color: category.color,
                      backgroundColor: `${category.color}14`,
                    }}
                  >
                    {category.name}
                  </span>
                )}
                {expense.sourceType && (
                  <Badge variant="muted">{expense.sourceType}</Badge>
                )}
              </div>
            </div>

            <section className="space-y-2">
              <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                Member shares
              </p>
              {shares.map((share) => (
                <div
                  key={share.memberId}
                  className="flex items-center justify-between rounded-2xl border border-border/70 px-3 py-2 text-sm"
                >
                  <span className="font-semibold">{share.name}</span>
                  <span className="font-bold">
                    {formatMoney(share.amount, expense.currency)}
                  </span>
                </div>
              ))}
            </section>

            {(expense.originalAmount || expense.fxNote) && (
              <section className="space-y-2">
                <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                  Travel and FX
                </p>
                <div className="rounded-2xl border border-border/70 bg-card/80 p-3 text-sm">
                  {expense.originalAmount && expense.originalCurrency && (
                    <p className="font-semibold">
                      Original amount{" "}
                      {formatMoney(expense.originalAmount, expense.originalCurrency)}
                    </p>
                  )}
                  {expense.exchangeRate && (
                    <p className="text-muted-foreground">
                      FX rate {expense.exchangeRate.toFixed(4)} to{" "}
                      {expense.currency}
                    </p>
                  )}
                  {expense.fxNote && (
                    <p className="mt-1 text-muted-foreground">{expense.fxNote}</p>
                  )}
                </div>
              </section>
            )}

            {(expense.notes ||
              expense.sourceWarnings?.length ||
              expense.editCount ||
              expense.sourceConfidence !== undefined ||
              expense.parserConfidence !== undefined) && (
              <section className="space-y-2">
                <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                  Audit trail
                </p>
                <div className="space-y-2 rounded-2xl border border-border/70 bg-card/80 p-3 text-sm">
                  {expense.notes && <p>{expense.notes}</p>}
                  {expense.sourceConfidence !== undefined && (
                    <p className="text-muted-foreground">
                      Source confidence {Math.round(expense.sourceConfidence * 100)}%
                    </p>
                  )}
                  {expense.parserConfidence !== undefined && (
                    <p className="text-muted-foreground">
                      Parser confidence {Math.round(expense.parserConfidence * 100)}%
                    </p>
                  )}
                  {expense.sourceWarnings?.map((warning) => (
                    <p key={warning} className="font-semibold text-amber-700">
                      {warning}
                    </p>
                  ))}
                  <p className="flex items-center gap-1 text-muted-foreground">
                    <History className="h-4 w-4" />
                    {expense.editCount ? `${expense.editCount} edit(s)` : "No edits"} ·
                    Updated {formatDate(expense.updatedAt ?? expense.createdAt)}
                  </p>
                </div>
              </section>
            )}

            <section className="space-y-2">
              <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                Comments and clarification
              </p>
              <div className="space-y-2">
                {expenseComments.length === 0 ? (
                  <div className="rounded-2xl border border-border/70 px-3 py-4 text-center text-sm text-muted-foreground">
                    No comments yet.
                  </div>
                ) : (
                  expenseComments.map((comment) => (
                    <div
                      key={comment.id}
                      className="rounded-2xl border border-border/70 bg-card/80 px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-bold">{comment.createdByName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(comment.createdAt)}
                        </p>
                      </div>
                      <p className="mt-1 text-muted-foreground">{comment.body}</p>
                    </div>
                  ))
                )}
              </div>
              <textarea
                className="min-h-20 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={commentBody}
                onChange={(event) => setCommentBody(event.target.value)}
                placeholder="Ask a question or add context"
              />
              <textarea
                className="min-h-16 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={disputeNote}
                onChange={(event) => setDisputeNote(event.target.value)}
                placeholder="Clarification note"
              />
              {discussionError && (
                <p className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                  {discussionError}
                </p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={addComment}
                  disabled={savingDiscussion || !commentBody.trim()}
                >
                  <MessageSquare className="h-4 w-4" />
                  Add comment
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setDispute("needs_clarification")}
                  disabled={savingDiscussion}
                >
                  Needs clarification
                </Button>
                <Button
                  onClick={() => setDispute("resolved")}
                  disabled={savingDiscussion}
                >
                  Resolve
                </Button>
              </div>
            </section>
          </div>
        )}
        <DialogFooter>
          {expense && (canEdit || canDelete) && (
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {canDelete && (
                <Button variant="ghost" onClick={() => onDelete(expense)}>
                  Delete
                </Button>
              )}
              {canEdit && (
              <Button onClick={() => onEdit(expense)}>
                <Edit3 className="h-4 w-4" />
                Edit expense
              </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditExpenseDialog({
  expense,
  members,
  open,
  onOpenChange,
}: {
  expense: Expense | null;
  members: GroupMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const [description, setDescription] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [paidById, setPaidById] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [dateStr, setDateStr] = useState(() => toDateInputValue());
  const [category, setCategory] = useState<ExpenseCategorySlug>("other");
  const [notes, setNotes] = useState("");
  const [originalAmountStr, setOriginalAmountStr] = useState("");
  const [originalCurrency, setOriginalCurrency] = useState("USD");
  const [exchangeRateStr, setExchangeRateStr] = useState("");
  const [fxNote, setFxNote] = useState("");
  const [splitType, setSplitType] = useState<DraftSplitMethod>("EQUAL");
  const [split, setSplit] = useState<SplitState>(() =>
    splitStateFromExpense(members, expense)
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!expense) return;
    setDescription(expense.description);
    setAmountStr(String(expense.amount));
    setPaidById(expense.paidById);
    setCurrency(expense.currency);
    setDateStr(toDateInputValue(new Date(expense.timestamp)));
    setCategory(expense.category ?? "other");
    setNotes(expense.notes ?? "");
    setOriginalAmountStr(
      expense.originalAmount ? String(expense.originalAmount) : ""
    );
    setOriginalCurrency(expense.originalCurrency ?? expense.currency);
    setExchangeRateStr(expense.exchangeRate ? String(expense.exchangeRate) : "");
    setFxNote(expense.fxNote ?? "");
    setSplitType(expense.splitType);
    setSplit(splitStateFromExpense(members, expense));
    setError(null);
  }, [expense, members]);

  async function handleSave() {
    if (!repo || !expense) return;
    const amount = Number(amountStr);
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    if (!amount || amount <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    if (!paidById) {
      setError("Choose who paid.");
      return;
    }

    const result = buildSplitsForMethod({
      splitMethod: splitType,
      amount,
      equalParticipantIds: members
        .filter((member) => split.equalSelections[member.id] ?? true)
        .map((member) => member.id),
      exactDistribution: parseInputs(split.exactInputs),
      shareDistribution: parseInputs(split.shareInputs),
      percentDistribution: parseInputs(split.percentInputs),
      adjustmentDistribution: parseInputs(split.adjustmentInputs),
      participantLabel: "member",
      currency,
    });
    if (!result.ok) {
      setError(result.error ?? "Fix the split before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await runSyncing(
        () =>
          repo.updateExpense(expense.groupId, expense.id, {
            description,
            amount,
            paidById,
            splitType: result.persistedSplitType,
            splits: result.splits,
            timestamp: dateInputToLocalTimestamp(dateStr) ?? expense.timestamp,
            currency,
            category,
            notes,
            originalAmount: originalAmountStr
              ? Number(originalAmountStr)
              : undefined,
            originalCurrency: originalAmountStr ? originalCurrency : undefined,
            exchangeRate: exchangeRateStr ? Number(exchangeRateStr) : undefined,
            fxNote,
          }),
        {
          loading: "Updating expense...",
          success: "Expense updated.",
          error: "Could not update expense.",
        }
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update expense.");
    } finally {
      setSaving(false);
    }
  }

  const amount = Number(amountStr) || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit expense</DialogTitle>
        </DialogHeader>
        {expense && (
          <div className="space-y-4">
            {error && (
              <p className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                {error}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-expense-description">Description</Label>
                <Input
                  id="edit-expense-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-expense-amount">Amount</Label>
                <Input
                  id="edit-expense-amount"
                  inputMode="decimal"
                  value={amountStr}
                  onChange={(event) => setAmountStr(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-expense-paid-by">Paid by</Label>
                <NativeSelect
                  id="edit-expense-paid-by"
                  value={paidById}
                  onChange={(event) => setPaidById(event.target.value)}
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-expense-date">Date</Label>
                <Input
                  id="edit-expense-date"
                  type="date"
                  value={dateStr}
                  onChange={(event) => setDateStr(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-expense-currency">Currency</Label>
                <NativeSelect
                  id="edit-expense-currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  {SUPPORTED_CURRENCIES.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-expense-category">Category</Label>
                <NativeSelect
                  id="edit-expense-category"
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as ExpenseCategorySlug)
                  }
                >
                  {EXPENSE_CATEGORIES.map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-expense-notes">Notes</Label>
                <textarea
                  id="edit-expense-notes"
                  className="min-h-20 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add context for future reviewers"
                />
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-primary/10 bg-primary/5 p-3">
              <p className="text-xs font-black uppercase tracking-wide text-primary">
                Travel and FX
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-expense-original-amount">
                    Original amount
                  </Label>
                  <Input
                    id="edit-expense-original-amount"
                    inputMode="decimal"
                    value={originalAmountStr}
                    onChange={(event) => setOriginalAmountStr(event.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-expense-original-currency">
                    Original currency
                  </Label>
                  <NativeSelect
                    id="edit-expense-original-currency"
                    value={originalCurrency}
                    onChange={(event) => setOriginalCurrency(event.target.value)}
                  >
                    {SUPPORTED_CURRENCIES.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-expense-fx-rate">FX rate</Label>
                  <Input
                    id="edit-expense-fx-rate"
                    inputMode="decimal"
                    value={exchangeRateStr}
                    onChange={(event) => setExchangeRateStr(event.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <textarea
                className="min-h-16 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={fxNote}
                onChange={(event) => setFxNote(event.target.value)}
                placeholder="FX source or note"
              />
            </div>

            <SplitTypeToggle value={splitType} advanced onChange={setSplitType} />
            <SplitEditor
              participants={members.map((member) => ({
                id: member.id,
                name: member.name,
              }))}
              amount={amount}
              currency={currency}
              splitType={splitType}
              value={split}
              onChange={setSplit}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditPaymentDialog({
  payment,
  members,
  open,
  onOpenChange,
}: {
  payment: Payment | null;
  members: GroupMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const [fromMemberId, setFromMemberId] = useState("");
  const [toMemberId, setToMemberId] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [dateStr, setDateStr] = useState(() => toDateInputValue());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!payment) return;
    setFromMemberId(payment.fromMemberId);
    setToMemberId(payment.toMemberId);
    setAmountStr(String(payment.amount));
    setCurrency(payment.currency);
    setDateStr(toDateInputValue(new Date(payment.timestamp)));
    setError(null);
  }, [payment]);

  async function handleSave() {
    if (!repo || !payment) return;
    const amount = Number(amountStr);
    if (!fromMemberId || !toMemberId || fromMemberId === toMemberId) {
      setError("Choose two different members.");
      return;
    }
    if (!amount || amount <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await runSyncing(
        () =>
          repo.updatePayment(payment.groupId, payment.id, {
            fromMemberId,
            toMemberId,
            amount,
            currency,
            timestamp: dateInputToLocalTimestamp(dateStr) ?? payment.timestamp,
          }),
        {
          loading: "Updating settlement...",
          success: "Settlement updated.",
          error: "Could not update settlement.",
        }
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update settlement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit settlement</DialogTitle>
        </DialogHeader>
        {payment && (
          <div className="space-y-4">
            {error && (
              <p className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                {error}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-payment-from">From</Label>
                <NativeSelect
                  id="edit-payment-from"
                  value={fromMemberId}
                  onChange={(event) => setFromMemberId(event.target.value)}
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-payment-to">To</Label>
                <NativeSelect
                  id="edit-payment-to"
                  value={toMemberId}
                  onChange={(event) => setToMemberId(event.target.value)}
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-payment-amount">Amount</Label>
                <Input
                  id="edit-payment-amount"
                  inputMode="decimal"
                  value={amountStr}
                  onChange={(event) => setAmountStr(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-payment-currency">Currency</Label>
                <NativeSelect
                  id="edit-payment-currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  {SUPPORTED_CURRENCIES.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-payment-date">Date</Label>
                <Input
                  id="edit-payment-date"
                  type="date"
                  value={dateStr}
                  onChange={(event) => setDateStr(event.target.value)}
                />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SettlementRequestDialog({
  group,
  members,
  debt,
  existingRequest,
  open,
  onOpenChange,
}: {
  group: Group | null;
  members: GroupMember[];
  debt: DebtOverview | null;
  existingRequest?: SettlementRequest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultMessage = useMemo(() => {
    if (!group || !debt) return "";
    const paymentDetails = [
      debt.creditor.preferredPaymentMethod
        ? `Payment method: ${debt.creditor.preferredPaymentMethod}`
        : "",
      debt.creditor.paymentHandle ? `Handle: ${debt.creditor.paymentHandle}` : "",
      debt.creditor.paymentLink ? `Link: ${debt.creditor.paymentLink}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return `Hi ${debt.debtor.name}, SplitSync shows ${formatMoney(
      debt.amount,
      debt.currency
    )} due to ${debt.creditor.name} in ${group.name}. Please settle when convenient.${
      paymentDetails ? ` ${paymentDetails}.` : ""
    }`;
  }, [debt, group]);

  useEffect(() => {
    if (!open) return;
    setMessage(existingRequest?.message || defaultMessage);
    setCopied(false);
    setError(null);
  }, [defaultMessage, existingRequest?.message, open]);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy the request text.");
    }
  }

  async function save(status: SettlementRequestStatus) {
    if (!repo || !group || !debt) return;
    setSaving(true);
    setError(null);
    try {
      await runSyncing(
        async () => {
          if (existingRequest) {
            await repo.updateSettlementRequest(group.id, existingRequest.id, {
              status,
              message,
              lastRemindedAt: status === "reminded" ? Date.now() : undefined,
              remindAfter:
                status === "reminded" ? Date.now() + 24 * 60 * 60 * 1000 : undefined,
            });
          } else {
            const id = await repo.createSettlementRequest({
              groupId: group.id,
              fromMemberId: debt.debtor.id,
              toMemberId: debt.creditor.id,
              amount: debt.amount,
              currency: debt.currency,
              message,
              remindAfter:
                status === "reminded" ? Date.now() + 24 * 60 * 60 * 1000 : undefined,
            });
            if (status !== "requested") {
              await repo.updateSettlementRequest(group.id, id, {
                status,
                lastRemindedAt: status === "reminded" ? Date.now() : undefined,
              });
            }
          }
        },
        {
          loading: "Saving request...",
          success: status === "reminded" ? "Reminder queued." : "Request saved.",
          error: "Could not save request.",
        }
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save request.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRequest() {
    if (!repo || !group || !existingRequest) return;
    if (!window.confirm("Delete this settlement request? This cannot be undone.")) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await runSyncing(
        () => repo.deleteSettlementRequest(group.id, existingRequest.id),
        {
          loading: "Deleting request...",
          success: "Settlement request deleted.",
          error: "Could not delete request.",
        }
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete request.");
    } finally {
      setSaving(false);
    }
  }

  const tone = requestTone(existingRequest?.status);
  const canDelete = existingRequest
    ? canDeleteSettlementRequest({
      group,
      members,
      request: existingRequest,
      uid: user?.uid,
    })
    : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settlement request</DialogTitle>
        </DialogHeader>
        {group && debt && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-primary/10 bg-primary/5 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">
                  {debt.debtor.name} pays {debt.creditor.name}
                </p>
                {existingRequest && (
                  <Badge variant={tone.variant}>{tone.label}</Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatMoney(debt.amount, debt.currency)} · {group.name}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settlement-request-message">Request note</Label>
              <textarea
                id="settlement-request-message"
                className="min-h-28 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>
            {error && (
              <p className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={copyMessage} disabled={!message.trim()}>
            <Clipboard className="h-4 w-4" />
            {copied ? "Copied" : "Copy note"}
          </Button>
          {existingRequest && (
            <>
              <Button
                variant="ghost"
                onClick={() => save("dismissed")}
                disabled={saving}
              >
                Dismiss
              </Button>
              {canDelete && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={deleteRequest}
                  disabled={saving}
                >
                  Delete
                </Button>
              )}
            </>
          )}
          <Button variant="outline" onClick={() => save("reminded")} disabled={saving}>
            <Bell className="h-4 w-4" />
            Remind tomorrow
          </Button>
          <Button onClick={() => save("requested")} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Mark requested
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GroupManageDialog({
  group,
  members,
  open,
  onOpenChange,
}: {
  group: Group | null;
  members: GroupMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<GroupTemplate>("custom");
  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [settlementCurrency, setSettlementCurrency] = useState("USD");
  const [travelMode, setTravelMode] = useState(false);
  const [tripStart, setTripStart] = useState("");
  const [tripEnd, setTripEnd] = useState("");
  const [paymentMemberId, setPaymentMemberId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("upi");
  const [paymentHandle, setPaymentHandle] = useState("");
  const [paymentLink, setPaymentLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEditAllMembers = group?.createdBy === user?.uid;
  const editableMembers = useMemo(
    () =>
      members.filter(
        (member) => canEditAllMembers || member.linkedUid === user?.uid
      ),
    [canEditAllMembers, members, user?.uid]
  );

  useEffect(() => {
    if (!group) return;
    setName(group.name);
    setDescription(group.description);
    setTemplate(group.template ?? "custom");
    setDefaultCurrency(group.defaultCurrency ?? "USD");
    setSettlementCurrency(group.settlementCurrency ?? group.defaultCurrency ?? "USD");
    setTravelMode(group.travelMode === true);
    setTripStart(group.tripStartAt ? toDateInputValue(new Date(group.tripStartAt)) : "");
    setTripEnd(group.tripEndAt ? toDateInputValue(new Date(group.tripEndAt)) : "");
    setError(null);
  }, [group]);

  useEffect(() => {
    const selected =
      editableMembers.find((member) => member.id === paymentMemberId) ??
      editableMembers[0];
    if (!selected) return;
    setPaymentMemberId(selected.id);
    setPaymentMethod(selected.preferredPaymentMethod ?? "upi");
    setPaymentHandle(selected.paymentHandle ?? "");
    setPaymentLink(selected.paymentLink ?? "");
  }, [editableMembers, paymentMemberId]);

  async function saveProfile() {
    if (!repo || !group) return;
    if (!name.trim()) {
      setError("Group name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await runSyncing(
        () =>
          repo.updateGroupProfile(group, {
            name,
            description,
            template,
            defaultCurrency,
            settlementCurrency,
            travelMode,
            tripStartAt:
              travelMode && tripStart
                ? dateInputToLocalTimestamp(tripStart) ?? undefined
                : undefined,
            tripEndAt:
              travelMode && tripEnd
                ? dateInputToLocalTimestamp(tripEnd) ?? undefined
                : undefined,
          }),
        {
          loading: "Updating group...",
          success: "Group updated.",
          error: "Could not update group.",
        }
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update group.");
    } finally {
      setSaving(false);
    }
  }

  async function savePaymentProfile() {
    if (!repo || !group || !paymentMemberId) return;
    setSaving(true);
    setError(null);
    try {
      await runSyncing(
        () =>
          repo.updateMemberPaymentProfile(group.id, paymentMemberId, {
            preferredPaymentMethod: paymentMethod,
            paymentHandle,
            paymentLink,
          }),
        {
          loading: "Updating payment details...",
          success: "Payment details updated.",
          error: "Could not update payment details.",
        }
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update payment details."
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive() {
    if (!repo || !group) return;
    const archived = group.status === "archived";
    setSaving(true);
    setError(null);
    try {
      await runSyncing(
        () => repo.setGroupArchived(group, !archived),
        {
          loading: archived ? "Restoring group..." : "Archiving group...",
          success: archived ? "Group restored." : "Group archived.",
          error: archived ? "Could not restore group." : "Could not archive group.",
        }
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update group.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage group</DialogTitle>
        </DialogHeader>
        {group && (
          <div className="space-y-4">
            {error && (
              <p className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                {error}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="manage-group-name">Group name</Label>
              <Input
                id="manage-group-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manage-group-description">Description</Label>
              <Input
                id="manage-group-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="manage-group-template">Template</Label>
                <NativeSelect
                  id="manage-group-template"
                  value={template}
                  onChange={(event) => setTemplate(event.target.value as GroupTemplate)}
                >
                  {GROUP_TEMPLATE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <label className="flex items-center gap-3 rounded-2xl border border-primary/10 px-3 py-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={travelMode}
                  onChange={(event) => setTravelMode(event.target.checked)}
                />
                <span>
                  <span className="block text-sm font-bold">Travel mode</span>
                  <span className="block text-xs text-muted-foreground">
                    Add FX notes and enable Trip Capture Mode for Transaction Radar.
                  </span>
                </span>
              </label>
              {travelMode && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="manage-trip-start">Trip starts</Label>
                    <Input
                      id="manage-trip-start"
                      type="date"
                      value={tripStart}
                      onChange={(event) => setTripStart(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="manage-trip-end">Trip ends</Label>
                    <Input
                      id="manage-trip-end"
                      type="date"
                      value={tripEnd}
                      onChange={(event) => setTripEnd(event.target.value)}
                    />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="manage-group-default-currency">
                  Default currency
                </Label>
                <NativeSelect
                  id="manage-group-default-currency"
                  value={defaultCurrency}
                  onChange={(event) => setDefaultCurrency(event.target.value)}
                >
                  {SUPPORTED_CURRENCIES.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manage-group-settlement-currency">
                  Settlement currency
                </Label>
                <NativeSelect
                  id="manage-group-settlement-currency"
                  value={settlementCurrency}
                  onChange={(event) => setSettlementCurrency(event.target.value)}
                >
                  {SUPPORTED_CURRENCIES.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {editableMembers.length > 0 && (
              <Card className="space-y-3 border-primary/10 p-3">
                <div className="flex items-start gap-3">
                  <CreditCard className="mt-0.5 h-4 w-4 text-primary" />
                  <div>
                    <p className="font-bold">Payment details</p>
                    <p className="text-sm text-muted-foreground">
                      Add UPI, bank, cash, or link details for settlement notes.
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="manage-payment-member">Member</Label>
                    <NativeSelect
                      id="manage-payment-member"
                      value={paymentMemberId}
                      onChange={(event) => setPaymentMemberId(event.target.value)}
                    >
                      {editableMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="manage-payment-method">Method</Label>
                    <NativeSelect
                      id="manage-payment-method"
                      value={paymentMethod}
                      onChange={(event) =>
                        setPaymentMethod(event.target.value as PaymentMethod)
                      }
                    >
                      {PAYMENT_METHODS.map((method) => (
                        <option key={method.value} value={method.value}>
                          {method.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="manage-payment-handle">Handle</Label>
                    <Input
                      id="manage-payment-handle"
                      value={paymentHandle}
                      onChange={(event) => setPaymentHandle(event.target.value)}
                      placeholder="name@upi, account note, or cash"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="manage-payment-link">Payment link</Label>
                    <Input
                      id="manage-payment-link"
                      value={paymentLink}
                      onChange={(event) => setPaymentLink(event.target.value)}
                      placeholder="upi:// or https://"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={savePaymentProfile}
                    disabled={saving || !paymentMemberId}
                  >
                    Save payment details
                  </Button>
                </div>
              </Card>
            )}
            <Card
              className={cn(
                "border-primary/10 p-3",
                group.status === "archived" && "border-amber-300/60 bg-amber-50/80"
              )}
            >
              <div className="flex items-start gap-3">
                <Archive className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-bold">
                    {group.status === "archived" ? "Archived group" : "Active group"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Archived groups stay readable but are visually separated on the dashboard.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="outline" onClick={toggleArchive} disabled={saving}>
            {group?.status === "archived" ? (
              <RotateCcw className="h-4 w-4" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            {group?.status === "archived" ? "Restore" : "Archive"}
          </Button>
          <Button onClick={saveProfile} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RecurringExpensesPanel({
  group,
  members,
  recurringExpenses,
}: {
  group: Group | null;
  members: GroupMember[];
  recurringExpenses: RecurringExpense[];
}) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [editingRecurring, setEditingRecurring] =
    useState<RecurringExpense | null>(null);
  const [description, setDescription] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [paidById, setPaidById] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [category, setCategory] = useState<ExpenseCategorySlug>("housing");
  const [frequency, setFrequency] = useState<RecurringFrequency>("monthly");
  const [nextDueDate, setNextDueDate] = useState(() => toDateInputValue());
  const [splitType, setSplitType] = useState<DraftSplitMethod>("EQUAL");
  const [split, setSplit] = useState<SplitState>(() => splitStateFromExpense(members, null));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const amount = Number(amountStr) || 0;

  useEffect(() => {
    if (!open) return;
    if (editingRecurring) {
      setDescription(editingRecurring.description);
      setAmountStr(String(editingRecurring.amount));
      setPaidById(editingRecurring.paidById);
      setCurrency(editingRecurring.currency);
      setCategory(editingRecurring.category ?? "housing");
      setFrequency(editingRecurring.frequency);
      setNextDueDate(toDateInputValue(new Date(editingRecurring.nextDueAt)));
      setSplitType(editingRecurring.splitType);
      setSplit({
        equalSelections: Object.fromEntries(
          members.map((member) => [
            member.id,
            (editingRecurring.splits[member.id] ?? 0) > 0,
          ])
        ),
        exactInputs: Object.fromEntries(
          Object.entries(editingRecurring.splits).map(([memberId, value]) => [
            memberId,
            value.toFixed(2),
          ])
        ),
        shareInputs: {},
        percentInputs: {},
        adjustmentInputs: {},
      });
      setNotes(editingRecurring.notes ?? "");
    } else {
      setDescription("");
      setAmountStr("");
      setCurrency(group?.settlementCurrency ?? group?.defaultCurrency ?? "USD");
      setPaidById(members[0]?.id ?? "");
      setCategory("housing");
      setFrequency("monthly");
      setNextDueDate(toDateInputValue());
      setSplitType("EQUAL");
      setSplit(splitStateFromExpense(members, null));
      setNotes("");
    }
    setError(null);
  }, [editingRecurring, group?.defaultCurrency, group?.settlementCurrency, members, open]);

  function openNewRecurring() {
    setEditingRecurring(null);
    setOpen(true);
  }

  function openEditRecurring(item: RecurringExpense) {
    setEditingRecurring(item);
    setOpen(true);
  }

  function canEditRecurring(item: RecurringExpense) {
    return canEditRecurringExpense({
      group,
      members,
      recurring: item,
      uid: user?.uid,
    });
  }

  function canDeleteRecurring(item: RecurringExpense) {
    return canDeleteRecurringExpense({
      group,
      members,
      recurring: item,
      uid: user?.uid,
    });
  }

  async function saveRecurring() {
    if (!repo || !group) return;
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    if (!amount || amount <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    if (!paidById) {
      setError("Choose who pays.");
      return;
    }
    const result = buildSplitsForMethod({
      splitMethod: splitType,
      amount,
      equalParticipantIds: members
        .filter((member) => split.equalSelections[member.id] ?? true)
        .map((member) => member.id),
      exactDistribution: parseInputs(split.exactInputs),
      shareDistribution: parseInputs(split.shareInputs),
      percentDistribution: parseInputs(split.percentInputs),
      adjustmentDistribution: parseInputs(split.adjustmentInputs),
      participantLabel: "member",
      currency,
    });
    if (!result.ok) {
      setError(result.error ?? "Fix the split before saving.");
      return;
    }
    setBusyId("new");
    setError(null);
    try {
      await runSyncing(
        async () => {
          if (editingRecurring) {
            await repo.updateRecurringExpense(group.id, editingRecurring.id, {
              description,
              amount,
              paidById,
              splitType: result.persistedSplitType,
              splits: result.splits,
              currency,
              category,
              frequency,
              nextDueAt:
                dateInputToLocalTimestamp(nextDueDate) ??
                editingRecurring.nextDueAt,
              notes,
            });
            return;
          }
          await repo.createRecurringExpense({
            groupId: group.id,
            description,
            amount,
            paidById,
            splitType: result.persistedSplitType,
            splits: result.splits,
            currency,
            category,
            frequency,
            nextDueAt: dateInputToLocalTimestamp(nextDueDate) ?? Date.now(),
            notes,
          });
        },
        {
          loading: editingRecurring
            ? "Updating recurring expense..."
            : "Creating recurring expense...",
          success: editingRecurring
            ? "Recurring expense updated."
            : "Recurring expense created.",
          error: editingRecurring
            ? "Could not update recurring expense."
            : "Could not create recurring expense.",
        }
      );
      setEditingRecurring(null);
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save recurring expense."
      );
    } finally {
      setBusyId(null);
    }
  }

  async function postRecurring(item: RecurringExpense) {
    if (!repo) return;
    setBusyId(`post:${item.id}`);
    try {
      await runSyncing(() => repo.postRecurringExpense(item), {
        loading: "Posting recurring expense...",
        success: "Recurring expense posted.",
        error: "Could not post recurring expense.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleRecurring(item: RecurringExpense) {
    if (!repo) return;
    setBusyId(`toggle:${item.id}`);
    try {
      await runSyncing(
        () =>
          repo.updateRecurringExpense(item.groupId, item.id, {
            active: !item.active,
          }),
        {
          loading: item.active ? "Pausing recurring expense..." : "Resuming recurring expense...",
          success: item.active ? "Recurring expense paused." : "Recurring expense resumed.",
          error: "Could not update recurring expense.",
        }
      );
    } finally {
      setBusyId(null);
    }
  }

  async function deleteRecurring(item: RecurringExpense) {
    if (!repo) return;
    setBusyId(`delete:${item.id}`);
    try {
      await runSyncing(() => repo.deleteRecurringExpense(item.groupId, item.id), {
        loading: "Deleting recurring expense...",
        success: "Recurring expense deleted.",
        error: "Could not delete recurring expense.",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="space-y-3 border-primary/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Repeat className="h-5 w-5" />
          </span>
          <div>
            <p className="font-black">Recurring expenses</p>
            <p className="text-sm text-muted-foreground">
              Create reusable drafts for rent, utilities, subscriptions, or trips.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={openNewRecurring} disabled={!group}>
          <Repeat className="h-4 w-4" />
          New recurring
        </Button>
      </div>

      {recurringExpenses.length === 0 ? (
        <div className="rounded-2xl border border-border/70 px-3 py-5 text-center text-sm text-muted-foreground">
          No recurring drafts yet.
        </div>
      ) : (
        <div className="space-y-2">
          {recurringExpenses.map((item) => {
            const canEdit = canEditRecurring(item);
            const canDelete = canDeleteRecurring(item);
            return (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-2xl border border-border/70 px-3 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{item.description}</p>
                    <Badge variant={item.active ? "outline" : "muted"}>
                      {item.active ? "Active" : "Paused"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatMoney(item.amount, item.currency)} · {item.frequency} · due{" "}
                    {formatDate(item.nextDueAt)}
                  </p>
                </div>
                {(canEdit || canDelete) && (
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    {canEdit && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => postRecurring(item)}
                          disabled={!item.active || busyId !== null}
                        >
                          Post
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEditRecurring(item)}
                          disabled={busyId !== null}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleRecurring(item)}
                          disabled={busyId !== null}
                        >
                          {item.active ? "Pause" : "Resume"}
                        </Button>
                      </>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteRecurring(item)}
                        disabled={busyId !== null}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setEditingRecurring(null);
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingRecurring ? "Edit recurring expense" : "New recurring expense"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <p className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                {error}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="recurring-description">Description</Label>
                <Input
                  id="recurring-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Rent, internet, cleaner"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recurring-amount">Amount</Label>
                <Input
                  id="recurring-amount"
                  inputMode="decimal"
                  value={amountStr}
                  onChange={(event) => setAmountStr(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recurring-paid-by">Paid by</Label>
                <NativeSelect
                  id="recurring-paid-by"
                  value={paidById}
                  onChange={(event) => setPaidById(event.target.value)}
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recurring-currency">Currency</Label>
                <NativeSelect
                  id="recurring-currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  {SUPPORTED_CURRENCIES.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recurring-frequency">Frequency</Label>
                <NativeSelect
                  id="recurring-frequency"
                  value={frequency}
                  onChange={(event) =>
                    setFrequency(event.target.value as RecurringFrequency)
                  }
                >
                  {RECURRING_FREQUENCIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recurring-next-due">Next due</Label>
                <Input
                  id="recurring-next-due"
                  type="date"
                  value={nextDueDate}
                  onChange={(event) => setNextDueDate(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recurring-category">Category</Label>
                <NativeSelect
                  id="recurring-category"
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as ExpenseCategorySlug)
                  }
                >
                  {EXPENSE_CATEGORIES.map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <SplitTypeToggle value={splitType} advanced onChange={setSplitType} />
            <SplitEditor
              participants={members.map((member) => ({
                id: member.id,
                name: member.name,
              }))}
              amount={amount}
              currency={currency}
              splitType={splitType}
              value={split}
              onChange={setSplit}
            />
            <textarea
              className="min-h-16 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional note"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveRecurring} disabled={busyId === "new"}>
              {busyId === "new" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {editingRecurring ? "Save changes" : "Create recurring"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function RequestStatusBadge({
  request,
}: {
  request: SettlementRequest | undefined;
}) {
  if (!request || request.status === "dismissed") return null;
  const tone = requestTone(request.status);
  return <Badge variant={tone.variant}>{tone.label}</Badge>;
}

export function matchingRequestForDebt(
  requests: SettlementRequest[],
  debt: DebtOverview
): SettlementRequest | undefined {
  return requests.find(
    (request) =>
      request.fromMemberId === debt.debtor.id &&
      request.toMemberId === debt.creditor.id &&
      request.currency === debt.currency &&
      request.status !== "dismissed" &&
      request.status !== "settled" &&
      Math.abs(request.amount - debt.amount) < 0.01
  );
}

export function settlementRequestLabel(request: SettlementRequest): string {
  const tone = requestTone(request.status);
  const updated = request.status === "reminded" && request.lastRemindedAt
    ? ` · reminded ${formatDate(request.lastRemindedAt)}`
    : "";
  return `${tone.label}${updated}`;
}
