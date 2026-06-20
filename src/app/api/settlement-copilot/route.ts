import { NextRequest, NextResponse } from "next/server";

import {
  buildLocalSettlementCopilotResponse,
  SETTLEMENT_COPILOT_SUGGESTION_TYPES,
  validateSettlementCopilotRequest,
  validateSettlementCopilotResponse,
  type SettlementCopilotRequest,
} from "@/lib/settlement-copilot";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const ROUTE_TIMEOUT_MS = 30_000;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const validation = validateSettlementCopilotRequest(await request.json());
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const copilotRequest = validation.request;
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(withFallbackWarning(copilotRequest));
    }

    const model =
      process.env.SETTLEMENT_COPILOT_MODEL ||
      process.env.GOOGLE_GEMINI_MODEL ||
      DEFAULT_MODEL;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildSettlementCopilotPrompt(copilotRequest) }] }],
          generationConfig: {
            temperature: 0.05,
            topP: 0.8,
            maxOutputTokens: 4096,
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
      logCopilotResult(copilotRequest.contextType, startedAt, false, "fallback");
      return NextResponse.json(withFallbackWarning(copilotRequest));
    }

    const geminiData = await geminiResponse.json();
    const responseText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!responseText) {
      logCopilotResult(copilotRequest.contextType, startedAt, false, "empty");
      return NextResponse.json(withFallbackWarning(copilotRequest));
    }

    try {
      const parsed = JSON.parse(stripCodeFence(responseText));
      const normalized = validateSettlementCopilotResponse(
        parsed,
        copilotRequest.context
      );
      logCopilotResult(
        copilotRequest.contextType,
        startedAt,
        true,
        `warnings:${normalized.warnings.length}`
      );
      return NextResponse.json(normalized);
    } catch {
      logCopilotResult(
        copilotRequest.contextType,
        startedAt,
        false,
        "invalid-json"
      );
      return NextResponse.json(
        {
          error: "Copilot could not safely answer this. Try a narrower question.",
        },
        { status: 422 }
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      return NextResponse.json(
        { error: "Settlement Copilot timed out." },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: "Could not ask Settlement Copilot." },
      { status: 500 }
    );
  }
}

function buildSettlementCopilotPrompt(request: SettlementCopilotRequest): string {
  return `You are SplitSync's AI Settlement Copilot. Help the user understand and review settlement data, but never replace deterministic ledger math.

Return ONLY valid JSON. Do not include markdown, explanations outside JSON, code fences, or unknown entity IDs.

Critical rules:
1. Draft-only: never claim you recorded, edited, deleted, sent, reminded, paid, or opened anything.
2. Deterministic math wins: balances, recommended debts, totals, and warnings in the context are authoritative.
3. Use only IDs and values present in the context. Do not invent expenses, members, payments, currencies, amounts, or dates.
4. If data is incomplete or malformed, say so clearly and require review.
5. Shareable summaries and reminders must be neutral, concise, and manually copyable.
6. Suggestions may only use these types: ${SETTLEMENT_COPILOT_SUGGESTION_TYPES.join(", ")}.
7. Never include bank details, UPI IDs, account numbers, phone numbers, emails, auth IDs, or hidden metadata.
8. Put critical deterministic issues above narrative explanation.

Request context type: ${request.contextType}
Locale: ${request.locale}
Timezone: ${request.timezone}
User prompt: ${request.userPrompt}

Sanitized context:
${JSON.stringify(request.context, null, 2)}

Return this exact shape:
{
  "answer": "Short answer in one or two sentences.",
  "sections": [
    {"title": "What this means", "body": "Concise explanation."}
  ],
  "suggestions": [
    {
      "type": "copy-summary",
      "title": "Shareable summary",
      "body": "Draft-only suggestion.",
      "copyText": "Optional text the user may copy manually."
    }
  ],
  "warnings": [
    {"severity": "review", "message": "Review this item.", "entityId": "known-id"}
  ],
  "entityRefs": [
    {"type": "expense", "id": "known-id", "label": "Dinner"}
  ],
  "confidence": 0.8,
  "requiresReview": true
}`;
}

function withFallbackWarning(request: SettlementCopilotRequest) {
  const fallback = buildLocalSettlementCopilotResponse(request);
  return {
    ...fallback,
    warnings: [
      ...fallback.warnings,
      {
        severity: "info",
        message:
          "AI is unavailable, so SplitSync used a deterministic local copilot summary.",
      },
    ],
  };
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/gm, "")
    .replace(/\n?```\s*$/gm, "")
    .trim();
}

function logCopilotResult(
  contextType: string,
  startedAt: number,
  ok: boolean,
  detail: string
) {
  console.info("settlement-copilot", {
    contextType,
    ok,
    detail,
    latencyMs: Date.now() - startedAt,
  });
}
