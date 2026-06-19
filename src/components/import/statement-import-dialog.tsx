"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Upload,
} from "lucide-react";

import type { ExpenseCategorySlug } from "@/lib/expense-categories";
import {
  EXPENSE_CATEGORIES,
} from "@/lib/expense-categories";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { dateInputToLocalTimestamp } from "@/lib/dates";
import type { Friend, SplitType } from "@/lib/models";
import { YOU_ID } from "@/lib/models";
import { buildSplits, type SplitPair } from "@/lib/splits";
import type { StatementParseResult } from "@/lib/statement/types";
import {
  distributeBySharedExactShares,
  toStatementImportRow,
  type StatementImportRow,
} from "@/lib/statement/import-adapter";
import {
  extractStatementText,
  type StatementExtractionProgress,
} from "@/lib/statement/document-extractor";
import { parseStatementWithLLMFallback } from "@/lib/statement/parse-statement";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import {
  SplitEditor,
  emptySplitState,
  type Participant,
  type SplitState,
} from "@/components/split-editor";
import { SplitTypeToggle } from "@/components/dialogs/add-adhoc-expense-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

type ImportTarget =
  | {
      kind: "group";
      groupId: string;
      participants: Participant[];
      defaultPayerId: string;
    }
  | {
      kind: "friend";
      friends: Friend[];
    };

interface StatementImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ImportTarget;
}

type Stage = "upload" | "processing" | "review";

export function StatementImportDialog({
  open,
  onOpenChange,
  target,
}: StatementImportDialogProps) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<StatementExtractionProgress | null>(
    null
  );
  const [result, setResult] = useState<StatementParseResult | null>(null);
  const [rows, setRows] = useState<StatementImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [selectedFriendId, setSelectedFriendId] = useState("");
  const selectedFriend = useMemo(
    () =>
      target.kind === "friend"
        ? target.friends.find((friend) => friend.id === selectedFriendId) ??
          target.friends[0] ??
          null
        : null,
    [selectedFriendId, target]
  );

  const participants = useMemo<Participant[]>(() => {
    if (target.kind === "group") return target.participants;
    if (!selectedFriend) return [{ id: YOU_ID, name: "You" }];
    return [
      { id: YOU_ID, name: "You" },
      { id: selectedFriend.id, name: selectedFriend.name },
    ];
  }, [selectedFriend, target]);

  const [paidBy, setPaidBy] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [splitType, setSplitType] = useState<SplitType>("EQUAL");
  const [split, setSplit] = useState<SplitState>(() =>
    emptySplitState(participants)
  );

  const selectedRows = useMemo(
    () => rows.filter((row) => row.selected && row.selectable),
    [rows]
  );
  const selectedTotal = useMemo(
    () => selectedRows.reduce((sum, row) => sum + Math.abs(row.amount), 0),
    [selectedRows]
  );
  const allSelectableSelected = useMemo(() => {
    const selectable = rows.filter((row) => row.selectable);
    return selectable.length > 0 && selectable.every((row) => row.selected);
  }, [rows]);

  useEffect(() => {
    if (!open) return;
    if (target.kind === "friend" && !selectedFriendId) {
      setSelectedFriendId(target.friends[0]?.id ?? "");
    }
  }, [open, selectedFriendId, target]);

  useEffect(() => {
    if (!open || participants.length === 0) return;
    setPaidBy((current) => {
      if (current && participants.some((participant) => participant.id === current)) {
        return current;
      }
      return target.kind === "group"
        ? target.defaultPayerId || participants[0]?.id || ""
        : YOU_ID;
    });
    setSplit(emptySplitState(participants));
  }, [open, participants, target]);

  function reset() {
    setStage("upload");
    setFile(null);
    setProgress(null);
    setResult(null);
    setRows([]);
    setError(null);
    setSaving(false);
    setCurrency("USD");
    setSplitType("EQUAL");
    setSplit(emptySplitState(participants));
  }

  async function handleProcess() {
    if (!file) {
      setError("Choose a statement file first.");
      return;
    }

    setStage("processing");
    setError(null);
    setProgress({ stage: "validating", progress: 0 });

    try {
      const extracted = await extractStatementText(file, setProgress);
      const parsed = await parseStatementWithLLMFallback(extracted.rawText, {
        minConfidence: 0.3,
      });
      const nextRows = parsed.transactions.map(toStatementImportRow);
      if (nextRows.length === 0) {
        throw new Error("No transactions were recognized in this statement.");
      }

      setResult(parsed);
      setRows(nextRows);
      setCurrency(normalizeCurrency(parsed.currency));
      setStage("review");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not process this statement."
      );
      setStage("upload");
    }
  }

  function toggleAllSelectable() {
    setRows((current) =>
      current.map((row) =>
        row.selectable ? { ...row, selected: !allSelectableSelected } : row
      )
    );
  }

  function updateRow(id: string, patch: Partial<StatementImportRow>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
    setError(null);
  }

  function validateSharedSplits(): SplitPair[] | null {
    if (selectedRows.length === 0) {
      setError("Select at least one expense row to import.");
      return null;
    }
    if (!paidBy) {
      setError("Choose who paid for these expenses.");
      return null;
    }
    if (target.kind === "friend" && !selectedFriend) {
      setError("Choose a friend for this import.");
      return null;
    }

    const equalIds = participants
      .filter((participant) => split.equalSelections[participant.id] ?? true)
      .map((participant) => participant.id);
    const exactDistribution: Record<string, number> = {};
    for (const participant of participants) {
      const value = parseFloat(split.exactInputs[participant.id] ?? "");
      if (!Number.isNaN(value)) exactDistribution[participant.id] = value;
    }

    const splitResult = buildSplits({
      splitType,
      amount: selectedTotal,
      equalParticipantIds: equalIds,
      exactDistribution,
      participantLabel: target.kind === "group" ? "member" : "participant",
    });
    if (!splitResult.ok) {
      setError(splitResult.error ?? "Invalid split.");
      return null;
    }
    return splitResult.splits;
  }

  async function handleImport() {
    if (!repo || saving) return;
    const sharedSplits = validateSharedSplits();
    if (!sharedSplits) return;

    const rowSplits = selectedRows.map((row) => ({
      row,
      splits:
        splitType === "EQUAL"
          ? buildSplits({
              splitType: "EQUAL",
              amount: Math.abs(row.amount),
              equalParticipantIds: sharedSplits.map(([id]) => id),
              exactDistribution: {},
              participantLabel: target.kind === "group" ? "member" : "participant",
            }).splits
          : distributeBySharedExactShares(Math.abs(row.amount), sharedSplits),
    }));

    if (rowSplits.some((entry) => entry.splits.length === 0)) {
      setError("Could not build split rows for the selected expenses.");
      return;
    }

    setSaving(true);
    try {
      await runSyncing(
        async () => {
          if (target.kind === "group") {
            await repo.createExpensesWithSplits(
              rowSplits.map(({ row, splits }) => ({
                groupId: target.groupId,
                description: row.vendor.trim(),
                amount: Math.abs(row.amount),
                paidById: paidBy,
                splitType,
                splits,
                timestamp: dateInputToLocalTimestamp(row.date) ?? Date.now(),
                currency,
                category: row.category,
              }))
            );
          } else {
            await repo.createAdHocExpensesWithSplits(
              rowSplits.map(({ row, splits }) => ({
                description: row.vendor.trim(),
                amount: Math.abs(row.amount),
                paidByFriendId: paidBy,
                splitType,
                splits,
                timestamp: dateInputToLocalTimestamp(row.date) ?? Date.now(),
                currency,
                category: row.category,
              }))
            );
          }
        },
        {
          loading: "Importing expenses...",
          success: `Imported ${selectedRows.length} expenses.`,
          error: "Could not import expenses.",
        }
      );
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import expenses.");
    } finally {
      setSaving(false);
    }
  }

  const progressLabel = progress
    ? `${progress.stage === "ocr" ? "Reading scanned text" : "Reading statement"} ${progress.progress}%`
    : "Reading statement";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && saving) return;
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import statement expenses</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-2xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {stage === "upload" && (
          <div className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary/30 bg-primary/5 px-5 py-10 text-center transition-colors hover:bg-primary/10">
              <Upload className="h-8 w-8 text-primary" />
              <span className="mt-3 text-sm font-bold">
                {file ? file.name : "Choose a PDF or image statement"}
              </span>
              <span className="mt-1 text-xs text-muted-foreground">
                Credit card and bank statements up to 25MB
              </span>
              <Input
                className="sr-only"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setError(null);
                }}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleProcess} disabled={!file}>
                <FileText className="h-4 w-4" />
                Recognize expenses
              </Button>
            </div>
          </div>
        )}

        {stage === "processing" && (
          <div className="flex min-h-56 flex-col items-center justify-center text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 font-bold">{progressLabel}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Large or scanned statements can take a little longer.
            </p>
          </div>
        )}

        {stage === "review" && result && (
          <div className="space-y-4">
            <StatementSummary result={result} selectedTotal={selectedTotal} />

            {target.kind === "friend" && (
              <div className="space-y-1.5">
                <Label htmlFor="statement-friend">Friend</Label>
                <NativeSelect
                  id="statement-friend"
                  value={selectedFriend?.id ?? ""}
                  onChange={(event) => {
                    setSelectedFriendId(event.target.value);
                    setError(null);
                  }}
                >
                  {target.friends.map((friend) => (
                    <option key={friend.id} value={friend.id}>
                      {friend.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="statement-paid-by">Paid by</Label>
                <NativeSelect
                  id="statement-paid-by"
                  value={paidBy}
                  onChange={(event) => setPaidBy(event.target.value)}
                >
                  {participants.map((participant) => (
                    <option key={participant.id} value={participant.id}>
                      {participant.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="statement-currency">Currency</Label>
                <NativeSelect
                  id="statement-currency"
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
              <Card className="flex items-center justify-between border-primary/10 p-3">
                <div>
                  <p className="text-xs font-bold uppercase text-muted-foreground">
                    Selected
                  </p>
                  <p className="font-black">{selectedRows.length} expenses</p>
                </div>
                <p className="font-black text-primary">
                  {formatMoney(selectedTotal, currency)}
                </p>
              </Card>
            </div>

            <div className="rounded-2xl border border-border/70">
              <div className="flex items-center justify-between border-b border-border/70 px-3 py-2 text-sm">
                <label className="flex items-center gap-2 font-semibold">
                  <Checkbox
                    checked={allSelectableSelected}
                    onCheckedChange={toggleAllSelectable}
                  />
                  Select expense rows
                </label>
                <span className="text-muted-foreground">
                  Credits and payments are shown for review only.
                </span>
              </div>
              <div className="max-h-72 overflow-auto">
                <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="sticky top-0 z-20 w-10 border-b border-border/70 bg-muted px-3 py-3 text-left">
                        Use
                      </th>
                      <th className="sticky top-0 z-20 border-b border-border/70 bg-muted px-3 py-3 text-left">
                        Date
                      </th>
                      <th className="sticky top-0 z-20 border-b border-border/70 bg-muted px-3 py-3 text-left">
                        Description
                      </th>
                      <th className="sticky top-0 z-20 border-b border-border/70 bg-muted px-3 py-3 text-left">
                        Category
                      </th>
                      <th className="sticky top-0 z-20 border-b border-border/70 bg-muted px-3 py-3 text-right">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="border-b border-border/70 px-3 py-3 align-top">
                          <Checkbox
                            checked={row.selected}
                            disabled={!row.selectable}
                            onCheckedChange={(checked) =>
                              updateRow(row.id, { selected: Boolean(checked) })
                            }
                          />
                        </td>
                        <td className="min-w-32 border-b border-border/70 px-3 py-3 align-top">
                          <Input
                            type="date"
                            value={row.date}
                            onChange={(event) =>
                              updateRow(row.id, { date: event.target.value })
                            }
                          />
                        </td>
                        <td className="min-w-56 border-b border-border/70 px-3 py-3 align-top">
                          <Input
                            value={row.vendor}
                            onChange={(event) =>
                              updateRow(row.id, { vendor: event.target.value })
                            }
                          />
                          {!row.selectable && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {row.type} row
                            </p>
                          )}
                        </td>
                        <td className="min-w-44 border-b border-border/70 px-3 py-3 align-top">
                          <NativeSelect
                            value={row.category}
                            onChange={(event) =>
                              updateRow(row.id, {
                                category: event.target.value as ExpenseCategorySlug,
                              })
                            }
                          >
                            {EXPENSE_CATEGORIES.map((category) => (
                              <option key={category.slug} value={category.slug}>
                                {category.name}
                              </option>
                            ))}
                          </NativeSelect>
                        </td>
                        <td className="border-b border-border/70 px-3 py-3 text-right align-top font-bold">
                          <span
                            className={
                              row.amount >= 0 ? "text-foreground" : "text-success"
                            }
                          >
                            {formatMoney(Math.abs(row.amount), currency)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <SplitTypeToggle value={splitType} onChange={setSplitType} />
            <SplitEditor
              participants={participants}
              amount={selectedTotal}
              currency={currency}
              splitType={splitType}
              value={split}
              onChange={(next) => {
                setSplit(next);
                setError(null);
              }}
            />

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => reset()} disabled={saving}>
                Start over
              </Button>
              <Button
                onClick={handleImport}
                disabled={saving || selectedRows.length === 0}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Import {selectedRows.length} expenses
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatementSummary({
  result,
  selectedTotal,
}: {
  result: StatementParseResult;
  selectedTotal: number;
}) {
  return (
    <Card className="space-y-3 border-primary/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-black">{result.issuer} statement</p>
          <p className="text-sm text-muted-foreground">
            {result.statementPeriod.start && result.statementPeriod.end
              ? `${result.statementPeriod.start} to ${result.statementPeriod.end}`
              : "Statement period not detected"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {result.transactions.length} transactions found
          </Badge>
          <Badge variant="outline">
            {Math.round(result.confidence * 100)}% confidence
          </Badge>
          {selectedTotal > 0 && <Badge variant="success">Expenses selected</Badge>}
        </div>
      </div>
      {result.warnings.length > 0 && (
        <div className="space-y-1">
          {result.warnings.map((warning, index) => (
            <p key={index} className="text-xs font-semibold text-amber-600">
              {warning}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

function normalizeCurrency(currency: string): string {
  return SUPPORTED_CURRENCIES.some((item) => item.code === currency)
    ? currency
    : "USD";
}
