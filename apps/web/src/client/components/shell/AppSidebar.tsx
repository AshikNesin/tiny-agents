import { Link, matchPath, useLocation, useNavigate } from "react-router-dom";
import {
  Bot,
  ChevronsUpDown,
  LogOut,
  MessageSquare,
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
import { cn } from "@groot/shell/lib/utils";
import { useAuthStore } from "@groot/shell/store/auth";
import { toast } from "sonner";
import { useCommandPaletteStore } from "@groot/shell/store/command-palette";
import { useBotsStore } from "../../store/bots";
import { useUiStore } from "../../store/ui";
import { PRIMARY_NAV, SECONDARY_NAV, type AppNavItem } from "./nav";
import { BotsSection } from "./BotsSection";

const NAV: AppNavItem[] = [{ label: "Chats", icon: MessageSquare, to: "/chats" }, ...PRIMARY_NAV];

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
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  rail: boolean;
  active?: boolean;
} & ({ to: string; onClick?: () => void } | { onClick: () => void; to?: undefined })) {
  const className = cn(
    NAV_ROW,
    "w-full text-left",
    rail && "md:size-9 md:justify-center md:px-0",
    active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
  );
  const content = (
    <>
      <Icon className="text-muted-foreground size-4 shrink-0" />
      <span className={cn("truncate", rail && "md:hidden")}>{label}</span>
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
 * the everyday nav (Chats, Tasks, Terminal), the Bots section, and the
 * account menu, which also holds the set-up-and-forget pages (Routines,
 * Skills, Memory, Connections, Settings). Desktop collapses to an icon rail (persisted); on mobile it is
 * an off-canvas drawer driven by `mobileOpen`.
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

  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
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
            <Bot className="size-5" />
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
          {NAV.map((item) => (
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
        {rail && <div className="hidden flex-1 md:block" />}

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
            <DropdownMenuContent align="start" side="top" className="w-56">
              {[...SECONDARY_NAV, { label: "Settings", icon: SettingsIcon, to: "/settings" }].map(
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
                variant="destructive"
                onSelect={() => {
                  void logout();
                  toast.success("Signed out", { description: "You have been logged out safely." });
                  navigate("/login");
                }}
              >
                <LogOut className="size-4" /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
