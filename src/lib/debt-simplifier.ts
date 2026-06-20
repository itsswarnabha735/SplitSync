import {
  DebtOverview,
  GroupMember,
  MemberBalanceInfo,
  netBalance,
} from "./models";

const CENTS_PER_UNIT = 100;
const EXACT_PARTITION_LIMIT = 18;

type BalanceEntry = {
  member: GroupMember;
  cents: number;
};

export class DebtSimplificationError extends Error {
  constructor(
    public readonly currency: string,
    public readonly imbalance: number
  ) {
    super(
      `${currency} balances do not balance; ledger is off by ${imbalance.toFixed(
        2
      )}.`
    );
    this.name = "DebtSimplificationError";
  }
}

/**
 * Minimizes interpersonal debt by currency. For normal group sizes we solve the
 * exact zero-sum partition first, which minimizes the number of transfers. Very
 * large groups fall back to the linear greedy matcher to avoid exponential work
 * in the render path.
 */
export function simplifyDebts(balances: MemberBalanceInfo[]): DebtOverview[] {
  const grouped = new Map<string, MemberBalanceInfo[]>();
  for (const b of balances) {
    const list = grouped.get(b.currency) ?? [];
    list.push(b);
    grouped.set(b.currency, list);
  }

  const allTransactions: DebtOverview[] = [];

  for (const [currency, currencyBalances] of grouped) {
    const entries = currencyBalances
      .map((b) => ({ member: b.member, cents: toCents(netBalance(b)) }))
      .filter((entry) => entry.cents !== 0)
      .sort(compareEntries);

    const totalCents = entries.reduce((sum, entry) => sum + entry.cents, 0);
    if (totalCents !== 0) {
      throw new DebtSimplificationError(
        currency,
        centsToMoney(totalCents)
      );
    }

    if (entries.length <= EXACT_PARTITION_LIMIT) {
      const masks = findBestZeroSumPartition(entries.map((entry) => entry.cents));
      for (const mask of masks) {
        allTransactions.push(...settleSubset(entries, mask, currency));
      }
    } else {
      allTransactions.push(...settleEntries(entries, currency));
    }
  }

  return allTransactions;
}

function findBestZeroSumPartition(cents: number[]): number[] {
  const full = (1 << cents.length) - 1;
  const sums = new Array<number>(full + 1).fill(0);
  for (let mask = 1; mask <= full; mask++) {
    const bit = mask & -mask;
    const index = 31 - Math.clz32(bit);
    sums[mask] = sums[mask ^ bit] + cents[index];
  }

  const memo = new Map<number, number[]>();
  const solve = (mask: number): number[] => {
    if (mask === 0) return [];
    const cached = memo.get(mask);
    if (cached) return cached;

    const firstBit = mask & -mask;
    let best = [mask];

    for (let subset = mask; subset > 0; subset = (subset - 1) & mask) {
      if ((subset & firstBit) === 0 || sums[subset] !== 0) continue;
      const candidate = [subset, ...solve(mask ^ subset)];
      if (isBetterPartition(candidate, best)) {
        best = candidate;
      }
    }

    memo.set(mask, best);
    return best;
  };

  return solve(full);
}

function settleSubset(
  entries: BalanceEntry[],
  mask: number,
  currency: string
): DebtOverview[] {
  return settleEntries(
    entries.filter((_, index) => (mask & (1 << index)) !== 0),
    currency
  );
}

function settleEntries(
  entries: BalanceEntry[],
  currency: string
): DebtOverview[] {
  const debtors = entries
    .filter((entry) => entry.cents < 0)
    .map((entry) => ({ member: entry.member, cents: -entry.cents }))
    .sort(compareWorkingBalances);

  const creditors = entries
    .filter((entry) => entry.cents > 0)
    .map((entry) => ({ member: entry.member, cents: entry.cents }))
    .sort(compareWorkingBalances);

  const transactions: DebtOverview[] = [];

  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(compareWorkingBalances);
    creditors.sort(compareWorkingBalances);

    const debtor = debtors[0];
    const creditor = creditors[0];
    const settleCents = Math.min(debtor.cents, creditor.cents);

    transactions.push({
      debtor: debtor.member,
      creditor: creditor.member,
      amount: centsToMoney(settleCents),
      currency,
    });

    debtor.cents -= settleCents;
    creditor.cents -= settleCents;

    if (debtor.cents === 0) debtors.shift();
    if (creditor.cents === 0) creditors.shift();
  }

  return transactions;
}

function compareEntries(a: BalanceEntry, b: BalanceEntry): number {
  return (
    Math.abs(b.cents) - Math.abs(a.cents) ||
    b.cents - a.cents ||
    a.member.id.localeCompare(b.member.id)
  );
}

function compareWorkingBalances(
  a: { member: GroupMember; cents: number },
  b: { member: GroupMember; cents: number }
): number {
  return b.cents - a.cents || a.member.id.localeCompare(b.member.id);
}

function isBetterPartition(candidate: number[], current: number[]): boolean {
  if (candidate.length !== current.length) {
    return candidate.length > current.length;
  }

  const candidateFirstSize = bitCount(candidate[0] ?? 0);
  const currentFirstSize = bitCount(current[0] ?? 0);
  if (candidateFirstSize !== currentFirstSize) {
    return candidateFirstSize < currentFirstSize;
  }

  return candidate.join(",") < current.join(",");
}

function bitCount(mask: number): number {
  let count = 0;
  for (let next = mask; next !== 0; next &= next - 1) count += 1;
  return count;
}

function toCents(amount: number): number {
  return Math.round(amount * CENTS_PER_UNIT);
}

function centsToMoney(cents: number): number {
  return cents / CENTS_PER_UNIT;
}
