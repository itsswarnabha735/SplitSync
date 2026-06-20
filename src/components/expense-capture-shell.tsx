"use client";

import { useState } from "react";
import { FileText, Keyboard, Loader2, ScanText, Upload } from "lucide-react";

import type {
  AppliedExpenseAutocomplete,
  ExpenseAutocompleteCurrentFields,
  ExpenseAutocompleteMode,
  ExpenseAutocompleteParticipant,
  ExpenseAutocompleteRecentContext,
} from "@/lib/expense-autocomplete";
import { extractStatementText } from "@/lib/statement/document-extractor";
import { cn } from "@/lib/utils";
import { ExpenseAutocompletePanel } from "@/components/expense-autocomplete-panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ExpenseCaptureShellProps {
  mode: ExpenseAutocompleteMode;
  participants: ExpenseAutocompleteParticipant[];
  supportedCurrencies: string[];
  recentContext: ExpenseAutocompleteRecentContext[];
  largeExpenseThresholds: Record<string, number>;
  current: ExpenseAutocompleteCurrentFields;
  onApply: (result: AppliedExpenseAutocomplete, source: "ai-text" | "pasted-message" | "receipt-image") => void;
  onOpenStatementImport: () => void;
  quickPlaceholder: string;
  pastePlaceholder: string;
  className?: string;
}

type CaptureMode = "quick" | "paste" | "scan" | "statement";

export function ExpenseCaptureShell({
  mode,
  participants,
  supportedCurrencies,
  recentContext,
  largeExpenseThresholds,
  current,
  onApply,
  onOpenStatementImport,
  quickPlaceholder,
  pastePlaceholder,
  className,
}: ExpenseCaptureShellProps) {
  const [activeMode, setActiveMode] = useState<CaptureMode>("quick");
  const [scanText, setScanText] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanLoading, setScanLoading] = useState(false);

  async function handleScan(file: File | null) {
    if (!file) return;
    setScanLoading(true);
    setScanError(null);
    setScanText("");
    try {
      const extracted = await extractStatementText(file);
      if (extracted.rawText.trim().length < 4) {
        throw new Error("No readable text was found in this image.");
      }
      setScanText(extracted.rawText.trim());
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : "Could not read this receipt image."
      );
    } finally {
      setScanLoading(false);
    }
  }

  return (
    <Card className={cn("space-y-4 border-primary/10 p-4", className)}>
      <div className="space-y-1">
        <p className="text-xs font-black uppercase tracking-wide text-primary">
          Add from evidence
        </p>
        <p className="text-sm text-muted-foreground">
          Capture what you have now, then review the ledger entry before saving.
        </p>
      </div>

      <Tabs value={activeMode} onValueChange={(value) => setActiveMode(value as CaptureMode)}>
        <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="quick">
            <Keyboard className="mr-1 h-4 w-4" />
            Quick
          </TabsTrigger>
          <TabsTrigger value="paste">
            <FileText className="mr-1 h-4 w-4" />
            Paste
          </TabsTrigger>
          <TabsTrigger value="scan">
            <ScanText className="mr-1 h-4 w-4" />
            Scan
          </TabsTrigger>
          <TabsTrigger value="statement">
            <Upload className="mr-1 h-4 w-4" />
            Statement
          </TabsTrigger>
        </TabsList>

        <TabsContent value="quick">
          <ExpenseAutocompletePanel
            mode={mode}
            participants={participants}
            supportedCurrencies={supportedCurrencies}
            recentContext={recentContext}
            largeExpenseThresholds={largeExpenseThresholds}
            current={current}
            onApply={(result) => onApply(result, "ai-text")}
            placeholder={quickPlaceholder}
            actionLabel="Fill draft"
          />
        </TabsContent>

        <TabsContent value="paste">
          <ExpenseAutocompletePanel
            mode={mode}
            participants={participants}
            supportedCurrencies={supportedCurrencies}
            recentContext={recentContext}
            largeExpenseThresholds={largeExpenseThresholds}
            current={current}
            onApply={(result) => onApply(result, "pasted-message")}
            placeholder={pastePlaceholder}
            actionLabel="Parse paste"
            multiline
          />
        </TabsContent>

        <TabsContent value="scan">
          <div className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary/30 bg-primary/5 px-5 py-8 text-center transition-colors hover:bg-primary/10">
              {scanLoading ? (
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
              ) : (
                <ScanText className="h-7 w-7 text-primary" />
              )}
              <span className="mt-3 text-sm font-bold">
                {scanLoading ? "Reading receipt..." : "Choose a receipt image or PDF"}
              </span>
              <span className="mt-1 text-xs text-muted-foreground">
                SplitSync extracts text first, then you review the draft.
              </span>
              <Input
                className="sr-only"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                disabled={scanLoading}
                onChange={(event) => handleScan(event.target.files?.[0] ?? null)}
              />
            </label>
            {scanError && (
              <p className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                {scanError}
              </p>
            )}
            {(scanText || scanLoading) && (
              <ExpenseAutocompletePanel
                mode={mode}
                participants={participants}
                supportedCurrencies={supportedCurrencies}
                recentContext={recentContext}
                largeExpenseThresholds={largeExpenseThresholds}
                current={current}
                onApply={(result) => onApply(result, "receipt-image")}
                placeholder="Receipt text will appear here after extraction"
                actionLabel="Fill from scan"
                initialInput={scanText}
                multiline
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="statement">
          <div className="flex flex-col gap-3 rounded-2xl border border-primary/10 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-black">Batch import from a statement</p>
              <p className="text-sm text-muted-foreground">
                Recognize many rows, skip duplicates, and review splits before import.
              </p>
            </div>
            <Button type="button" onClick={onOpenStatementImport}>
              <Upload className="h-4 w-4" />
              Open importer
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
