import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-primary/25 bg-card/65 px-5 py-14 text-center shadow-sm backdrop-blur-sm">
      <div className="brand-gradient surface-glow flex h-14 w-14 items-center justify-center rounded-2xl text-white">
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="font-bold">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
