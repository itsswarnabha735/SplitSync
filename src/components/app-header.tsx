"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  actions?: React.ReactNode;
}

export function AppHeader({
  title,
  subtitle,
  showBack,
  onBack,
  actions,
}: AppHeaderProps) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 shadow-sm shadow-foreground/[0.03] backdrop-blur-xl">
      <div className="container flex h-16 items-center gap-3">
        {showBack && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack ?? (() => router.back())}
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black leading-tight text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="truncate text-xs font-medium text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          {actions}
        </div>
      </div>
    </header>
  );
}
