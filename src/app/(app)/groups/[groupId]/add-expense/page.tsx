"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import type { SplitType } from "@/lib/models";
import type { ExpenseCategorySlug } from "@/lib/expense-categories";
import {
  EXPENSE_CATEGORIES,
  suggestExpenseCategory,
} from "@/lib/expense-categories";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { dateInputToLocalTimestamp, toDateInputValue } from "@/lib/dates";
import { buildSplits, type SplitPair } from "@/lib/splits";
import { useAuth } from "@/hooks/use-auth";
import { useGroupDetail } from "@/hooks/use-group-detail";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SplitEditor,
  emptySplitState,
  type SplitState,
} from "@/components/split-editor";
import { SplitTypeToggle } from "@/components/dialogs/add-adhoc-expense-dialog";

export default function AddExpensePage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  const router = useRouter();
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const { user } = useAuth();
  const { members } = useGroupDetail(groupId);

  const participants = useMemo(
    () => members.map((m) => ({ id: m.id, name: m.name })),
    [members]
  );

  const [description, setDescription] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [paidBy, setPaidBy] = useState<string>("");
  const [currency, setCurrency] = useState("USD");
  const [category, setCategory] = useState<ExpenseCategorySlug>("other");
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [dateStr, setDateStr] = useState(() => toDateInputValue());
  const [splitType, setSplitType] = useState<SplitType>("EQUAL");
  const [split, setSplit] = useState<SplitState>({
    equalSelections: {},
    exactInputs: {},
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewSplits, setReviewSplits] = useState<SplitPair[] | null>(null);

  const amount = parseFloat(amountStr) || 0;
  const suggestedCategory = useMemo(
    () => suggestExpenseCategory(description)?.categorySlug ?? "other",
    [description]
  );
  const currentUserMemberId = useMemo(
    () => members.find((m) => m.linkedUid === user?.uid)?.id ?? "",
    [members, user?.uid]
  );

  // Default all members into the equal split as they load.
  useEffect(() => {
    if (participants.length === 0) return;
    setSplit((prev) => {
      const equalSelections = { ...prev.equalSelections };
      let changed = false;
      for (const p of participants) {
        if (!(p.id in equalSelections)) {
          equalSelections[p.id] = true;
          changed = true;
        }
      }
      return changed ? { ...prev, equalSelections } : prev;
    });
    if (!paidBy || !participants.some((p) => p.id === paidBy)) {
      setPaidBy(currentUserMemberId || participants[0].id);
    }
  }, [participants, paidBy, currentUserMemberId]);

  useEffect(() => {
    if (!categoryTouched) {
      setCategory(suggestedCategory);
    }
  }, [categoryTouched, suggestedCategory]);

  const memberName = useMemo(() => {
    const map = new Map(participants.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? "Unknown member";
  }, [participants]);

  const reviewRows = useMemo(() => {
    const rows = reviewSplits ?? [];
    return rows.map(([memberId, share]) => ({
      memberId,
      name: memberName(memberId),
      share,
    }));
  }, [memberName, reviewSplits]);

  function getValidatedSplits(): SplitPair[] | null {
    if (!description.trim()) {
      setError("Description cannot be empty.");
      return null;
    }
    if (amount <= 0) {
      setError("Amount must be greater than 0.");
      return null;
    }
    if (!paidBy) {
      setError("Please select who paid for the expense.");
      return null;
    }
    const equalIds = participants
      .filter((p) => split.equalSelections[p.id] ?? true)
      .map((p) => p.id);
    const exactDistribution: Record<string, number> = {};
    for (const p of participants) {
      const v = parseFloat(split.exactInputs[p.id] ?? "");
      if (!Number.isNaN(v)) exactDistribution[p.id] = v;
    }

    const result = buildSplits({
      splitType,
      amount,
      equalParticipantIds: equalIds,
      exactDistribution,
      participantLabel: "member",
    });
    if (!result.ok) {
      setError(result.error ?? "Invalid split.");
      return null;
    }
    setError(null);
    return result.splits;
  }

  function handleReview() {
    const nextSplits = getValidatedSplits();
    if (!nextSplits) return;
    setReviewSplits(nextSplits);
  }

  async function handleSave() {
    const splits = reviewSplits ?? getValidatedSplits();
    if (!splits) return;
    if (!repo) return;

    setSaving(true);
    try {
      await runSyncing(
        () =>
          repo.createExpenseWithSplits({
            groupId,
            description,
            amount,
            paidById: paidBy,
            splitType,
            splits,
            timestamp: dateInputToLocalTimestamp(dateStr) ?? Date.now(),
            currency,
            category,
          }),
        {
          loading: "Saving expense...",
          success: "Expense saved.",
          error: "Could not save expense.",
        }
      );
      router.push(`/groups/${groupId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save expense.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pb-24">
      <AppHeader title="Log new expense" showBack />

      <main id="main-content" className="container space-y-4 py-6">
        {error && (
          <div
            className="flex items-center gap-2 rounded-2xl border border-destructive/15 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
            role="alert"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <Card className="space-y-4 border-primary/10 p-5">
          <p className="text-xs font-black uppercase tracking-wide text-primary">
            Expense details
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="exp-desc">Description</Label>
            <Input
              id="exp-desc"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setError(null);
              }}
              placeholder="Dinner, groceries, ..."
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="exp-amount">Amount</Label>
              <Input
                id="exp-amount"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => {
                  setAmountStr(e.target.value);
                  setError(null);
                }}
                placeholder="0.00"
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="exp-paidby">Paid by</Label>
              <NativeSelect
                id="exp-paidby"
                value={paidBy}
                onChange={(e) => {
                  setPaidBy(e.target.value);
                  setError(null);
                }}
              >
                <option value="">Select payer…</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="exp-date">Date</Label>
              <Input
                id="exp-date"
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="exp-currency">Currency</Label>
              <NativeSelect
                id="exp-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="exp-category">Category</Label>
              <NativeSelect
                id="exp-category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as ExpenseCategorySlug);
                  setCategoryTouched(true);
                }}
              >
                {EXPENSE_CATEGORIES.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        </Card>

        <SplitTypeToggle value={splitType} onChange={setSplitType} />

        <p className="px-1 text-xs text-muted-foreground">
          {splitType === "EQUAL"
            ? "Who is included in this purchase? Choose anyone participating."
            : "Type the exact amount each member is responsible for."}
        </p>

        <SplitEditor
          participants={participants}
          amount={amount}
          currency={currency}
          splitType={splitType}
          value={split}
          onChange={(s) => {
            setSplit(s);
            setReviewSplits(null);
            setError(null);
          }}
        />
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-border/60 bg-background/85 p-4 shadow-[0_-18px_42px_-34px_hsl(var(--foreground)/0.45)] backdrop-blur-xl">
        <div className="container">
          <Button
            className="w-full"
            size="lg"
            onClick={handleReview}
            disabled={saving}
          >
            {saving ? "Saving expense..." : "Review expense"}
          </Button>
        </div>
      </div>

      <Dialog
        open={reviewSplits !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setReviewSplits(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-2xl border border-primary/10 bg-muted/50 px-3 py-2">
              <p className="font-bold">{description.trim()}</p>
              <p className="text-sm text-muted-foreground">
                {formatMoney(amount, currency)} paid by {memberName(paidBy)} on{" "}
                {dateStr || "today"} ·{" "}
                {EXPENSE_CATEGORIES.find((item) => item.slug === category)?.name ??
                  "Other"}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                Member shares
              </p>
              {reviewRows.map((row) => (
                <div
                  key={row.memberId}
                  className="flex items-center justify-between rounded-2xl border border-border/70 bg-card/70 px-3 py-2 text-sm"
                >
                  <span className="font-semibold">{row.name}</span>
                  <span className="font-bold">
                    {formatMoney(row.share, currency)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2 rounded-2xl border border-primary/15 bg-primary/10 px-3 py-2 text-sm text-primary">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="font-semibold">
                After saving, this expense will update group balances and the
                Settle up view.
              </p>
            </div>
            {error && (
              <p
                className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
                role="alert"
              >
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setReviewSplits(null)}
              disabled={saving}
            >
              Back
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving expense..." : "Save expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
