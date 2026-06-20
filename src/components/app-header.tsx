"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { ArrowLeft, Settings as SettingsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";
import { SettlementCopilotButton } from "@/components/settlement-copilot";

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
  const pathname = usePathname();
  const onSettingsPage = pathname === "/settings";

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 shadow-sm shadow-foreground/[0.03] backdrop-blur-xl">
      <div className="container flex min-h-16 items-center gap-2 py-2 sm:h-16 sm:gap-3 sm:py-0">
        {showBack && (
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 sm:h-10 sm:w-10"
            onClick={onBack ?? (() => router.back())}
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="min-w-0 flex-1 pr-1">
          <h1 className="truncate text-base font-black leading-tight text-foreground sm:text-lg">
            {title}
          </h1>
          {subtitle && (
            <p className="truncate text-xs font-medium text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <SettlementCopilotButton
            label="Copilot"
            buttonVariant="outline"
            className="h-11 w-11 rounded-xl p-0 sm:h-9 sm:w-auto sm:px-3"
            labelClassName="sr-only sm:not-sr-only"
          />
          <NotificationBell />
          {!onSettingsPage && (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-11 w-11 sm:h-10 sm:w-10"
              aria-label="Settings"
            >
              <Link href="/settings">
                <SettingsIcon className="h-5 w-5" />
              </Link>
            </Button>
          )}
          {actions}
        </div>
      </div>
    </header>
  );
}
