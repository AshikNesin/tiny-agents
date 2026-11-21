import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Code2, MessageSquare, PanelLeftClose, type LucideIcon } from "lucide-react";
import { cn } from "@groot/ui/lib/utils";
import { waitingCount } from "../../lib/attention";
import { useBotsStore } from "../../store/bots";
import { unreadCount, useCodeStore } from "../../store/code";
import { modeOf, useUiStore, type AppMode } from "../../store/ui";
import { BrandMark } from "./BrandMark";

export const SIDEBAR_ICON =
  "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring";

export const SIDEBAR_ROW =
  "flex h-9 w-full items-center gap-2 rounded-xl px-1.5 text-left text-sm outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring [&>svg]:text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0";

export function useCodeAvailable(): boolean {
  return useCodeStore((s) => (s.harnesses?.length ?? 0) > 0);
}

function Segment({
  mode,
  icon: Icon,
  label,
  current,
  to,
  dot,
  onNavigate,
}: {
  mode: AppMode;
  icon: LucideIcon;
  label: string;
  current: boolean;
  to: string;
  dot: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      title={label}
      data-testid={`mode-${mode}`}
      className={cn(
        "relative flex size-7 items-center justify-center rounded-[10px] outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
        current
          ? "bg-card text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {dot && (
        <span
          aria-hidden="true"
          className="bg-primary absolute top-0.5 right-0.5 size-1.5 rounded-full"
        />
      )}
    </Link>
  );
}

export function ModeSwitch({
  vertical = false,
  onNavigate,
}: {
  vertical?: boolean;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const mode = modeOf(pathname);
  const lastPath = useUiStore((s) => s.lastPath);
  const codeUnread = useCodeStore((s) => unreadCount(s.threads));
  const chatWaiting = useBotsStore((s) => waitingCount(s.bots));
  return (
    <nav
      aria-label="Mode"
      className={cn(
        "bg-sidebar-accent flex shrink-0 gap-0.5 rounded-xl p-0.5",
        vertical && "md:flex-col",
      )}
    >
      <Segment
        mode="chat"
        icon={MessageSquare}
        label="Chat"
        current={mode === "chat"}
        to={mode === "chat" ? pathname : lastPath.chat}
        dot={mode !== "chat" && chatWaiting > 0}
        onNavigate={onNavigate}
      />
      <Segment
        mode="code"
        icon={Code2}
        label="Code"
        current={mode === "code"}
        to={mode === "code" ? pathname : lastPath.code}
        dot={mode !== "code" && codeUnread > 0}
        onNavigate={onNavigate}
      />
    </nav>
  );
}

export function SidebarTop({
  onNavigate,
  onHide,
  hideLabel = "Hide sidebar",
  hideControls,
  children,
}: {
  onNavigate?: () => void;
  onHide?: () => void;
  hideLabel?: string;
  hideControls?: string;
  children?: ReactNode;
}) {
  const codeAvailable = useCodeAvailable();
  return (
    <div className="flex h-14 shrink-0 items-center gap-1.5 px-3">
      <Link
        to="/chats"
        onClick={onNavigate}
        aria-label="tiny-agents"
        className="text-foreground hover:bg-sidebar-accent flex size-8 shrink-0 items-center justify-center rounded-xl"
      >
        <BrandMark className="size-5" />
      </Link>
      <span className="flex-1" />
      {codeAvailable && <ModeSwitch onNavigate={onNavigate} />}
      {children}
      {onHide && (
        <button
          type="button"
          onClick={onHide}
          aria-label={hideLabel}
          aria-controls={hideControls}
          aria-expanded
          title={`${hideLabel} (⌘B)`}
          className={cn(SIDEBAR_ICON, "hidden md:flex")}
        >
          <PanelLeftClose className="size-4" />
        </button>
      )}
    </div>
  );
}
