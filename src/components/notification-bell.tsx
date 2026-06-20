"use client";

import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";

import { formatMoney } from "@/lib/currency";
import { useNotifications } from "@/hooks/use-notifications";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function timeAgo(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function NotificationBell() {
  const router = useRouter();
  const { notifications, unreadCount, markRead, markAllRead } =
    useNotifications();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-11 w-11 sm:h-10 sm:w-10"
          aria-label={
            unreadCount > 0
              ? `${unreadCount} unread notifications`
              : "Notifications"
          }
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-black text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))]">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
          <div>
            <p className="text-sm font-black">Notifications</p>
            <p className="text-xs text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0}
            onClick={(event) => {
              event.preventDefault();
              void markAllRead();
            }}
          >
            <CheckCheck className="h-4 w-4" />
            Mark read
          </Button>
        </div>
        <div className="max-h-[26rem] overflow-y-auto py-1">
          {notifications.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No notifications yet.
            </div>
          ) : (
            notifications.map((n) => {
              const amount =
                n.source.amount && n.source.currency
                  ? formatMoney(n.source.amount, n.source.currency)
                  : null;
              const unread = !n.readAt;
              return (
                <DropdownMenuItem
                  key={n.id}
                  className="items-start gap-3 whitespace-normal px-3 py-3"
                  onSelect={(event) => {
                    event.preventDefault();
                    void markRead(n.id);
                    router.push(n.targetUrl || "/dashboard");
                  }}
                >
                  <span
                    className={
                      unread
                        ? "mt-1 h-2 w-2 shrink-0 rounded-full bg-primary"
                        : "mt-1 h-2 w-2 shrink-0 rounded-full bg-muted"
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{n.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {n.body}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-2 text-[11px] font-bold text-muted-foreground">
                      <span>{timeAgo(n.createdAt)}</span>
                      {amount && <span>{amount}</span>}
                      {n.source.tags?.includes("large_expense") && (
                        <span className="text-destructive">Large expense</span>
                      )}
                    </span>
                  </span>
                </DropdownMenuItem>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
