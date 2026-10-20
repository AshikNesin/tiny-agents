import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, LogOut, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@groot/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { useAuthStore } from "../store/auth";
import { useShellConfig } from "../lib/shell-config";
import { ThemeMenu } from "./Layout";
import { cn } from "@groot/ui/lib/utils";

/**
 * Grok-style profile circle: initials on a ring, opening the app nav,
 * theme, and account menu. Replaces the old sidebar's user footer.
 * Nav rows come from ShellConfig.nav (the app owns its routes).
 */
export function ProfileButton({ className }: { className?: string }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const { nav } = useShellConfig();
  const initial = (user?.name?.[0] ?? user?.email?.[0] ?? "?").toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account and navigation"
          className={cn(
            "border-input text-muted-foreground hover:text-foreground flex size-10 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-transform active:scale-95",
            className,
          )}
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {(nav ?? []).map((item) => (
          <DropdownMenuItem key={item.to} onSelect={() => navigate(item.to)}>
            {item.icon ? <item.icon className="size-4" /> : null}
            {item.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <ThemeMenu />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            void logout();
            navigate("/login");
          }}
        >
          <LogOut className="size-4" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Grok-style floating top bar for secondary pages: circular back to the
 * app home, the page title, actions, and the profile circle. One chrome
 * across the whole app — no sidebar, no mobile bar.
 */
export function TopBar({
  title,
  children,
  backTo,
}: {
  title: string;
  children?: ReactNode;
  backTo?: string;
}) {
  const navigate = useNavigate();
  const { pageChrome } = useShellConfig();
  const sidebarChrome = pageChrome === "sidebar";
  return (
    <header className="flex w-full items-center gap-3 pt-4 pb-2">
      <Button
        variant="outline"
        size="icon"
        className={cn("rounded-full", sidebarChrome && "md:hidden")}
        onClick={() => navigate(backTo ?? "/chats")}
        aria-label="Back"
      >
        <ArrowLeft className="size-5" />
      </Button>
      <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
      {children}
      <ProfileButton className={cn(sidebarChrome && "md:hidden")} />
    </header>
  );
}

/** Settings stays reachable from the profile menu even without nav rows. */
export function SettingsNavIcon() {
  return <SettingsIcon className="size-4" />;
}
