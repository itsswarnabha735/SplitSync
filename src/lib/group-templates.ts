import type { GroupTemplate } from "@/lib/models";

export const GROUP_TEMPLATE_OPTIONS: Array<{
  value: GroupTemplate;
  label: string;
  description: string;
  defaultCurrency: string;
  settlementCurrency: string;
  travelMode: boolean;
}> = [
  {
    value: "custom",
    label: "Custom",
    description: "A flexible ledger with no preset assumptions.",
    defaultCurrency: "USD",
    settlementCurrency: "USD",
    travelMode: false,
  },
  {
    value: "trip",
    label: "Trip",
    description: "Travel-friendly ledger with FX notes and settlement currency.",
    defaultCurrency: "USD",
    settlementCurrency: "USD",
    travelMode: true,
  },
  {
    value: "flatmates",
    label: "Flatmates",
    description: "Recurring rent, utilities, groceries, and household supplies.",
    defaultCurrency: "USD",
    settlementCurrency: "USD",
    travelMode: false,
  },
  {
    value: "couple",
    label: "Couple",
    description: "Everyday shared spending with a simpler participant model.",
    defaultCurrency: "USD",
    settlementCurrency: "USD",
    travelMode: false,
  },
  {
    value: "office",
    label: "Office",
    description: "Lunches, events, reimbursements, and polite payment requests.",
    defaultCurrency: "USD",
    settlementCurrency: "USD",
    travelMode: false,
  },
  {
    value: "event",
    label: "Event",
    description: "One-off parties, workshops, and group activities.",
    defaultCurrency: "USD",
    settlementCurrency: "USD",
    travelMode: false,
  },
];

export function groupTemplateOption(value: GroupTemplate | undefined) {
  return (
    GROUP_TEMPLATE_OPTIONS.find((option) => option.value === value) ??
    GROUP_TEMPLATE_OPTIONS[0]
  );
}
