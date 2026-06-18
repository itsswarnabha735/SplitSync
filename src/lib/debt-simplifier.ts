import {
  DebtOverview,
  MemberBalanceInfo,
  netBalance,
} from "./models";

/**
 * Minimizes interpersonal debt using the greedy approach from the Android app's
 * `DebtSimplifier.kt`. Balances are grouped by currency; within each currency we
 * repeatedly settle the largest debtor against the largest creditor.
 */
export function simplifyDebts(balances: MemberBalanceInfo[]): DebtOverview[] {
  const grouped = new Map<string, MemberBalanceInfo[]>();
  for (const b of balances) {
    const list = grouped.get(b.currency) ?? [];
    list.push(b);
    grouped.set(b.currency, list);
  }

  const allTransactions: DebtOverview[] = [];
  const epsilon = 0.01;

  for (const [currency, currencyBalances] of grouped) {
    const debtors = currencyBalances
      .filter((b) => netBalance(b) < -epsilon)
      .map((b) => ({ member: b.member, amount: Math.abs(netBalance(b)) }));

    const creditors = currencyBalances
      .filter((b) => netBalance(b) > epsilon)
      .map((b) => ({ member: b.member, amount: netBalance(b) }));

    while (debtors.length > 0 && creditors.length > 0) {
      // Sort both in descending order of magnitude.
      debtors.sort((a, b) => b.amount - a.amount);
      creditors.sort((a, b) => b.amount - a.amount);

      const debtor = debtors[0];
      const creditor = creditors[0];

      const settleAmount = Math.min(debtor.amount, creditor.amount);
      const roundedSettleAmount = Math.round(settleAmount * 100) / 100;

      if (roundedSettleAmount > 0) {
        allTransactions.push({
          debtor: debtor.member,
          creditor: creditor.member,
          amount: roundedSettleAmount,
          currency,
        });
      }

      const remainingDebtor = debtor.amount - settleAmount;
      const remainingCreditor = creditor.amount - settleAmount;

      if (remainingDebtor > epsilon) {
        debtor.amount = remainingDebtor;
      } else {
        debtors.shift();
      }

      if (remainingCreditor > epsilon) {
        creditor.amount = remainingCreditor;
      } else {
        creditors.shift();
      }
    }
  }

  return allTransactions;
}
