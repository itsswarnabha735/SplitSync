"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { AppliedExpenseAutocomplete } from "@/lib/expense-autocomplete";
import type { AdHocExpense, Friend, SplitType } from "@/lib/models";
import { YOU_ID } from "@/lib/models";
import type { ExpenseCategorySlug } from "@/lib/expense-categories";
import {
  EXPENSE_CATEGORIES,
  suggestExpenseCategory,
} from "@/lib/expense-categories";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { dateInputToLocalTimestamp, toDateInputValue } from "@/lib/dates";
import { buildSplitsForMethod, type DraftSplitMethod, type SplitPair } from "@/lib/splits";
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
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import { buildAutocompleteCurrentFields } from "@/components/expense-autocomplete-panel";
import { ExpenseCaptureShell } from "@/components/expense-capture-shell";
import { StatementImportDialog } from "@/components/import/statement-import-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  SplitEditor,
  emptySplitState,
  type Participant,
  type SplitState,
} from "@/components/split-editor";
import {
  DuplicateExpenseWarning,
  ExpenseFieldProvenance,
  ExpenseImpactPreview,
  ParticipantPreview,
} from "@/components/expense-review-widgets";
import { cn } from "@/lib/utils";

export function AddAdHocExpenseDialog({
  open,
  onOpenChange,
  friends,
  adHocExpenses,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  friends: Friend[];
  adHocExpenses: AdHocExpense[];
}) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const showToast = useUiStore((s) => s.showToast);

  const [selectedFriendId, setSelectedFriendId] = useState("");
  const selectedFriend = useMemo(
    () => friends.find((f) => f.id === selectedFriendId) ?? friends[0] ?? null,
    [friends, selectedFriendId]
  );
  const participants = useMemo<Participant[]>(
    () =>
      selectedFriend
        ? [
            { id: YOU_ID, name: "You" },
            { id: selectedFriend.id, name: selectedFriend.name },
          ]
        : [{ id: YOU_ID, name: "You" }],
    [selectedFriend]
  );

  const [description, setDescription] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [paidBy, setPaidBy] = useState<string>(YOU_ID);
  const [currency, setCurrency] = useState("USD");
  const [dateStr, setDateStr] = useState(() => toDateInputValue());
  const [category, setCategory] = useState<ExpenseCategorySlug>("other");
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [splitType, setSplitType] = useState<DraftSplitMethod>("EQUAL");
  const [split, setSplit] = useState<SplitState>(() =>
    emptySplitState(participants)
  );
  const pendingAutocompleteSplitRef = useRef<Partial<SplitState> | null>(null);
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
    selectedFriendId: string;
    fieldSource: Partial<Record<ExpenseDraftField, ExpenseDraftSource | "edited">>;
    fieldConfidence: Partial<Record<ExpenseDraftField, number>>;
    sourceWarnings: ExpenseWarning[];
  } | null>(null);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [moneyMovementAcknowledged, setMoneyMovementAcknowledged] =
    useState(false);
  const [showStatementImport, setShowStatementImport] = useState(false);

  const amount = parseFloat(amountStr) || 0;
  const suggestedCategory = useMemo(
    () => suggestExpenseCategory(description)?.categorySlug ?? "other",
    [description]
  );

  useEffect(() => {
    if (!selectedFriend) return;
    if (selectedFriend.id !== selectedFriendId) {
      setSelectedFriendId(selectedFriend.id);
    }
    setPaidBy((current) =>
      current === YOU_ID || current === selectedFriend.id ? current : YOU_ID
    );
    const pendingAutocompleteSplit = pendingAutocompleteSplitRef.current;
    if (pendingAutocompleteSplit) {
      setSplit({
        equalSelections:
          pendingAutocompleteSplit.equalSelections ??
          emptySplitState(participants).equalSelections,
        exactInputs: pendingAutocompleteSplit.exactInputs ?? {},
        shareInputs: {},
        percentInputs: {},
        adjustmentInputs: {},
      });
      pendingAutocompleteSplitRef.current = null;
    } else {
      setSplit(emptySplitState(participants));
    }
  }, [participants, selectedFriend, selectedFriendId]);

  useEffect(() => {
    if (!categoryTouched) {
      setCategory(suggestedCategory);
    }
  }, [categoryTouched, suggestedCategory]);

  function reset() {
    setDescription("");
    setAmountStr("");
    setSelectedFriendId(friends[0]?.id ?? "");
    setPaidBy(YOU_ID);
    setCurrency("USD");
    setDateStr(toDateInputValue());
    setCategory("other");
    setCategoryTouched(false);
    setSplitType("EQUAL");
    setSplit(emptySplitState(participants));
    pendingAutocompleteSplitRef.current = null;
    setReviewSplits(null);
    setReviewWarnings([]);
    setFieldSource({});
    setFieldConfidence({});
    setSourceWarnings([]);
    setLastAiSnapshot(null);
    setDuplicateAcknowledged(false);
    setMoneyMovementAcknowledged(false);
    setError(null);
    setSaving(false);
  }

  const autocompleteParticipants = useMemo(
    () => [
      {
        id: YOU_ID,
        name: "You",
        isCurrentUser: true,
        aliases: ["me", "myself", "i", "you"],
      },
      ...friends.map((friend) => ({
        id: friend.id,
        name: friend.name,
        isCurrentUser: false,
        aliases: [friend.name, friend.email, friend.phone].filter(Boolean),
      })),
    ],
    [friends]
  );
  const recentContext = useMemo(
    () =>
      adHocExpenses.slice(0, 12).map((expense) => ({
        description: expense.description,
        amount: expense.amount,
        currency: expense.currency,
        category: expense.category,
        paidById: expense.paidByFriendId,
        splitType: expense.splitType,
        participantIds: Object.keys(expense.splits),
        timestamp: expense.timestamp,
      })),
    [adHocExpenses]
  );
  const supportedCurrencyCodes = useMemo(
    () => SUPPORTED_CURRENCIES.map((item) => item.code),
    []
  );

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
      id: "friend-expense-draft",
      context: "friend",
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
        existingExpenses: adHocExpenses.map((expense) => ({
          id: expense.id,
          description: expense.description,
          amount: expense.amount,
          currency: expense.currency,
          timestamp: expense.timestamp,
          paidById: expense.paidByFriendId,
          splits: expense.splits,
          transactionFingerprint: expense.transactionFingerprint,
        })),
      }),
    [adHocExpenses, amount, currency, dateStr, description, draft]
  );

  const reviewRows = useMemo(
    () =>
      (reviewSplits ?? []).map(([participantId, share]) => ({
        participantId,
        name:
          participants.find((participant) => participant.id === participantId)
            ?.name ?? "Unknown",
        share,
      })),
    [participants, reviewSplits]
  );

  const impactSummary = useMemo(
    () =>
      summarizeExpenseImpact({
        payerName:
          participants.find((participant) => participant.id === paidBy)?.name ??
          "Someone",
        amountLabel: formatMoney(amount, currency),
        description,
        date: dateStr,
        shares: reviewRows.map((row) => ({
          name: row.name,
          amountLabel: formatMoney(row.share, currency),
        })),
        visibleTo: selectedFriend ? `your ledger with ${selectedFriend.name}` : "this ledger",
      }),
    [amount, currency, dateStr, description, paidBy, participants, reviewRows, selectedFriend]
  );

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
      selectedFriendId,
      fieldSource,
      fieldConfidence,
      sourceWarnings,
    });
    const next = result.fields;
    const nextFriendId = friendIdFromAutocomplete(result, selectedFriendId);
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

    if (nextFriendId && nextFriendId !== selectedFriendId) {
      setSelectedFriendId(nextFriendId);
      mark("participants");
    }

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
    if (next.category !== undefined && canApply("category")) {
      setCategory(next.category);
      setCategoryTouched(true);
      mark("category");
    }
    if (next.splitType !== undefined && canApply("splitMethod")) {
      setSplitType(next.splitType);
      mark("splitMethod", "splitType");
    }

    const scopedFriendId = nextFriendId || selectedFriendId;
    if (next.paidBy !== undefined && canApply("paidById")) {
      setPaidBy(next.paidBy === YOU_ID || next.paidBy === scopedFriendId ? next.paidBy : YOU_ID);
      mark("paidById");
    }

    if (scopedFriendId && (next.equalSelections || next.exactInputs) && canApply("participants")) {
      const allowed = new Set([YOU_ID, scopedFriendId]);
      const equalSelections = next.equalSelections
        ? Object.fromEntries(
            [YOU_ID, scopedFriendId].map((id) => [
              id,
              next.equalSelections?.[id] ?? true,
            ])
          )
        : undefined;
      const exactInputs = next.exactInputs
        ? Object.fromEntries(
            Object.entries(next.exactInputs).filter(([id]) => allowed.has(id))
          )
        : undefined;
      const pendingSplit = { equalSelections, exactInputs };
      if (nextFriendId && nextFriendId !== selectedFriendId) {
        pendingAutocompleteSplitRef.current = pendingSplit;
      } else {
        setSplit({
          equalSelections:
            pendingSplit.equalSelections ?? emptySplitState(participants).equalSelections,
          exactInputs: pendingSplit.exactInputs ?? {},
          shareInputs: {},
          percentInputs: {},
          adjustmentInputs: {},
        });
      }
      mark("participants", next.equalSelections ? "equalParticipantIds" : "exactSplits");
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
    setSelectedFriendId(lastAiSnapshot.selectedFriendId);
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
    setReviewSplits(null);
  }

  function fieldWarning(field: ExpenseDraftField): string | undefined {
    return sourceWarnings.find((warning) => warning.field === field)?.message;
  }

  function getValidatedSplits(): {
    splits: SplitPair[];
    persistedSplitType: SplitType;
    warnings: ExpenseWarning[];
  } | null {
    if (!selectedFriend) {
      setError("Choose a friend for this expense.");
      return null;
    }
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
      participantLabel: "participant",
      currency,
    });
    const warnings = validateExpenseDraft({
      draft,
      splitResult: result,
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
          repo.createAdHocExpenseWithSplits({
            description,
            amount,
            paidByFriendId: paidBy,
            splitType: validated.persistedSplitType,
            splits: validated.splits,
            currency,
            timestamp: dateInputToLocalTimestamp(dateStr) ?? Date.now(),
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
          await repo.deleteAdHocExpense({
            id: expenseId,
          } as AdHocExpense);
        },
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save expense.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && saving) return;
        if (!o && !saving) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log a shared expense</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <p
              className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          <ExpenseCaptureShell
            mode="friend"
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
            quickPlaceholder="Cab to airport ₹1380 paid by me, split with Priya"
            pastePlaceholder="Paste a UPI, card alert, receipt text, or chat message"
          />

          {lastAiSnapshot && (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={handleUndoAiFill}>
                Undo AI fill
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="adhoc-desc">Description</Label>
            <Input
              id="adhoc-desc"
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
              <Label htmlFor="adhoc-amount">Amount</Label>
              <Input
                id="adhoc-amount"
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
              <Label htmlFor="adhoc-currency">Currency</Label>
              <NativeSelect
                id="adhoc-currency"
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
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="adhoc-date">Date</Label>
              <Input
                id="adhoc-date"
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
              <Label htmlFor="adhoc-category">Category</Label>
              <NativeSelect
                id="adhoc-category"
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

          <div className="space-y-1.5">
            <Label htmlFor="adhoc-friend">Friend</Label>
            <NativeSelect
              id="adhoc-friend"
              value={selectedFriend?.id ?? ""}
              onChange={(e) => {
                setSelectedFriendId(e.target.value);
                markEdited("participants");
                setError(null);
              }}
            >
              {friends.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </NativeSelect>
            <ExpenseFieldProvenance
              source={fieldSource.participants}
              confidence={fieldConfidence.participants}
              warning={fieldWarning("participants")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adhoc-paidby">Paid by</Label>
            <NativeSelect
              id="adhoc-paidby"
              value={paidBy}
              onChange={(e) => {
                setPaidBy(e.target.value);
                markEdited("paidById");
              }}
            >
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

          <SplitTypeToggle
            value={splitType}
            advanced
            onChange={(next) => {
              setSplitType(next);
              markEdited("splitMethod");
            }}
          />

          <ParticipantPreview
            included={participantPreview.included}
            excluded={participantPreview.excluded}
            needsConfirmation={false}
            onConfirm={() => undefined}
          />

          <SplitEditor
            participants={participants}
            amount={amount}
            currency={currency}
            splitType={splitType}
            value={split}
            onChange={(s) => {
              setSplit(s);
              markEdited("participants");
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

          {reviewSplits && (
            <div className="space-y-3 rounded-2xl border border-primary/10 bg-muted/40 p-3">
              <ExpenseImpactPreview summary={impactSummary} warnings={reviewWarnings} />
              <div className="space-y-2">
                {reviewRows.map((row) => (
                  <div
                    key={row.participantId}
                    className="flex items-center justify-between rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-sm"
                  >
                    <span className="font-semibold">{row.name}</span>
                    <span className="font-black">
                      {formatMoney(row.share, currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          {reviewSplits ? (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving expense..." : "Save expense"}
            </Button>
          ) : (
            <Button onClick={handleReview} disabled={saving}>
              Review expense
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
    <StatementImportDialog
      open={showStatementImport}
      onOpenChange={setShowStatementImport}
      target={{ kind: "friend", friends, existingExpenses: adHocExpenses }}
    />
    </>
  );
}

function friendIdFromAutocomplete(
  result: AppliedExpenseAutocomplete,
  fallbackFriendId: string
): string {
  const candidates = [
    result.draft.paidById,
    ...(result.draft.equalParticipantIds ?? []),
    ...Object.keys(result.draft.exactSplits ?? {}),
  ].filter((id): id is string => Boolean(id && id !== YOU_ID));

  return candidates[0] ?? fallbackFriendId;
}

export function SplitTypeToggle({
  value,
  onChange,
  advanced = false,
}: {
  value: DraftSplitMethod;
  onChange: (t: DraftSplitMethod) => void;
  advanced?: boolean;
}) {
  const options: Array<{ value: DraftSplitMethod; label: string; compactLabel?: string }> = [
    { value: "EQUAL", label: "Split equally", compactLabel: "Equal" },
    { value: "EXACT", label: "Split exactly", compactLabel: "Exact" },
    ...(advanced
      ? [
          { value: "SHARES" as const, label: "Shares" },
          { value: "PERCENT" as const, label: "Percent" },
          { value: "ADJUSTMENT" as const, label: "Adjust" },
        ]
      : []),
  ];

  function selectNext(current: DraftSplitMethod, direction: 1 | -1) {
    const index = options.findIndex((option) => option.value === current);
    const next = options[(index + direction + options.length) % options.length];
    onChange(next.value);
  }

  const advancedLayout = advanced && options.length > 2;

  return (
    <div
      className={cn(
        "grid gap-1 rounded-2xl border border-border/70 bg-card/80 p-1 shadow-sm",
        advancedLayout
          ? "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5"
          : "grid-cols-2"
      )}
      role="radiogroup"
      aria-label="Split type"
    >
      {options.map((option, index) => {
        const active = value === option.value;
        const displayLabel = advancedLayout ? option.compactLabel ?? option.label : option.label;
        const lastOddAdvancedOption =
          advancedLayout && options.length % 2 === 1 && index === options.length - 1;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-label={option.label}
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                selectNext(value, 1);
              }
              if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                selectNext(value, -1);
              }
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                onChange(option.value);
              }
            }}
            className={cn(
              "min-h-11 rounded-xl px-3 py-2 text-center text-sm font-bold leading-tight transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              active
                ? "bg-primary text-primary-foreground shadow-[0_10px_20px_-14px_hsl(var(--primary))]"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              lastOddAdvancedOption && "col-span-2 sm:col-span-1"
            )}
          >
            {displayLabel}
          </button>
        );
      })}
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
