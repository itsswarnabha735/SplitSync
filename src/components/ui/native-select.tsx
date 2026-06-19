import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div className="relative min-w-0">
      <select
        ref={ref}
        className={cn(
          "flex h-11 w-full min-w-0 appearance-none rounded-xl border border-input bg-card/80 px-3.5 py-2 pr-9 text-sm shadow-inner shadow-foreground/[0.02] ring-offset-background transition-colors focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
});
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
