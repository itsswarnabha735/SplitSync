export const EXPENSE_CATEGORIES = [
  {
    slug: "food-dining",
    name: "Food & Dining",
    kind: "spend",
    color: "#f59e0b",
    keywords: [
      "restaurant",
      "cafe",
      "coffee",
      "swiggy",
      "zomato",
      "doordash",
      "uber eats",
      "starbucks",
      "mcdonald",
      "kfc",
      "pizza",
      "chipotle",
      "food",
      "dining",
    ],
    llmGuideline: "Restaurants, cafes, bars, food delivery, and meals.",
  },
  {
    slug: "groceries",
    name: "Groceries",
    kind: "spend",
    color: "#22c55e",
    keywords: [
      "grocery",
      "supermarket",
      "whole foods",
      "walmart",
      "costco",
      "bigbasket",
      "dmart",
      "instacart",
      "market",
      "fresh",
    ],
    llmGuideline: "Groceries, supermarkets, household staples, and provisions.",
  },
  {
    slug: "transport",
    name: "Transport",
    kind: "spend",
    color: "#38bdf8",
    keywords: [
      "uber",
      "ola",
      "lyft",
      "rapido",
      "metro",
      "rail",
      "parking",
      "toll",
      "taxi",
      "transit",
    ],
    llmGuideline: "Cabs, ride sharing, public transit, parking, tolls, and commute costs.",
  },
  {
    slug: "fuel",
    name: "Fuel",
    kind: "spend",
    color: "#64748b",
    keywords: ["shell", "bp", "exxon", "petrol", "diesel", "fuel", "gas station", "hpcl", "iocl", "bharat petroleum"],
    llmGuideline: "Petrol, diesel, charging, and gas station purchases.",
  },
  {
    slug: "shopping",
    name: "Shopping",
    kind: "spend",
    color: "#a855f7",
    keywords: ["amazon", "flipkart", "myntra", "target", "store", "shop", "retail", "apple.com", "reliance digital"],
    llmGuideline: "Retail purchases, ecommerce, clothing, electronics, and general shopping.",
  },
  {
    slug: "entertainment",
    name: "Entertainment",
    kind: "spend",
    color: "#ec4899",
    keywords: ["netflix", "spotify", "bookmyshow", "movie", "cinema", "prime video", "hotstar", "viacom", "concert"],
    llmGuideline: "Movies, events, music, streaming, games, and leisure.",
  },
  {
    slug: "utilities",
    name: "Utilities",
    kind: "spend",
    color: "#06b6d4",
    keywords: ["electric", "water", "gas bill", "airtel", "jio", "vodafone", "phone", "internet", "broadband", "recharge"],
    llmGuideline: "Electricity, water, phone, internet, recharges, and household bills.",
  },
  {
    slug: "travel",
    name: "Travel",
    kind: "spend",
    color: "#14b8a6",
    keywords: ["makemytrip", "airbnb", "hotel", "flight", "airline", "indigo", "vistara", "irctc", "booking.com", "travel"],
    llmGuideline: "Flights, hotels, train tickets, stays, and travel bookings.",
  },
  {
    slug: "health",
    name: "Health",
    kind: "spend",
    color: "#ef4444",
    keywords: ["pharmacy", "medical", "hospital", "clinic", "doctor", "apollo", "cvs", "health", "medicine"],
    llmGuideline: "Pharmacy, medical care, doctors, hospitals, insurance health claims.",
  },
  {
    slug: "housing",
    name: "Housing",
    kind: "spend",
    color: "#8b5cf6",
    keywords: ["rent", "maintenance", "housing", "society", "lease", "mortgage"],
    llmGuideline: "Rent, housing maintenance, mortgage, society charges, and home services.",
  },
  {
    slug: "investments",
    name: "Investments",
    kind: "spend",
    color: "#10b981",
    keywords: ["groww", "zerodha", "upstox", "mutual fund", "sip", "nse", "bse", "investment", "clearing corp"],
    llmGuideline: "Brokerage, SIPs, mutual funds, stocks, and investment transfers.",
  },
  {
    slug: "fees",
    name: "Fees",
    kind: "spend",
    color: "#f97316",
    keywords: ["fee", "charge", "penalty", "interest", "annual fee", "late fee", "finance charge"],
    llmGuideline: "Bank fees, card fees, late fees, penalties, and finance charges.",
  },
  {
    slug: "income",
    name: "Income",
    kind: "income",
    color: "#16a34a",
    keywords: ["salary", "payroll", "income", "dividend", "interest earned", "neft"],
    llmGuideline: "Salary, payroll, dividends, incoming deposits, and interest income.",
  },
  {
    slug: "transfers",
    name: "Transfers",
    kind: "money-movement",
    color: "#6b7280",
    keywords: ["transfer", "upi", "neft", "imps", "rtgs", "payment received", "refund"],
    llmGuideline: "Transfers, repayments, refunds, and money movement that is not spending.",
  },
  {
    slug: "other",
    name: "Other",
    kind: "spend",
    color: "#71717a",
    keywords: [],
    llmGuideline: "Use only when no more specific category fits.",
  },
] as const;

export type ExpenseCategorySlug = (typeof EXPENSE_CATEGORIES)[number]["slug"];
export type ExpenseCategoryKind = (typeof EXPENSE_CATEGORIES)[number]["kind"];

export interface ExpenseCategory {
  slug: ExpenseCategorySlug;
  name: string;
  kind: ExpenseCategoryKind;
  color: string;
}

const CATEGORY_BY_SLUG = new Map(
  EXPENSE_CATEGORIES.map((category) => [category.slug, category])
);

const CATEGORY_BY_NAME = new Map(
  EXPENSE_CATEGORIES.map((category) => [normalizeCategoryName(category.name), category.slug])
);

const CATEGORY_ALIASES: Record<string, ExpenseCategorySlug> = {
  dining: "food-dining",
  food: "food-dining",
  restaurants: "food-dining",
  grocery: "groceries",
  supermarket: "groceries",
  commute: "transport",
  transportation: "transport",
  gas: "fuel",
  petrol: "fuel",
  entertainment: "entertainment",
  subscriptions: "entertainment",
  bills: "utilities",
  telecom: "utilities",
  medical: "health",
  healthcare: "health",
  rent: "housing",
  home: "housing",
  investment: "investments",
  fees: "fees",
  bank: "fees",
  salary: "income",
  credit: "income",
  refund: "transfers",
  transfer: "transfers",
};

export function getExpenseCategory(slug: string | null | undefined) {
  return slug ? CATEGORY_BY_SLUG.get(slug as ExpenseCategorySlug) ?? null : null;
}

export function getExpenseCategoryKind(slug: string | null | undefined) {
  return getExpenseCategory(slug)?.kind ?? "spend";
}

export function isExpenseCategorySlug(value: unknown): value is ExpenseCategorySlug {
  return typeof value === "string" && CATEGORY_BY_SLUG.has(value as ExpenseCategorySlug);
}

export function isSpendCategorySlug(value: string | null | undefined): boolean {
  return getExpenseCategoryKind(value) === "spend";
}

export function resolveExpenseCategorySlug(
  categoryNameOrSlug: string | null | undefined
): ExpenseCategorySlug {
  if (!categoryNameOrSlug) return "other";
  const normalized = normalizeCategoryName(categoryNameOrSlug);
  if (CATEGORY_BY_SLUG.has(normalized as ExpenseCategorySlug)) {
    return normalized as ExpenseCategorySlug;
  }
  return CATEGORY_BY_NAME.get(normalized) ?? CATEGORY_ALIASES[normalized] ?? "other";
}

export function suggestExpenseCategory(vendor: string): {
  categoryName: string;
  categorySlug: ExpenseCategorySlug;
  confidence: number;
  matchedKeyword: string;
} | null {
  const normalizedVendor = vendor.toLowerCase();
  if (!normalizedVendor.trim()) return null;

  let best:
    | {
        categoryName: string;
        categorySlug: ExpenseCategorySlug;
        confidence: number;
        matchedKeyword: string;
      }
    | null = null;

  for (const category of EXPENSE_CATEGORIES) {
    for (const keyword of category.keywords) {
      const normalizedKeyword = keyword.toLowerCase();
      if (!normalizedVendor.includes(normalizedKeyword)) continue;
      const confidence = Math.min(
        0.95,
        0.58 + normalizedKeyword.length / Math.max(normalizedVendor.length, 1)
      );
      if (!best || confidence > best.confidence) {
        best = {
          categoryName: category.name,
          categorySlug: category.slug,
          confidence,
          matchedKeyword: keyword,
        };
      }
    }
  }

  return best;
}

export function buildLLMCategoryBlock(): string {
  const lines = EXPENSE_CATEGORIES.map(
    (category) => `- ${category.name}: ${category.llmGuideline}`
  );
  return `Allowed categories:\n${lines.join("\n")}\nIf uncertain, choose Other.`;
}

function normalizeCategoryName(value: string): string {
  return value.trim().toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ");
}
