import { NextRequest, NextResponse } from "next/server";

import {
  buildLocalExpenseAutocompleteResponse,
  sanitizeExpenseAutocompleteInput,
  validateExpenseAutocompleteRequest,
} from "@/lib/expense-autocomplete";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const validation = validateExpenseAutocompleteRequest({
      input: payload.text ?? payload.input ?? "",
      mode: payload.context === "friend" ? "friend" : "group",
      timezone:
        typeof payload.timezone === "string" ? payload.timezone : "UTC",
      today:
        typeof payload.today === "string"
          ? payload.today
          : payload.currentDefaults?.date,
      defaults: {
        currency: payload.currentDefaults?.currency,
        date: payload.currentDefaults?.date,
        paidById: payload.currentDefaults?.paidById,
        splitType: payload.currentDefaults?.splitType,
      },
      participants: payload.participants,
      supportedCurrencies: payload.supportedCurrencies,
      recentContext: payload.recentContext,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const requestValue = {
      ...validation.request,
      input: sanitizeExpenseAutocompleteInput(validation.request.input),
    };
    const parsed = buildLocalExpenseAutocompleteResponse(requestValue);

    return NextResponse.json({
      draftPatch: parsed.draft,
      confidence: parsed.confidence,
      warnings: parsed.warnings,
      normalizedEvidenceText: requestValue.input,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not parse this expense draft." },
      { status: 500 }
    );
  }
}
