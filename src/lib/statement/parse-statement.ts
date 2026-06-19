import { llmStatementParser } from "./llm-statement-parser";
import { statementParser } from "./statement-parser";
import { preprocessStatementText } from "./statement-preprocessor";
import type { StatementParseResult, StatementParserOptions } from "./types";

export async function parseStatementWithLLMFallback(
  text: string,
  options: StatementParserOptions & {
    forceLLM?: boolean;
    regexOnly?: boolean;
  } = {}
): Promise<StatementParseResult> {
  const preprocessedText = preprocessStatementText(text);
  let regexResult = statementParser.parseStatement(preprocessedText, options);

  if (regexResult.transactions.length === 0 && preprocessedText !== text) {
    const rawRegexResult = statementParser.parseStatement(text, options);
    if (rawRegexResult.transactions.length > 0) {
      regexResult = rawRegexResult;
    }
  }

  return llmStatementParser.parseWithLLMFirst(preprocessedText, regexResult, {
    minRegexConfidence: options.minConfidence ?? 0.5,
    minRegexTransactions: 3,
    forceLLM: options.forceLLM ?? true,
    minExpectedTransactions: Math.max(3, regexResult.transactions.length),
    regexOnly: options.regexOnly,
  });
}
