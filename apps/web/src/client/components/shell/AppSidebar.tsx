import { useRef } from "react";
import { Link, matchPath, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronsUpDown,
  LogOut,
  MessageSquareHeart,
  PanelLeftClose,
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
import { unreadCount, useCodeStore } from "../../store/code";
import { PRIMARY_NAV, SECONDARY_NAV, guestNav } from "./nav";
import { useIsGuest } from "../../store/people";
import { BotRail, BotsSection } from "./BotsSection";
import { BrandMark } from "./BrandMark";
import { openFeedback } from "../../lib/feedback";

const HEADER_ICON =
  "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground flex size-8 items-center justify-center rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring";

/** ⌘K on Apple keyboards, Ctrl+K elsewhere. */
const SEARCH_SHORTCUT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K";

const NAV_ROW =
  "flex h-9 items-center gap-2 rounded-xl px-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring";

function NavRow({
  icon: Icon,
  label,
  rail,
  active,
  badge,
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  rail: boolean;
  active?: boolean;
  /** A count shown at the end of the row (e.g. unread Shelley conversations). */
  badge?: number;
} & ({ to: string; onClick?: () => void } | { onClick: () => void; to?: undefined })) {
  const className = cn(
    NAV_ROW,
    "w-full text-left",
    rail && "md:size-9 md:justify-center md:px-0",
    active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
  );
  const content = (
    <>
      <span className="relative shrink-0">
        <Icon className="text-muted-foreground size-4" />
        {badge ? (
          <span
            aria-hidden="true"
            className={cn(
              "bg-primary absolute -top-0.5 -right-0.5 hidden size-2 rounded-full",
              rail && "md:block",
            )}
          />
        ) : null}
      </span>
      <span className={cn("truncate", rail && "md:hidden")}>{label}</span>
      {badge ? (
        <span
          className={cn(
            "bg-primary text-primary-foreground ml-auto rounded-full px-1.5 text-[11px] leading-4 font-medium tabular-nums",
            rail && "md:hidden",
          )}
          aria-label={`${badge} unread`}
        >
          {badge}
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

/**
 * Persistent left sidebar (Grok-style): search and collapse icons up top,
 * the everyday nav (Tasks, Terminal), the Bots section (the way into
 * chats; /chats itself opens the last bot), and the
 * account menu, which also holds the set-up-and-forget pages (Routines,
 * Skills, Memory, Connections, Settings) on desktop and in the mobile drawer
 * alike, so mobile does not list them all the time (issue #227).
 * Desktop collapses to an icon rail (persisted); on mobile it is an
 * off-canvas drawer driven by `mobileOpen`.
 */
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
  // A guest (issue #145) sees their shared bots, Code and Settings only.
  const guest = useIsGuest();
  const primaryNav = guest ? guestNav(PRIMARY_NAV) : PRIMARY_NAV;
  const secondaryNav = guest ? [] : SECONDARY_NAV;

  // How "Send feedback" was chosen, so the panel opens the matching way.
  const feedbackRequested = useRef<"pointer" | "keyboard" | null>(null);
  const pointerOnFeedback = useRef(false);
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  // Code (issue #143) shows only with a coding agent configured, with its unread count.
  const codeConfigured = useCodeStore((s) => (s.harnesses?.length ?? 0) > 0);
  const codeUnread = useCodeStore((s) => unreadCount(s.threads));
  // A page that lives in the account menu still shows where you are: the
  // account row reads as selected while one of them is open.
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
          "bg-sidebar text-sidebar-foreground border-sidebar-border fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r-[0.5px] transition-transform duration-200 ease-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "md:static md:z-auto md:translate-x-0 md:transition-none",
          rail ? "md:w-16" : "md:w-64",
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-1 px-3",
            // Rail: collapse above search, centered in the narrow column.
            rail && "md:h-auto md:flex-col-reverse md:gap-1 md:py-3",
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
          <button
            type="button"
            onClick={() => {
              closeDrawer();
              toggleCommandPalette();
            }}
            aria-label="Search"
            title={`Search (${SEARCH_SHORTCUT})`}
            className={HEADER_ICON}
          >
            <Search className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(HEADER_ICON, "hidden md:flex")}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
        </div>

        <nav
          aria-label="Primary"
          className={cn("space-y-0.5 px-2.5 pb-2", rail && "md:flex md:flex-col md:items-center")}
        >
          {primaryNav
            .filter((item) => item.to !== "/code" || codeConfigured)
            .map((item) => (
              <NavRow
                key={item.to}
                icon={item.icon}
                label={item.label}
                rail={rail}
                to={item.to}
                active={isActive(item.to)}
                onClick={closeDrawer}
                badge={item.to === "/code" ? codeUnread : undefined}
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

        <div className={cn("shrink-0 p-2.5", rail && "md:flex md:justify-center")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Account and navigation"
                title={rail ? accountName : undefined}
                className={cn(
                  "flex h-10 w-full items-center gap-2 rounded-xl px-1.5 text-left text-sm outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
                  inMenuPage ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
                  rail && "md:size-10 md:justify-center md:px-0",
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
                // Open the feedback panel once the menu has closed, and keep
                // the menu from pulling focus back to its trigger, so typing
                // goes straight into the panel's note.
                const request = feedbackRequested.current;
                if (!request) return;
                feedbackRequested.current = null;
                e.preventDefault();
                openFeedback({ keyboard: request === "keyboard" });
              }}
            >
              {/* Amp-style order (upstream): Log out on top — farthest from
                  the trigger, safe to reach for — then the palette, the
                  destinations and Settings last, next to the trigger. */}
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
              <DropdownMenuItem
                onSelect={() => {
                  closeDrawer();
                  toggleCommandPalette();
                }}
              >
                <Search className="size-4" /> Command palette
                <span className="text-muted-foreground ml-auto text-xs">{SEARCH_SHORTCUT}</span>
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
                onPointerDown={() => {
                  pointerOnFeedback.current = true;
                }}
                onSelect={() => {
                  closeDrawer();
                  feedbackRequested.current = pointerOnFeedback.current ? "pointer" : "keyboard";
                  pointerOnFeedback.current = false;
                }}
              >
                <MessageSquareHeart className="size-4" /> Send feedback
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
