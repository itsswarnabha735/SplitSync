"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clipboard,
  Loader2,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { useSettlementCopilotContext } from "@/hooks/use-settlement-copilot-context";
import {
  SETTLEMENT_COPILOT_SUGGESTION_TYPES,
  validateSettlementCopilotResponse,
  type SettlementCopilotContext,
  type SettlementCopilotContextType,
  type SettlementCopilotResponse,
  type SettlementCopilotWarningSeverity,
} from "@/lib/settlement-copilot";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface SettlementCopilotButtonProps {
  contextType?: SettlementCopilotContextType;
  context?: SettlementCopilotContext;
  prompt?: string;
  label?: string;
  buttonVariant?: ButtonProps["variant"];
  buttonSize?: ButtonProps["size"];
  className?: string;
}

export function SettlementCopilotButton(props: SettlementCopilotButtonProps) {
  if (props.context && props.contextType) {
    return (
      <SettlementCopilotDialogButton
        {...props}
        contextType={props.contextType}
        context={props.context}
      />
    );
  }
  return <RouteSettlementCopilotButton {...props} />;
}

function RouteSettlementCopilotButton(props: SettlementCopilotButtonProps) {
  const routeContext = useSettlementCopilotContext();
  return (
    <SettlementCopilotDialogButton
      {...props}
      contextType={routeContext.contextType}
      context={routeContext.context}
    />
  );
}

function SettlementCopilotDialogButton({
  contextType,
  context,
  prompt = "",
  label = "Ask Copilot",
  buttonVariant = "ghost",
  buttonSize = "sm",
  className,
}: Required<Pick<SettlementCopilotButtonProps, "contextType" | "context">> &
  Omit<SettlementCopilotButtonProps, "contextType" | "context">) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(prompt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<SettlementCopilotResponse | null>(
    null
  );
  const [copied, setCopied] = useState<string | null>(null);

  const promptChips = useMemo(
    () => promptChipsFor(contextType),
    [contextType]
  );

  async function askCopilot(nextPrompt?: string) {
    const userPrompt = (nextPrompt ?? input).trim();
    if (userPrompt.length < 3) {
      setError("Ask Copilot a little more detail.");
      return;
    }

    setInput(userPrompt);
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch("/api/settlement-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contextType,
          userPrompt,
          locale:
            typeof navigator !== "undefined" ? navigator.language : "en-US",
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          context,
          capabilities: {
            draftOnly: true,
            suggestionTypes: SETTLEMENT_COPILOT_SUGGESTION_TYPES,
          },
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Copilot could not safely answer this. Try a narrower question."
        );
      }
      setResponse(validateSettlementCopilotResponse(payload, context));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Copilot could not safely answer this. Try a narrower question."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void askCopilot();
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Could not copy this draft.");
    }
  }

  return (
    <>
      <Button
        variant={buttonVariant}
        size={buttonSize}
        className={className}
        onClick={() => {
          setOpen(true);
          if (prompt) setInput(prompt);
        }}
      >
        <Sparkles className="h-4 w-4" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Settlement Copilot
            </DialogTitle>
          </DialogHeader>

          <div className="rounded-2xl border border-primary/15 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
            Draft-only. Review before acting. Copilot cannot record payments,
            edit expenses, delete rows, or send reminders.
          </div>

          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
              {context.title}
            </p>
            <div className="flex flex-wrap gap-2">
              {promptChips.map((chip) => (
                <Button
                  key={chip}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void askCopilot(chip)}
                  disabled={loading}
                >
                  {chip}
                </Button>
              ))}
            </div>
          </div>

          <form className="flex gap-2" onSubmit={handleSubmit}>
            <Input
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setError(null);
              }}
              placeholder="Ask why someone owes, check ledger health, or draft a summary"
              disabled={loading}
            />
            <Button type="submit" disabled={loading || !input.trim()}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquareText className="h-4 w-4" />
              )}
              Ask
            </Button>
          </form>

          {error && (
            <p
              className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          {response && (
            <div className="space-y-3">
              <section className="rounded-2xl border border-border/70 bg-card/80 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={response.requiresReview ? "outline" : "success"}>
                    {Math.round(response.confidence * 100)}% confidence
                  </Badge>
                  {response.requiresReview && (
                    <Badge variant="destructive">Review needed</Badge>
                  )}
                </div>
                <p className="text-sm font-semibold leading-6">
                  {response.answer}
                </p>
              </section>

              {response.warnings.length > 0 && (
                <section className="space-y-2">
                  <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                    Warnings
                  </p>
                  {response.warnings.map((warning, index) => (
                    <div
                      key={`${warning.message}:${index}`}
                      className={cn(
                        "flex gap-2 rounded-xl border px-3 py-2 text-sm font-semibold",
                        warningClassName(warning.severity)
                      )}
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{warning.message}</span>
                    </div>
                  ))}
                </section>
              )}

              {response.sections.map((section) => (
                <section
                  key={section.title}
                  className="rounded-2xl border border-border/70 bg-card/80 p-4"
                >
                  <p className="text-sm font-black">{section.title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {section.body}
                  </p>
                </section>
              ))}

              {response.suggestions.length > 0 && (
                <section className="space-y-2">
                  <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                    Draft suggestions
                  </p>
                  {response.suggestions.map((suggestion, index) => (
                    <div
                      key={`${suggestion.type}:${index}`}
                      className="rounded-2xl border border-primary/10 bg-primary/5 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black">{suggestion.title}</p>
                          <p className="mt-1 whitespace-pre-line text-sm leading-6 text-muted-foreground">
                            {suggestion.body}
                          </p>
                        </div>
                        {suggestion.copyText && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void copy(suggestion.copyText!, `${index}`)
                            }
                          >
                            <Clipboard className="h-4 w-4" />
                            {copied === `${index}` ? "Copied" : "Copy"}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {response.entityRefs.length > 0 && (
                <section className="space-y-2">
                  <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                    Referenced rows
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {response.entityRefs.map((ref) => (
                      <Badge key={`${ref.type}:${ref.id}`} variant="muted">
                        {ref.label ?? ref.type}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                Copilot suggestions are copy-only and cannot mutate your ledger.
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function promptChipsFor(contextType: SettlementCopilotContextType): string[] {
  const common = [
    "Check ledger health",
    "Create shareable summary",
    "What should I settle first?",
  ];
  if (contextType === "group") {
    return [
      "Explain recommended payments",
      "Check ledger health",
      "Create shareable settlement summary",
      "Suggest settlement priority",
    ];
  }
  if (contextType === "friend") {
    return [
      "Summarize this balance",
      "Draft a polite reminder",
      "Explain why this amount is outstanding",
    ];
  }
  if (contextType === "import-review") {
    return [
      "Find duplicates or suspicious rows",
      "Which rows need review?",
      "Explain money movement rows",
    ];
  }
  if (contextType === "spend") {
    return [
      "Which imported expenses need review?",
      "Explain my spend exposure",
      ...common,
    ];
  }
  return common;
}

function warningClassName(severity: SettlementCopilotWarningSeverity): string {
  if (severity === "critical") {
    return "border-destructive/15 bg-destructive/10 text-destructive";
  }
  if (severity === "review") {
    return "border-amber-300/50 bg-amber-50/70 text-amber-800";
  }
  return "border-primary/15 bg-primary/10 text-primary";
}
