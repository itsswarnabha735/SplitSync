import { calculateGroupBalances } from "@/lib/balances";
import {
  DebtSimplificationError,
  simplifyDebts,
} from "@/lib/debt-simplifier";
import type {
  AdHocExpense,
  AdHocPayment,
  Expense,
  Friend,
  FriendWithBalance,
  Group,
  GroupMember,
  MemberBalanceInfo,
  Payment,
} from "@/lib/models";
import { netBalance } from "@/lib/models";
import type { StatementImportRow } from "@/lib/statement/import-adapter";
import type { SpendEntry } from "@/lib/spend-analysis";
import type {
  SettlementCopilotContext,
  SettlementCopilotWarning,
} from "@/lib/settlement-copilot";

export interface CopilotGroupSlice {
  members: GroupMember[];
  expenses: Expense[];
  payments: Payment[];
}

export function buildDashboardCopilotContext(params: {
  groups: Group[];
  groupSlices: Record<string, CopilotGroupSlice>;
  friends: Friend[];
  friendsWithBalances: FriendWithBalance[];
  dashboardTotals: {
    youAreOwed: Record<string, number>;
    youOwe: Record<string, number>;
    net: Record<string, number>;
  };
}): SettlementCopilotContext {
  const groupSummaries = params.groups.slice(0, 20).map((group) => {
    const slice = params.groupSlices[group.id] ?? {
      members: [],
      expenses: [],
      payments: [],
    };
    const balances = calculateGroupBalances(
      slice.members,
      slice.expenses,
      slice.payments
    );
    const warning = settlementWarning(group.name, balances);
    const debts = warning ? [] : simplifyDebts(balances);
    return {
      id: group.id,
      name: group.name,
      memberCount: slice.members.length || group.memberUids.length,
      expenseCount: slice.expenses.length,
      paymentCount: slice.payments.length,
      pendingSettlementCount: debts.length,
      totalByCurrency: sumByCurrency(slice.expenses),
      warning: warning?.message,
    };
  });

  const nonZeroFriends = params.friendsWithBalances
    .filter((balance) => Math.abs(balance.netBalance) > 0.01)
    .slice(0, 20)
    .map((balance) => ({
      id: balance.friend.id,
      name: balance.friend.name,
      currency: balance.currency,
      netBalance: roundMoney(balance.netBalance),
      direction: balance.netBalance > 0 ? "friend-owes-user" : "user-owes-friend",
    }));

  const warnings = groupSummaries
    .filter((group) => group.warning)
    .map<SettlementCopilotWarning>((group) => ({
      severity: "critical",
      message: `${group.name}: ${group.warning}`,
      entityId: group.id,
    }));

  return {
    title: "Dashboard",
    surface: "dashboard",
    summary: "Cross-group and friend settlement overview.",
    facts: [
      `${params.groups.length} groups are visible.`,
      `${nonZeroFriends.length} friend balances are currently non-zero.`,
      `Net currencies: ${Object.keys(params.dashboardTotals.net).join(", ") || "none"}.`,
    ],
    totals: params.dashboardTotals.net,
    groups: groupSummaries,
    friends: nonZeroFriends,
    warnings,
  };
}

export function buildGroupCopilotContext(params: {
  group: Group | null;
  members: GroupMember[];
  expenses: Expense[];
  payments: Payment[];
  balances: MemberBalanceInfo[];
  simplifiedDebts: ReturnType<typeof simplifyDebts>;
  settlementError: string | null;
  totalsByCurrency: Record<string, number>;
}): SettlementCopilotContext {
  const memberById = new Map(params.members.map((member) => [member.id, member]));
  const warnings = groupWarnings({
    members: params.members,
    expenses: params.expenses,
    payments: params.payments,
    settlementError: params.settlementError,
  });

  return {
    title: params.group?.name ?? "Group",
    surface: "group",
    summary: "Group settlement, member balances, expenses, and prior payments.",
    facts: [
      `${params.members.length} members are in this group.`,
      `${params.expenses.length} expenses and ${params.payments.length} settlements are in the ledger.`,
      `${params.simplifiedDebts.length} deterministic recommended payments are pending.`,
    ],
    totals: params.totalsByCurrency,
    groups: params.group
      ? [
          {
            id: params.group.id,
            name: params.group.name,
            description: params.group.description,
          },
        ]
      : [],
    balances: params.balances.map((balance) => ({
      id: balance.member.id,
      memberName: balance.member.name,
      currency: balance.currency,
      netBalance: roundMoney(netBalance(balance)),
      paid: roundMoney(balance.initialPaid),
      share: roundMoney(balance.initialOwe),
      sentSettlements: roundMoney(balance.paymentsMadeAsSender),
      receivedSettlements: roundMoney(balance.paymentsMadeAsReceiver),
    })),
    debts: params.simplifiedDebts.map((debt) => ({
      id: `${debt.debtor.id}:${debt.creditor.id}:${debt.currency}`,
      debtorId: debt.debtor.id,
      debtorName: debt.debtor.name,
      creditorId: debt.creditor.id,
      creditorName: debt.creditor.name,
      amount: roundMoney(debt.amount),
      currency: debt.currency,
    })),
    expenses: params.expenses.slice(0, 30).map((expense) => ({
      id: expense.id,
      description: expense.description,
      amount: roundMoney(expense.amount),
      currency: expense.currency,
      timestamp: expense.timestamp,
      paidByName: memberById.get(expense.paidById)?.name ?? "Unknown",
      splitType: expense.splitType,
      splitTotal: roundMoney(sumObject(expense.splits)),
      participantCount: Object.keys(expense.splits).length,
      imported: expense.sourceType === "statement-import",
      parserConfidence: expense.parserConfidence,
    })),
    payments: params.payments.slice(0, 30).map((payment) => ({
      id: payment.id,
      amount: roundMoney(payment.amount),
      currency: payment.currency,
      timestamp: payment.timestamp,
      fromName: memberById.get(payment.fromMemberId)?.name ?? "Unknown",
      toName: memberById.get(payment.toMemberId)?.name ?? "Unknown",
    })),
    warnings,
  };
}

export function buildFriendCopilotContext(params: {
  friend: Friend;
  balances: FriendWithBalance[];
  expenses: AdHocExpense[];
  payments: AdHocPayment[];
}): SettlementCopilotContext {
  const nonZero = params.balances.filter(
    (balance) => Math.abs(balance.netBalance) > 0.01
  );
  return {
    title: params.friend.name,
    surface: "friend",
    summary: "One-on-one friend balance and ledger summary.",
    facts: [
      `${params.expenses.length} one-on-one expenses are available.`,
      `${params.payments.length} one-on-one settlements are available.`,
      `${nonZero.length} currencies have non-zero balances.`,
    ],
    friends: [
      {
        id: params.friend.id,
        name: params.friend.name,
      },
    ],
    balances: params.balances.map((balance) => ({
      id: `${params.friend.id}:${balance.currency}`,
      friendId: params.friend.id,
      friendName: params.friend.name,
      currency: balance.currency,
      netBalance: roundMoney(balance.netBalance),
      direction: balance.netBalance > 0 ? "friend-owes-user" : "user-owes-friend",
    })),
    expenses: params.expenses.slice(0, 30).map((expense) => ({
      id: expense.id,
      description: expense.description,
      amount: roundMoney(expense.amount),
      currency: expense.currency,
      timestamp: expense.timestamp,
      splitType: expense.splitType,
      splitTotal: roundMoney(sumObject(expense.splits)),
      participantCount: Object.keys(expense.splits).length,
      imported: expense.sourceType === "statement-import",
      parserConfidence: expense.parserConfidence,
    })),
    payments: params.payments.slice(0, 30).map((payment) => ({
      id: payment.id,
      amount: roundMoney(payment.amount),
      currency: payment.currency,
      timestamp: payment.timestamp,
      direction:
        payment.fromFriendId === params.friend.id
          ? "friend-paid-user"
          : "user-paid-friend",
    })),
  };
}

export function buildImportReviewCopilotContext(params: {
  title: string;
  targetKind: "group" | "friend";
  currency: string;
  parserMode: string;
  selectedTotal: number;
  rows: StatementImportRow[];
}): SettlementCopilotContext {
  const warningRows = params.rows.filter((row) => row.warningFlags.length > 0);
  return {
    title: params.title,
    surface: "import-review",
    summary: "Statement import review rows before saving.",
    facts: [
      `${params.rows.length} rows were parsed.`,
      `${warningRows.length} rows have review warnings.`,
      `${params.selectedTotal.toFixed(2)} ${params.currency} is currently selected.`,
    ],
    totals: { [params.currency]: roundMoney(params.selectedTotal) },
    importRows: params.rows.slice(0, 60).map((row) => ({
      id: row.transactionFingerprint,
      vendor: row.vendor,
      date: row.date,
      amount: roundMoney(row.amount),
      currency: params.currency,
      type: row.type,
      category: row.category,
      selected: row.selected,
      selectable: row.selectable,
      confidence: row.confidence,
      warningFlags: row.warningFlags,
    })),
    warnings: warningRows.slice(0, 20).map((row) => ({
      severity: row.warningFlags.includes("duplicate-like") ? "review" : "info",
      message: `${row.vendor} has import warning(s): ${row.warningFlags.join(", ")}.`,
      entityId: row.transactionFingerprint,
    })),
  };
}

export function buildSpendCopilotContext(params: {
  entries: SpendEntry[];
  filteredEntries: SpendEntry[];
  outstandingNet: Record<string, number>;
}): SettlementCopilotContext {
  const reviewRows = params.entries.filter(
    (entry) => entry.origin === "imported" && entry.needsReview
  );
  const largest = [...params.filteredEntries]
    .sort((a, b) => b.myShare - a.myShare)
    .slice(0, 12);
  return {
    title: "Spend",
    surface: "spend",
    summary: "Personal spend, imported rows needing review, and outstanding net.",
    facts: [
      `${params.filteredEntries.length} spend entries match the current filters.`,
      `${reviewRows.length} imported entries need review.`,
      `Outstanding net currencies: ${Object.keys(params.outstandingNet).join(", ") || "none"}.`,
    ],
    totals: params.outstandingNet,
    expenses: largest.map((entry) => ({
      id: entry.id,
      description: entry.categoryName,
      scopeName: entry.scopeName,
      date: entry.date,
      amount: roundMoney(entry.myShare),
      fullAmount: roundMoney(entry.fullAmount),
      currency: entry.currency,
      source: entry.source,
      origin: entry.origin,
      paidByName: entry.paidByName,
      parserConfidence: entry.parserConfidence,
      needsReview: entry.needsReview,
    })),
    importRows: reviewRows.slice(0, 20).map((entry) => ({
      id: entry.id,
      vendor: entry.categoryName,
      scopeName: entry.scopeName,
      date: entry.date,
      amount: roundMoney(entry.myShare),
      currency: entry.currency,
      confidence: entry.parserConfidence,
      needsReview: entry.needsReview,
    })),
    warnings: reviewRows.slice(0, 20).map((entry) => ({
      severity: "review",
      message: `${entry.scopeName} has an imported ${entry.categoryName} row that needs review.`,
      entityId: entry.id,
    })),
  };
}

function groupWarnings(params: {
  members: GroupMember[];
  expenses: Expense[];
  payments: Payment[];
  settlementError: string | null;
}): SettlementCopilotWarning[] {
  const memberIds = new Set(params.members.map((member) => member.id));
  const warnings: SettlementCopilotWarning[] = [];
  if (params.settlementError) {
    warnings.push({ severity: "critical", message: params.settlementError });
  }

  for (const expense of params.expenses) {
    const splitTotal = sumObject(expense.splits);
    if (Math.round(splitTotal * 100) !== Math.round(expense.amount * 100)) {
      warnings.push({
        severity: "critical",
        message: `${expense.description} splits do not match the expense amount.`,
        entityId: expense.id,
      });
    }
    for (const memberId of Object.keys(expense.splits)) {
      if (!memberIds.has(memberId)) {
        warnings.push({
          severity: "critical",
          message: `${expense.description} includes an unknown member in its split map.`,
          entityId: expense.id,
        });
      }
    }
  }

  for (const payment of params.payments) {
    if (!memberIds.has(payment.fromMemberId) || !memberIds.has(payment.toMemberId)) {
      warnings.push({
        severity: "critical",
        message: "A settlement references an unknown group member.",
        entityId: payment.id,
      });
    }
  }

  return warnings;
}

function settlementWarning(
  groupName: string,
  balances: MemberBalanceInfo[]
): SettlementCopilotWarning | null {
  try {
    simplifyDebts(balances);
    return null;
  } catch (err) {
    if (err instanceof DebtSimplificationError) {
      return {
        severity: "critical",
        message: `${groupName} has unbalanced ${err.currency} ledger data.`,
      };
    }
    throw err;
  }
}

function sumByCurrency(expenses: Expense[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const expense of expenses) {
    totals[expense.currency] = roundMoney(
      (totals[expense.currency] ?? 0) + expense.amount
    );
  }
  return totals;
}

function sumObject(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
