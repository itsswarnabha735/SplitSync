"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import type { Expense, SplitType } from "@/lib/models";
import type { AppliedExpenseAutocomplete } from "@/lib/expense-autocomplete";
import type { ExpenseCategorySlug } from "@/lib/expense-categories";
import {
  EXPENSE_CATEGORIES,
  suggestExpenseCategory,
} from "@/lib/expense-categories";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { dateInputToLocalTimestamp, toDateInputValue } from "@/lib/dates";
import {
  buildSplitsForMethod,
  type DraftSplitMethod,
  type SplitPair,
} from "@/lib/splits";
import {
  buildDuplicateFingerprint,
  findDuplicateExpenseCandidates,
  summarizeExpenseImpact,
  summarizeIncludedParticipants,
  validateExpenseDraft,
  type ExpenseDraft,
  type ExpenseDraftField,
  type ExpenseDraftSource,
  type ExpenseWarning,
} from "@/lib/expense-drafts";
import { useAuth } from "@/hooks/use-auth";
import { useGroupDetail } from "@/hooks/use-group-detail";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import { AppHeader } from "@/components/app-header";
import {
  buildAutocompleteCurrentFields,
} from "@/components/expense-autocomplete-panel";
import { ExpenseCaptureShell } from "@/components/expense-capture-shell";
import { StatementImportDialog } from "@/components/import/statement-import-dialog";
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
import {
  DuplicateExpenseWarning,
  ExpenseFieldProvenance,
  ExpenseImpactPreview,
  ParticipantPresetPicker,
  ParticipantPreview,
  type ParticipantPreset,
} from "@/components/expense-review-widgets";

export default function AddExpensePage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  const router = useRouter();
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const showToast = useUiStore((s) => s.showToast);
  const { user } = useAuth();
  const { members, expenses } = useGroupDetail(groupId);

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
  const [splitType, setSplitType] = useState<DraftSplitMethod>("EQUAL");
  const [split, setSplit] = useState<SplitState>({
    equalSelections: {},
    exactInputs: {},
    shareInputs: {},
    percentInputs: {},
    adjustmentInputs: {},
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewSplits, setReviewSplits] = useState<SplitPair[] | null>(null);
  const [reviewSplitType, setReviewSplitType] = useState<SplitType>("EQUAL");
  const [reviewWarnings, setReviewWarnings] = useState<ExpenseWarning[]>([]);
  const [fieldSource, setFieldSource] = useState<
    Partial<Record<ExpenseDraftField, ExpenseDraftSource | "edited">>
  >({});
  const [fieldConfidence, setFieldConfidence] = useState<
    Partial<Record<ExpenseDraftField, number>>
  >({});
  const [sourceWarnings, setSourceWarnings] = useState<ExpenseWarning[]>([]);
  const [lastAiSnapshot, setLastAiSnapshot] = useState<{
    description: string;
    amountStr: string;
    currency: string;
    dateStr: string;
    paidBy: string;
    category: ExpenseCategorySlug;
    splitType: DraftSplitMethod;
    split: SplitState;
    fieldSource: Partial<Record<ExpenseDraftField, ExpenseDraftSource | "edited">>;
    fieldConfidence: Partial<Record<ExpenseDraftField, number>>;
    sourceWarnings: ExpenseWarning[];
  } | null>(null);
  const [participantPreset, setParticipantPreset] =
    useState<ParticipantPreset>("everyone");
  const [participantsConfirmed, setParticipantsConfirmed] = useState(false);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [moneyMovementAcknowledged, setMoneyMovementAcknowledged] =
    useState(false);
  const [showStatementImport, setShowStatementImport] = useState(false);

  const amount = parseFloat(amountStr) || 0;
  const suggestedCategory = useMemo(
    () => suggestExpenseCategory(description)?.categorySlug ?? "other",
    [description]
  );
  const currentUserMemberId = useMemo(
    () => members.find((m) => m.linkedUid === user?.uid)?.id ?? "",
    [members, user?.uid]
  );
  const autocompleteParticipants = useMemo(
    () =>
      members.map((member) => ({
        id: member.id,
        name:
          member.linkedUid && member.linkedUid === user?.uid
            ? "You"
            : member.name,
        isCurrentUser: member.linkedUid === user?.uid,
        aliases:
          member.linkedUid === user?.uid
            ? ["me", "myself", "i", "you", member.name]
            : [member.name],
      })),
    [members, user?.uid]
  );
  const recentContext = useMemo(
    () =>
      expenses.slice(0, 12).map((expense) => ({
        description: expense.description,
        amount: expense.amount,
        currency: expense.currency,
        category: expense.category,
        paidById: expense.paidById,
        splitType: expense.splitType,
        participantIds: Object.keys(expense.splits),
        timestamp: expense.timestamp,
      })),
    [expenses]
  );
  const supportedCurrencyCodes = useMemo(
    () => SUPPORTED_CURRENCIES.map((item) => item.code),
    []
  );

  // Keep participant state in sync without silently confirming large groups.
  useEffect(() => {
    if (participants.length === 0) return;
    setSplit((prev) => {
      const equalSelections = { ...prev.equalSelections };
      let changed = false;
      for (const p of participants) {
        if (!(p.id in equalSelections)) {
          equalSelections[p.id] =
            participants.length <= 3
              ? true
              : expenses[0]
                ? Boolean(expenses[0].splits[p.id])
                : true;
          changed = true;
        }
      }
      return changed ? { ...prev, equalSelections } : prev;
    });
    setParticipantsConfirmed((current) => current || participants.length <= 3);
    if (participants.length > 3 && expenses[0]) {
      setParticipantPreset("last-expense");
    }
    if (!paidBy || !participants.some((p) => p.id === paidBy)) {
      setPaidBy(currentUserMemberId || participants[0].id);
    }
  }, [participants, paidBy, currentUserMemberId, expenses]);

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

  const participantPreview = useMemo(
    () =>
      summarizeIncludedParticipants({
        participants,
        selected: split.equalSelections,
      }),
    [participants, split.equalSelections]
  );

  const draft = useMemo<ExpenseDraft>(
    () => ({
      id: "group-expense-draft",
      context: "group",
      status: "draft",
      source: "manual",
      description,
      amount,
      currency,
      paidById: paidBy,
      date: dateStr,
      category,
      splitMethod: splitType,
      participants: Object.fromEntries(
        participants.map((participant) => [
          participant.id,
          { included: split.equalSelections[participant.id] ?? true },
        ])
      ),
      warnings: sourceWarnings,
      fieldConfidence,
      fieldSource,
    }),
    [
      amount,
      category,
      currency,
      dateStr,
      description,
      fieldConfidence,
      fieldSource,
      paidBy,
      participants,
      sourceWarnings,
      split.equalSelections,
      splitType,
    ]
  );

  const duplicateCandidates = useMemo(
    () =>
      findDuplicateExpenseCandidates({
        draft,
        transactionFingerprint:
          description.trim() && amount > 0
            ? buildDuplicateFingerprint({
                date: dateStr,
                description,
                amount,
                currency,
              })
            : undefined,
        existingExpenses: expenses.map((expense) => ({
          id: expense.id,
          description: expense.description,
          amount: expense.amount,
          currency: expense.currency,
          timestamp: expense.timestamp,
          paidById: expense.paidById,
          splits: expense.splits,
          transactionFingerprint: expense.transactionFingerprint,
        })),
      }),
    [amount, currency, dateStr, description, draft, expenses]
  );

  const impactSummary = useMemo(
    () =>
      summarizeExpenseImpact({
        payerName: memberName(paidBy),
        amountLabel: formatMoney(amount, currency),
        description,
        date: dateStr,
        shares: reviewRows.map((row) => ({
          name: row.name,
          amountLabel: formatMoney(row.share, currency),
        })),
        visibleTo: "this group",
      }),
    [amount, currency, dateStr, description, memberName, paidBy, reviewRows]
  );

  function getValidatedSplits(): {
    splits: SplitPair[];
    persistedSplitType: SplitType;
    warnings: ExpenseWarning[];
  } | null {
    const equalIds = participants
      .filter((p) => split.equalSelections[p.id] ?? true)
      .map((p) => p.id);
    const result = buildSplitsForMethod({
      splitMethod: splitType,
      amount,
      equalParticipantIds: equalIds,
      exactDistribution: parseSplitInputs(split.exactInputs),
      shareDistribution: parseSplitInputs(split.shareInputs),
      percentDistribution: parseSplitInputs(split.percentInputs),
      adjustmentDistribution: parseSplitInputs(split.adjustmentInputs),
      participantLabel: "member",
      currency,
    });
    const warnings = validateExpenseDraft({
      draft,
      splitResult: result,
      requireParticipantReview: participants.length > 3 && !participantsConfirmed,
      moneyMovementAcknowledged,
    });
    if (
      duplicateCandidates.some((candidate) => candidate.strength === "hard") &&
      !duplicateAcknowledged
    ) {
      warnings.push({
        code: "duplicate-like",
        message: "Review the similar expense before saving again.",
        blocking: true,
      });
    }
    setReviewWarnings(warnings);
    const blocking = warnings.find((warning) => warning.blocking);
    if (!result.ok || blocking) {
      setError(blocking?.message ?? result.error ?? "Invalid expense.");
      return null;
    }
    setError(null);
    return {
      splits: result.splits,
      persistedSplitType: result.persistedSplitType,
      warnings,
    };
  }

  function handleReview() {
    const next = getValidatedSplits();
    if (!next) return;
    setReviewSplits(next.splits);
    setReviewSplitType(next.persistedSplitType);
  }

  function handleAutocompleteApply(
    result: AppliedExpenseAutocomplete,
    source: ExpenseDraftSource = "ai-text"
  ) {
    setLastAiSnapshot({
      description,
      amountStr,
      currency,
      dateStr,
      paidBy,
      category,
      splitType,
      split,
      fieldSource,
      fieldConfidence,
      sourceWarnings,
    });
    const next = result.fields;
    const skippedEdited: ExpenseWarning[] = [];
    const canApply = (field: ExpenseDraftField) => {
      if (fieldSource[field] !== "edited") return true;
      skippedEdited.push({
        code: "low-confidence",
        field,
        message: `${fieldLabel(field)} was edited manually, so AI did not overwrite it.`,
      });
      return false;
    };
    const nextSources: Partial<Record<ExpenseDraftField, ExpenseDraftSource | "edited">> = {};
    const nextConfidence: Partial<Record<ExpenseDraftField, number>> = {};
    const mark = (field: ExpenseDraftField, confidenceKey: string = field) => {
      nextSources[field] = source;
      const confidence = result.confidence[confidenceKey];
      if (confidence !== undefined) nextConfidence[field] = confidence;
    };

    if (next.description !== undefined && canApply("description")) {
      setDescription(next.description);
      mark("description");
    }
    if (next.amountStr !== undefined && canApply("amount")) {
      setAmountStr(next.amountStr);
      mark("amount");
    }
    if (next.currency !== undefined && canApply("currency")) {
      setCurrency(next.currency);
      mark("currency");
    }
    if (next.dateStr !== undefined && canApply("date")) {
      setDateStr(next.dateStr);
      mark("date");
    }
    if (next.paidBy !== undefined && canApply("paidById")) {
      setPaidBy(next.paidBy);
      mark("paidById");
    }
    if (next.category !== undefined && canApply("category")) {
      setCategory(next.category);
      setCategoryTouched(true);
      mark("category");
    }
    if (next.splitType !== undefined && canApply("splitMethod")) {
      setSplitType(next.splitType);
      mark("splitMethod", "splitType");
    }
    if ((next.equalSelections || next.exactInputs) && canApply("participants")) {
      setSplit((current) => ({
        equalSelections: next.equalSelections ?? current.equalSelections,
        exactInputs: next.exactInputs ?? current.exactInputs,
        shareInputs: current.shareInputs,
        percentInputs: current.percentInputs,
        adjustmentInputs: current.adjustmentInputs,
      }));
      mark("participants", next.equalSelections ? "equalParticipantIds" : "exactSplits");
      setParticipantsConfirmed(false);
    }
    setFieldSource((current) => ({ ...current, ...nextSources }));
    setFieldConfidence((current) => ({ ...current, ...nextConfidence }));
    setSourceWarnings([
      ...result.warnings.map((warning) => ({
        code:
          warning.code === "money-movement"
            ? "money-movement"
            : warning.code === "large-expense"
              ? "large-expense"
              : "low-confidence",
        field: mapAutocompleteField(warning.field),
        message: warning.message,
        blocking: [
          "low-confidence",
          "ambiguous-participant",
          "exact-split-mismatch",
          "money-movement",
        ].includes(warning.code),
      } satisfies ExpenseWarning)),
      ...skippedEdited,
    ]);
    setDuplicateAcknowledged(false);
    setMoneyMovementAcknowledged(false);
    setReviewSplits(null);
    setError(null);
  }

  function handleUndoAiFill() {
    if (!lastAiSnapshot) return;
    setDescription(lastAiSnapshot.description);
    setAmountStr(lastAiSnapshot.amountStr);
    setCurrency(lastAiSnapshot.currency);
    setDateStr(lastAiSnapshot.dateStr);
    setPaidBy(lastAiSnapshot.paidBy);
    setCategory(lastAiSnapshot.category);
    setSplitType(lastAiSnapshot.splitType);
    setSplit(lastAiSnapshot.split);
    setFieldSource(lastAiSnapshot.fieldSource);
    setFieldConfidence(lastAiSnapshot.fieldConfidence);
    setSourceWarnings(lastAiSnapshot.sourceWarnings);
    setLastAiSnapshot(null);
    setReviewSplits(null);
    setError(null);
  }

  function markEdited(field: ExpenseDraftField) {
    setFieldSource((current) => ({ ...current, [field]: "edited" }));
    setFieldConfidence((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setDuplicateAcknowledged(false);
    if (field === "participants") setParticipantsConfirmed(false);
    setReviewSplits(null);
  }

  function fieldWarning(field: ExpenseDraftField): string | undefined {
    return sourceWarnings.find((warning) => warning.field === field)?.message;
  }

  function applyParticipantPreset(nextPreset: ParticipantPreset) {
    setParticipantPreset(nextPreset);
    let selected: Record<string, boolean> = {};
    if (nextPreset === "everyone") {
      selected = Object.fromEntries(participants.map((participant) => [participant.id, true]));
      setParticipantsConfirmed(true);
    } else if (nextPreset === "payer-only") {
      const selectedIds = new Set([paidBy, currentUserMemberId].filter(Boolean));
      selected = Object.fromEntries(
        participants.map((participant) => [participant.id, selectedIds.has(participant.id)])
      );
      setParticipantsConfirmed(true);
    } else if (nextPreset === "last-expense") {
      const last = expenses[0];
      selected = Object.fromEntries(
        participants.map((participant) => [
          participant.id,
          last ? Boolean(last.splits[participant.id]) : true,
        ])
      );
      setParticipantsConfirmed(Boolean(last));
    } else if (nextPreset === "category-pattern") {
      const match = expenses.find((expense) => expense.category === category);
      selected = Object.fromEntries(
        participants.map((participant) => [
          participant.id,
          match ? Boolean(match.splits[participant.id]) : true,
        ])
      );
      setParticipantsConfirmed(Boolean(match));
    } else {
      selected = split.equalSelections;
      setParticipantsConfirmed(false);
    }
    setSplit((current) => ({
      ...current,
      equalSelections: selected,
    }));
    setFieldSource((current) => ({ ...current, participants: "edited" }));
    setDuplicateAcknowledged(false);
    setReviewSplits(null);
  }

  async function handleSave() {
    const validated = reviewSplits
      ? {
          splits: reviewSplits,
          persistedSplitType: reviewSplitType,
          warnings: reviewWarnings,
        }
      : getValidatedSplits();
    if (!validated) return;
    if (!repo) return;

    setSaving(true);
    try {
      const expenseId = await runSyncing(
        () =>
          repo.createExpenseWithSplits({
            groupId,
            description,
            amount,
            paidById: paidBy,
            splitType: validated.persistedSplitType,
            splits: validated.splits,
            timestamp: dateInputToLocalTimestamp(dateStr) ?? Date.now(),
            currency,
            category,
            sourceType: dominantSource(fieldSource),
            sourceConfidence: averageConfidence(fieldConfidence),
            sourceWarnings: [
              ...sourceWarnings.map((warning) => warning.message),
              ...duplicateCandidates.map(
                (candidate) => `Possible duplicate: ${candidate.expense.description}`
              ),
            ].slice(0, 10),
          }),
        {
          loading: "Saving expense...",
          success: "Expense saved.",
          error: "Could not save expense.",
        }
      );
      showToast({
        title: "Expense saved",
        body: "Balances were updated. Undo is available briefly.",
        actionLabel: "Undo",
        onAction: async () => {
          await repo.deleteExpense({
            id: expenseId,
            groupId,
          } as Expense);
        },
      });
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

        <ExpenseCaptureShell
          mode="group"
          participants={autocompleteParticipants}
          supportedCurrencies={supportedCurrencyCodes}
          recentContext={recentContext}
          largeExpenseThresholds={{}}
          current={buildAutocompleteCurrentFields({
            description,
            amountStr,
            currency,
            dateStr,
            paidBy,
            category,
            splitType: splitType === "EQUAL" ? "EQUAL" : "EXACT",
          })}
          onApply={handleAutocompleteApply}
          onOpenStatementImport={() => setShowStatementImport(true)}
          quickPlaceholder="Uber 920 INR paid by me split with Aman yesterday"
          pastePlaceholder="Paste a UPI, card alert, receipt text, or chat message"
        />

        {lastAiSnapshot && (
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={handleUndoAiFill}>
              Undo AI fill
            </Button>
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
                markEdited("description");
                setError(null);
              }}
              placeholder="Dinner, groceries, ..."
            />
            <ExpenseFieldProvenance
              source={fieldSource.description}
              confidence={fieldConfidence.description}
              warning={fieldWarning("description")}
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
                  markEdited("amount");
                  setError(null);
                }}
                placeholder="0.00"
              />
              <ExpenseFieldProvenance
                source={fieldSource.amount}
                confidence={fieldConfidence.amount}
                warning={fieldWarning("amount")}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="exp-paidby">Paid by</Label>
              <NativeSelect
                id="exp-paidby"
                value={paidBy}
                onChange={(e) => {
                  setPaidBy(e.target.value);
                  markEdited("paidById");
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
              <ExpenseFieldProvenance
                source={fieldSource.paidById}
                confidence={fieldConfidence.paidById}
                warning={fieldWarning("paidById")}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="exp-date">Date</Label>
              <Input
                id="exp-date"
                type="date"
                value={dateStr}
                onChange={(e) => {
                  setDateStr(e.target.value);
                  markEdited("date");
                }}
              />
              <ExpenseFieldProvenance
                source={fieldSource.date}
                confidence={fieldConfidence.date}
                warning={fieldWarning("date")}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="exp-currency">Currency</Label>
              <NativeSelect
                id="exp-currency"
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  markEdited("currency");
                }}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
              <ExpenseFieldProvenance
                source={fieldSource.currency}
                confidence={fieldConfidence.currency}
                warning={fieldWarning("currency")}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="exp-category">Category</Label>
              <NativeSelect
                id="exp-category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as ExpenseCategorySlug);
                  setCategoryTouched(true);
                  markEdited("category");
                }}
              >
                {EXPENSE_CATEGORIES.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.name}
                  </option>
                ))}
              </NativeSelect>
              <ExpenseFieldProvenance
                source={fieldSource.category}
                confidence={fieldConfidence.category}
                warning={fieldWarning("category")}
              />
            </div>
          </div>
        </Card>

        <div className="space-y-2">
          <SplitTypeToggle
            value={splitType}
            advanced
            onChange={(next) => {
              setSplitType(next);
              markEdited("splitMethod");
            }}
          />
          <ExpenseFieldProvenance
            source={fieldSource.splitMethod}
            confidence={fieldConfidence.splitMethod}
            warning={fieldWarning("splitMethod")}
          />
        </div>

        <div className="space-y-2">
          <ParticipantPresetPicker
            value={participantPreset}
            disabledPresets={[
              expenses.length === 0 ? "last-expense" : "custom",
              expenses.some((expense) => expense.category === category)
                ? "custom"
                : "category-pattern",
            ].filter((preset) => preset !== "custom") as ParticipantPreset[]}
            onChange={applyParticipantPreset}
          />
          <ParticipantPreview
            included={participantPreview.included}
            excluded={participantPreview.excluded}
            needsConfirmation={participants.length > 3 && !participantsConfirmed}
            onConfirm={() => setParticipantsConfirmed(true)}
          />
        </div>

        <p className="px-1 text-xs text-muted-foreground">
          {splitType === "EQUAL"
            ? "Who is included in this purchase? Choose anyone participating."
            : splitType === "EXACT"
              ? "Type the exact amount each member is responsible for."
              : splitType === "SHARES"
                ? "Use relative shares, such as 2 shares for one member and 1 for another."
                : splitType === "PERCENT"
                  ? "Percentages must total 100%."
                  : "Start from an equal split and enter positive or negative adjustments."}
        </p>

        <SplitEditor
          participants={participants}
          amount={amount}
          currency={currency}
          splitType={splitType}
          value={split}
          onChange={(s) => {
            setSplit(s);
            markEdited("participants");
            setParticipantsConfirmed(splitType === "EQUAL" ? false : participantsConfirmed);
            setReviewSplits(null);
            setError(null);
          }}
        />

        {sourceWarnings.some((warning) => warning.code === "money-movement") && (
          <div className="flex flex-col gap-2 rounded-2xl border border-amber-300/60 bg-amber-50/80 px-3 py-2 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-semibold">
              This looks like a transfer, refund, income, or repayment. Confirm
              it is still a shared expense before saving.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setMoneyMovementAcknowledged(true)}
              disabled={moneyMovementAcknowledged}
            >
              {moneyMovementAcknowledged ? "Confirmed" : "This is shared"}
            </Button>
          </div>
        )}

        <DuplicateExpenseWarning
          candidates={duplicateCandidates}
          acknowledged={duplicateAcknowledged}
          onAcknowledge={() => setDuplicateAcknowledged(true)}
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

      <StatementImportDialog
        open={showStatementImport}
        onOpenChange={setShowStatementImport}
        target={{
          kind: "group",
          groupId,
          participants: members.map((member) => ({
            id: member.id,
            name:
              member.linkedUid && member.linkedUid === user?.uid
                ? "You"
                : member.name,
          })),
          defaultPayerId: currentUserMemberId || members[0]?.id || "",
          existingExpenses: expenses,
        }}
      />

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
            <ExpenseImpactPreview summary={impactSummary} warnings={reviewWarnings} />
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

function parseSplitInputs(inputs: Record<string, string> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(inputs ?? {})) {
    const value = parseFloat(raw);
    if (!Number.isNaN(value)) out[id] = value;
  }
  return out;
}

function mapAutocompleteField(field: string | undefined): ExpenseDraftField | undefined {
  const map: Record<string, ExpenseDraftField> = {
    description: "description",
    amount: "amount",
    currency: "currency",
    date: "date",
    paidById: "paidById",
    category: "category",
    splitType: "splitMethod",
    equalParticipantIds: "participants",
    exactSplits: "participants",
  };
  return field ? map[field] : undefined;
}

function fieldLabel(field: ExpenseDraftField): string {
  const labels: Record<ExpenseDraftField, string> = {
    description: "Description",
    amount: "Amount",
    currency: "Currency",
    paidById: "Payer",
    date: "Date",
    category: "Category",
    splitMethod: "Split method",
    participants: "Participants",
    notes: "Notes",
  };
  return labels[field];
}

function dominantSource(
  sources: Partial<Record<ExpenseDraftField, ExpenseDraftSource | "edited">>
): ExpenseDraftSource {
  const counts = new Map<ExpenseDraftSource, number>();
  for (const source of Object.values(sources)) {
    if (!source || source === "edited") continue;
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "manual";
}

function averageConfidence(
  confidence: Partial<Record<ExpenseDraftField, number>>
): number | undefined {
  const values = Object.values(confidence).filter(
    (value): value is number => typeof value === "number"
  );
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
