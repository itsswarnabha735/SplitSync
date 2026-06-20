import {
  getExpenseCategory,
  isSpendCategorySlug,
  type ExpenseCategorySlug,
} from "@/lib/expense-categories";
import {
  canDeleteAdHocExpense,
  canDeleteGroupExpense,
  canEditAdHocExpense,
  canEditGroupExpense,
} from "@/lib/edit-permissions";
import type { AdHocExpense, Expense, Friend, Group, GroupMember, Payment } from "@/lib/models";
import { YOU_ID as SELF_ID } from "@/lib/models";

export interface SpendGroupSlice {
  members: GroupMember[];
  expenses: Expense[];
  payments: Payment[];
}

export type SpendEntrySource = "group" | "friend";
export type SpendEntryOrigin = "manual" | "imported";
export type SpendEditableTarget =
  | { kind: "groupExpense"; groupId: string; expenseId: string }
  | { kind: "adHocExpense"; expenseId: string };
export type SpendDeletableTarget = SpendEditableTarget;

export interface SpendEntry {
  id: string;
  source: SpendEntrySource;
  scopeId: string;
  scopeName: string;
  date: string;
  timestamp: number;
  currency: string;
  category: ExpenseCategorySlug;
  categoryName: string;
  fullAmount: number;
  myShare: number;
  paidUpfront: number;
  paidByName: string;
  paidByMe: boolean;
  origin: SpendEntryOrigin;
  parserConfidence?: number;
  needsReview: boolean;
  editableTarget?: SpendEditableTarget;
  deletableTarget?: SpendDeletableTarget;
}

export interface SpendFilters {
  startDate?: string;
  endDate?: string;
  currency?: string;
  category?: ExpenseCategorySlug | "all";
  source?: SpendEntrySource | "all";
  origin?: SpendEntryOrigin | "all";
  scopeId?: string;
}

export interface CurrencySpendSummary {
  mySpend: number;
  paidUpfront: number;
  othersPaidForMe: number;
  uncategorizedCount: number;
  importedNeedsReviewCount: number;
}

export interface SpendBreakdownRow {
  key: string;
  label: string;
  currency: string;
  amount: number;
}

export function deriveSpendEntries(params: {
  uid: string | null;
  groups: Group[];
  groupSlices: Record<string, SpendGroupSlice>;
  friends: Friend[];
  adHocExpenses: AdHocExpense[];
}): SpendEntry[] {
  const { uid, groups, groupSlices, friends, adHocExpenses } = params;
  const entries: SpendEntry[] = [];
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const friendById = new Map(friends.map((friend) => [friend.id, friend]));

  if (uid) {
    for (const [groupId, slice] of Object.entries(groupSlices)) {
      const group = groupById.get(groupId);
      const you = slice.members.find((member) => member.linkedUid === uid);
      if (!you) continue;
      const memberName = new Map(
        slice.members.map((member) => [
          member.id,
          member.id === you.id ? "You" : member.name,
        ])
      );

      for (const expense of slice.expenses) {
        const myShare = expense.splits[you.id] ?? 0;
        const paidByMe = expense.paidById === you.id;
        if (myShare <= 0 && !paidByMe) continue;
        const editable =
          group &&
          canEditGroupExpense({
            group,
            members: slice.members,
            expense,
            uid,
          });
        const deletable =
          group &&
          canDeleteGroupExpense({
            group,
            members: slice.members,
            expense,
            uid,
          });
        const target = {
          kind: "groupExpense" as const,
          groupId: expense.groupId,
          expenseId: expense.id,
        };
        entries.push(
          buildSpendEntry({
            id: `group:${expense.groupId}:${expense.id}`,
            source: "group",
            scopeId: expense.groupId,
            scopeName: group?.name ?? "Group",
            timestamp: expense.timestamp,
            currency: expense.currency,
            category: expense.category,
            fullAmount: expense.amount,
            myShare,
            paidUpfront: paidByMe ? expense.amount : 0,
            paidByName: memberName.get(expense.paidById) ?? "Unknown",
            paidByMe,
            origin: expense.sourceType === "statement-import" ? "imported" : "manual",
            parserConfidence: expense.parserConfidence,
            editableTarget: editable ? target : undefined,
            deletableTarget: deletable ? target : undefined,
          })
        );
      }
    }
  }

  for (const expense of adHocExpenses) {
    const paidByMe = expense.paidByFriendId === SELF_ID;
    const counterpartyId =
      expense.paidByFriendId === SELF_ID
        ? firstCounterpartyId(expense.splits)
        : expense.paidByFriendId;
    const friend = friendById.get(counterpartyId);
    const myShare = expense.splits[SELF_ID] ?? 0;
    if (myShare <= 0 && !paidByMe) continue;
    const editable = canEditAdHocExpense(expense, uid);
    const deletable = canDeleteAdHocExpense(expense, uid);
    const target = { kind: "adHocExpense" as const, expenseId: expense.id };
    entries.push(
      buildSpendEntry({
        id: `friend:${expense.id}`,
        source: "friend",
        scopeId: counterpartyId,
        scopeName: friend?.name ?? "Friend",
        timestamp: expense.timestamp,
        currency: expense.currency,
        category: expense.category,
        fullAmount: expense.amount,
        myShare,
        paidUpfront: paidByMe ? expense.amount : 0,
        paidByName: paidByMe ? "You" : friend?.name ?? "Friend",
        paidByMe,
        origin: expense.sourceType === "statement-import" ? "imported" : "manual",
        parserConfidence: expense.parserConfidence,
        editableTarget: editable ? target : undefined,
        deletableTarget: deletable ? target : undefined,
      })
    );
  }

  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

export function filterSpendEntries(
  entries: SpendEntry[],
  filters: SpendFilters
): SpendEntry[] {
  return entries.filter((entry) => {
    if (!isSpendCategorySlug(entry.category)) return false;
    if (filters.startDate && entry.date < filters.startDate) return false;
    if (filters.endDate && entry.date > filters.endDate) return false;
    if (filters.currency && entry.currency !== filters.currency) return false;
    if (
      filters.category &&
      filters.category !== "all" &&
      entry.category !== filters.category
    ) {
      return false;
    }
    if (filters.source && filters.source !== "all" && entry.source !== filters.source) {
      return false;
    }
    if (filters.origin && filters.origin !== "all" && entry.origin !== filters.origin) {
      return false;
    }
    if (filters.scopeId && entry.scopeId !== filters.scopeId) return false;
    return true;
  });
}

export function summarizeSpendByCurrency(
  entries: SpendEntry[]
): Record<string, CurrencySpendSummary> {
  const out: Record<string, CurrencySpendSummary> = {};
  for (const entry of entries) {
    const summary =
      out[entry.currency] ??
      (out[entry.currency] = {
        mySpend: 0,
        paidUpfront: 0,
        othersPaidForMe: 0,
        uncategorizedCount: 0,
        importedNeedsReviewCount: 0,
      });
    summary.mySpend += entry.myShare;
    summary.paidUpfront += entry.paidUpfront;
    if (!entry.paidByMe) summary.othersPaidForMe += entry.myShare;
    if (entry.category === "other") summary.uncategorizedCount += 1;
    if (entry.needsReview) summary.importedNeedsReviewCount += 1;
  }
  return out;
}

export function breakdownByCategory(entries: SpendEntry[]): SpendBreakdownRow[] {
  return breakdown(entries, (entry) => entry.category, (entry) => entry.categoryName);
}

export function breakdownByScope(entries: SpendEntry[]): SpendBreakdownRow[] {
  return breakdown(entries, (entry) => entry.scopeId, (entry) => entry.scopeName);
}

export function monthlySpendTrend(entries: SpendEntry[]): SpendBreakdownRow[] {
  return breakdown(
    entries,
    (entry) => entry.date.slice(0, 7),
    (entry) => entry.date.slice(0, 7)
  ).sort((a, b) => a.key.localeCompare(b.key));
}

function buildSpendEntry(params: {
  id: string;
  source: SpendEntrySource;
  scopeId: string;
  scopeName: string;
  timestamp: number;
  currency: string;
  category?: ExpenseCategorySlug;
  fullAmount: number;
  myShare: number;
  paidUpfront: number;
  paidByName: string;
  paidByMe: boolean;
  origin: SpendEntryOrigin;
  parserConfidence?: number;
  editableTarget?: SpendEditableTarget;
  deletableTarget?: SpendDeletableTarget;
}): SpendEntry {
  const category = params.category ?? "other";
  const categoryInfo = getExpenseCategory(category);
  return {
    ...params,
    date: timestampToDateKey(params.timestamp),
    category,
    categoryName: categoryInfo?.name ?? "Other",
    needsReview:
      params.origin === "imported" &&
      (category === "other" ||
        params.parserConfidence === undefined ||
        params.parserConfidence < 0.6),
  };
}

function breakdown(
  entries: SpendEntry[],
  keyFor: (entry: SpendEntry) => string,
  labelFor: (entry: SpendEntry) => string
): SpendBreakdownRow[] {
  const map = new Map<string, SpendBreakdownRow>();
  for (const entry of entries) {
    const key = `${keyFor(entry)}::${entry.currency}`;
    const existing = map.get(key);
    if (existing) {
      existing.amount += entry.myShare;
    } else {
      map.set(key, {
        key: keyFor(entry),
        label: labelFor(entry),
        currency: entry.currency,
        amount: entry.myShare,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

function firstCounterpartyId(splits: Record<string, number>): string {
  return Object.keys(splits).find((id) => id !== SELF_ID) ?? "";
}

function timestampToDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
