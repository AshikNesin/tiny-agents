import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, LogOut, Menu, Settings as SettingsIcon } from "lucide-react";
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
  actions,
  subtitle,
  backTo,
}: {
  title: string;
  /** Inline after the title (e.g. a status badge). */
  children?: ReactNode;
  /**
   * Page actions. They close the title row on desktop; on phones they wrap
   * to a row of their own under the subtitle, so the page reads title,
   * what it is, then what you can do (DOM order matches on both).
   */
  actions?: ReactNode;
  /** Breadcrumb and description, under the title row. */
  subtitle?: ReactNode;
  /** A parent page: phones show a back button to it instead of the menu. */
  backTo?: string;
}) {
  const navigate = useNavigate();
  const { pageChrome, openNav } = useShellConfig();
  const sidebarChrome = pageChrome === "sidebar";
  const menuChrome = sidebarChrome && !!openNav;
  return (
    <header
      className={cn(
        "flex w-full flex-wrap items-center gap-3 pt-4 pb-2",
        sidebarChrome && "md:pt-10",
      )}
    >
      {menuChrome && !backTo ? (
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 md:hidden"
          onClick={openNav}
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </Button>
      ) : (
        <Button
          variant="outline"
          size="icon"
          className={cn("rounded-full", sidebarChrome && "md:hidden")}
          onClick={() => navigate(backTo ?? "/chats")}
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </Button>
      )}
      <h1
        className={cn(
          "min-w-0 flex-1 truncate text-lg font-semibold",
          // Tall as the action buttons, so the title sits at the same height
          // on every page, with or without actions.
          sidebarChrome && "md:text-2xl md:leading-9",
        )}
      >
        {title}
      </h1>
      {children}
      {!menuChrome && <ProfileButton className={cn(sidebarChrome && "md:hidden")} />}
      {subtitle && <div className="w-full md:order-last">{subtitle}</div>}
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:flex-nowrap">
          {actions}
        </div>
      )}
    </header>
  );
}

/** Settings stays reachable from the profile menu even without nav rows. */
export function SettingsNavIcon() {
  return <SettingsIcon className="size-4" />;
}
