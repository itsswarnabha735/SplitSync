import { NextRequest, NextResponse } from "next/server";

import { buildLLMCategoryBlock } from "@/lib/expense-categories";
import {
  buildLocalExpenseAutocompleteResponse,
  sanitizeExpenseAutocompleteInput,
  validateExpenseAutocompleteRequest,
  validateExpenseAutocompleteResponse,
  type ExpenseAutocompleteRequest,
} from "@/lib/expense-autocomplete";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const ROUTE_TIMEOUT_MS = 30_000;

interface GeminiExpenseAutocompleteResponse {
  draft?: {
    description?: string;
    amount?: number;
    currency?: string;
    date?: string;
    paidById?: string;
    category?: string;
    splitType?: "EQUAL" | "EXACT";
    equalParticipantIds?: string[];
    exactSplits?: Record<string, number>;
  };
  confidence?: Record<string, number>;
  warnings?: Array<{
    code: string;
    message: string;
    field?: string;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    const validation = validateExpenseAutocompleteRequest(await request.json());
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const autocompleteRequest = {
      ...validation.request,
      input: sanitizeExpenseAutocompleteInput(validation.request.input),
    };

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        withLocalOnlyWarning(buildLocalExpenseAutocompleteResponse(autocompleteRequest))
      );
    }

    const model =
      process.env.EXPENSE_AUTOCOMPLETE_MODEL ||
      process.env.GOOGLE_GEMINI_MODEL ||
      DEFAULT_MODEL;

    const prompt = buildExpenseAutocompletePrompt(autocompleteRequest);
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.05,
            topP: 0.8,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
          },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_NONE",
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_NONE",
            },
          ],
        }),
        signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
      }
    );

    if (!geminiResponse.ok) {
      const fallback = buildLocalExpenseAutocompleteResponse(autocompleteRequest);
      return NextResponse.json(withLocalOnlyWarning(fallback), {
        status: fallback.draft.amount || fallback.draft.description ? 200 : 502,
      });
    }

    const geminiData = await geminiResponse.json();
    const responseText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!responseText) {
      return NextResponse.json(
        withLocalOnlyWarning(buildLocalExpenseAutocompleteResponse(autocompleteRequest))
      );
    }

    let parsed: GeminiExpenseAutocompleteResponse;
    try {
      parsed = JSON.parse(stripCodeFence(responseText));
    } catch {
      return NextResponse.json(
        withLocalOnlyWarning(buildLocalExpenseAutocompleteResponse(autocompleteRequest))
      );
    }

    const normalized = validateExpenseAutocompleteResponse(
      parsed,
      autocompleteRequest
    );
    const local = buildLocalExpenseAutocompleteResponse(autocompleteRequest);

    return NextResponse.json(mergeWithLocalHints(normalized, local));
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      return NextResponse.json(
        { error: "Expense autocomplete timed out." },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: "Could not autocomplete this expense." },
      { status: 500 }
    );
  }
}

function buildExpenseAutocompletePrompt(request: ExpenseAutocompleteRequest) {
  return `You are SplitSync's expense-entry parser. Convert a short natural-language expense into structured JSON for an editable expense draft.

Return ONLY valid JSON. Do not include markdown, explanations, code fences, or unknown participant IDs.

Mode: ${request.mode}
Today: ${request.today}
Timezone: ${request.timezone}

Defaults:
${JSON.stringify(request.defaults, null, 2)}

Participants:
${JSON.stringify(request.participants, null, 2)}

Supported currencies:
${request.supportedCurrencies.join(", ")}

Recent context for defaults and duplicate awareness:
${JSON.stringify(request.recentContext, null, 2)}

Rules:
1. Prefer explicit text in the user prompt over defaults and recent context.
2. Use only participant ids listed above. Never invent friends or members.
3. Map "me", "myself", "I", "my card", and "you" to the participant where isCurrentUser is true.
4. If the prompt says everyone/all, include all participants. In friend mode, choose at most one friend counterparty plus the current user.
5. If an exact split is clearly stated, use splitType "EXACT" and exactSplits. Otherwise use "EQUAL".
6. Dates must be YYYY-MM-DD. Resolve relative dates using Today and Timezone.
7. Category must be one allowed category name or slug. ${buildLLMCategoryBlock()}
8. If it sounds like repayment, refund, transfer, salary, or income instead of spending, set the closest category and include a money-movement warning.
9. Include confidence scores from 0 to 1 for every field you return.
10. Include warning objects only for material review issues.

Return this exact shape:
{
  "draft": {
    "description": "Cab to airport",
    "amount": 1380,
    "currency": "INR",
    "date": "YYYY-MM-DD",
    "paidById": "participant-id",
    "category": "transport",
    "splitType": "EQUAL",
    "equalParticipantIds": ["participant-id"],
    "exactSplits": {"participant-id": 690}
  },
  "confidence": {
    "description": 0.91,
    "amount": 0.95,
    "currency": 0.9,
    "date": 0.8,
    "paidById": 0.82,
    "category": 0.88,
    "splitType": 0.86,
    "equalParticipantIds": 0.8,
    "exactSplits": 0.8
  },
  "warnings": [
    {"code": "low-confidence", "field": "paidById", "message": "Payer was unclear."}
  ]
}

Allowed warning codes: low-confidence, duplicate-like, large-expense, category-other, ambiguous-participant, exact-split-mismatch, money-movement.

User prompt:
${request.input}`;
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/gm, "")
    .replace(/\n?```\s*$/gm, "")
    .trim();
}

function withLocalOnlyWarning(
  response: ReturnType<typeof buildLocalExpenseAutocompleteResponse>
) {
  return {
    ...response,
    warnings: [
      ...response.warnings,
      {
        code: "low-confidence",
        field: "route",
        message: "AI is unavailable, so SplitSync used local parsing.",
      },
    ],
  };
}

function mergeWithLocalHints(
  ai: ReturnType<typeof validateExpenseAutocompleteResponse>,
  local: ReturnType<typeof buildLocalExpenseAutocompleteResponse>
) {
  const draft = { ...local.draft, ...ai.draft };
  const confidence = { ...local.confidence, ...ai.confidence };
  const warnings = [...ai.warnings];
  for (const warning of local.warnings) {
    if (
      (warning.code === "duplicate-like" ||
        warning.code === "category-other" ||
        warning.code === "money-movement") &&
      !warnings.some(
        (existing) =>
          existing.code === warning.code && existing.field === warning.field
      )
    ) {
      warnings.push(warning);
    }
  }
  return { draft, confidence, warnings };
}
