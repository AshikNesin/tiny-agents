import { useEffect, useRef } from "react";
import { Link, matchPath, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronsUpDown,
  LogOut,
  MessageSquareHeart,
  PanelLeftOpen,
  Search,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { cn } from "@groot/ui/lib/utils";
import { useAuthStore } from "@groot/shell/store/auth";
import { toast } from "sonner";
import { useCommandPaletteStore } from "@groot/shell/store/command-palette";
import { useBotsStore } from "../../store/bots";
import { useUiStore } from "../../store/ui";
import { PRIMARY_NAV, SECONDARY_NAV, guestNav } from "./nav";
import { useIsGuest } from "../../store/people";
import { BotRail, BotsSection } from "./BotsSection";
import { BrandMark } from "./BrandMark";
import { ModeSwitch, SIDEBAR_ICON, SIDEBAR_ROW, SidebarFold, useCodeAvailable } from "./ModeSwitch";
import { openFeedback } from "../../lib/feedback";

const SEARCH_SHORTCUT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K";

function NavRow({
  icon: Icon,
  label,
  rail,
  active,
  hint,
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  rail: boolean;
  active?: boolean;
  hint?: string;
} & ({ to: string; onClick?: () => void } | { onClick: () => void; to?: undefined })) {
  const className = cn(
    SIDEBAR_ROW,
    rail && "md:size-9 md:justify-center md:px-0",
    active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
  );
  const content = (
    <>
      <Icon className="text-muted-foreground size-4 shrink-0" />
      <span className={cn("truncate", rail && "md:hidden")}>{label}</span>
      {hint ? (
        <span
          aria-hidden="true"
          className={cn("text-muted-foreground ml-auto text-xs max-md:hidden", rail && "md:hidden")}
        >
          {hint}
        </span>
      ) : null}
    </>
  );
  if (rest.to !== undefined) {
    return (
      <Link
        to={rest.to}
        onClick={rest.onClick}
        title={rail ? label : undefined}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={className}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={rest.onClick}
      title={rail ? label : undefined}
      aria-label={label}
      className={className}
    >
      {content}
    </button>
  );
}

export function AppSidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const bots = useBotsStore((s) => s.bots);
  const collapsed = useUiStore((s) => s.collapsed);
  const setCollapsed = useUiStore((s) => s.setCollapsed);
  const mobileOpen = useUiStore((s) => s.mobileOpen);
  const setMobileOpen = useUiStore((s) => s.setMobileOpen);
  const toggleCommandPalette = useCommandPaletteStore((s) => s.toggle);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const guest = useIsGuest();
  const primaryNav = guest ? guestNav(PRIMARY_NAV) : PRIMARY_NAV;
  const secondaryNav = guest ? [] : SECONDARY_NAV;

  const feedbackRequested = useRef(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "b") return;
      event.preventDefault();
      setCollapsed(!useUiStore.getState().collapsed);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCollapsed]);
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  const codeAvailable = useCodeAvailable();
  const inMenuPage = [...SECONDARY_NAV.map((item) => item.to), "/settings"].some(isActive);
  const activeBotId = matchPath("/chats/:botId", pathname)?.params.botId ?? null;
  const rail = collapsed;
  const closeDrawer = () => setMobileOpen(false);
  const accountName = user?.name?.trim() || user?.email?.toLowerCase() || "Account";
  const initial = (user?.name?.[0] ?? user?.email?.[0] ?? "?").toUpperCase();

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={closeDrawer}
          aria-hidden
        />
      )}
      <aside
        aria-label="Sidebar"
        className={cn(
          "group/sidebar bg-sidebar text-sidebar-foreground border-sidebar-border fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r-[0.5px] transition-transform duration-200 ease-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "md:static md:z-auto md:translate-x-0 md:transition-none",
          rail ? "md:w-16" : "md:w-68",
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-1 px-3",
            rail && "md:h-auto md:flex-col-reverse md:gap-2 md:py-3",
          )}
        >
          <Link
            to="/chats"
            onClick={closeDrawer}
            aria-label="tiny-agents"
            className={cn(
              "text-foreground hover:bg-sidebar-accent mr-auto flex size-8 items-center justify-center rounded-xl",
              rail && "md:hidden",
            )}
          >
            <BrandMark className="size-5" />
          </Link>
          {codeAvailable && <ModeSwitch vertical={rail} onNavigate={closeDrawer} />}
          {rail && (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="Expand sidebar"
              title="Expand sidebar (⌘B)"
              className={cn(SIDEBAR_ICON, "hidden md:flex")}
            >
              <PanelLeftOpen className="size-4" />
            </button>
          )}
        </div>

        <nav
          aria-label="Primary"
          className={cn("space-y-0.5 px-2.5 pb-2", rail && "md:flex md:flex-col md:items-center")}
        >
          <NavRow
            icon={Search}
            label="Search"
            rail={rail}
            hint={SEARCH_SHORTCUT}
            onClick={() => {
              closeDrawer();
              toggleCommandPalette();
            }}
          />
          {primaryNav.map((item) => (
            <NavRow
              key={item.to}
              icon={item.icon}
              label={item.label}
              rail={rail}
              to={item.to}
              active={isActive(item.to)}
              onClick={closeDrawer}
            />
          ))}
        </nav>

        <div className={cn("min-h-0 flex-1 overflow-y-auto pt-2", rail && "md:hidden")}>
          <BotsSection bots={bots} activeId={activeBotId} onNavigate={closeDrawer} />
        </div>
        {rail && (
          <div className="hidden min-h-0 flex-1 overflow-y-auto md:block">
            <BotRail bots={bots} activeId={activeBotId} />
          </div>
        )}

        <div className={cn("flex shrink-0 items-center gap-1 p-2.5", rail && "md:justify-center")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Account and navigation"
                title={rail ? accountName : undefined}
                className={cn(
                  "flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-1.5 text-left text-sm outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
                  inMenuPage ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
                  rail && "md:size-10 md:flex-none md:justify-center md:px-0",
                )}
              >
                <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                  {initial}
                </span>
                <span className={cn("min-w-0 flex-1 truncate", rail && "md:hidden")}>
                  {accountName}
                </span>
                <ChevronsUpDown
                  className={cn("text-muted-foreground size-4 shrink-0", rail && "md:hidden")}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              className="w-56"
              onCloseAutoFocus={(e) => {
                if (!feedbackRequested.current) return;
                feedbackRequested.current = false;
                e.preventDefault();
                openFeedback();
              }}
            >
              <DropdownMenuItem
                onSelect={() => {
                  void logout();
                  toast.success("Signed out", { description: "You have been logged out safely." });
                  navigate("/login");
                }}
              >
                <LogOut className="size-4" /> Log out
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {[...secondaryNav, { label: "Settings", icon: SettingsIcon, to: "/settings" }].map(
                (item) => (
                  <DropdownMenuItem
                    key={item.to}
                    onSelect={() => {
                      closeDrawer();
                      navigate(item.to);
                    }}
                    aria-current={isActive(item.to) ? "page" : undefined}
                    className={cn(isActive(item.to) && "bg-accent")}
                  >
                    <item.icon className="size-4" /> {item.label}
                  </DropdownMenuItem>
                ),
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  closeDrawer();
                  feedbackRequested.current = true;
                }}
              >
                <MessageSquareHeart className="size-4" /> Send feedback
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {!rail && <SidebarFold label="Collapse sidebar" onClick={() => setCollapsed(true)} />}
        </div>
      </aside>
    </>
  );
}
