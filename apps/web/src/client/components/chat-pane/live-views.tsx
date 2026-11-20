import { useCallback, useEffect, useState } from "react";
import { Globe, Monitor, type LucideIcon } from "lucide-react";
import type { Bot } from "../../../shared/api/bots";
import type { ChatMessage } from "../../lib/chat-types";
import { botsApi } from "../../lib/bots-api";
import { browserInUse, computerInUse, useLiveLayout } from "../../lib/browser-panel";
import { SHOW_COMPUTER_EVENT } from "../../lib/owner-actions";

function usePanel(onOpen: () => void) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => {
    setOpen(true);
    onOpen();
  }, [onOpen]);
  const close = useCallback(() => setOpen(false), []);
  return { open, show, close };
}

export function useLiveViews(bot: Bot, messages: ChatMessage[]) {
  const browserActive = browserInUse(messages);
  const computerActive = computerInUse(messages);
  const [front, setFront] = useState<"browser" | "computer">("browser");
  const browser = usePanel(useCallback(() => setFront("browser"), []));
  const computer = usePanel(useCallback(() => setFront("computer"), []));
  const [layout, setLayout] = useLiveLayout();
  const [computerConfigured, setComputerConfigured] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve()
      .then(() => botsApi.computerStatus(bot.id))
      .then((status) => {
        if (!cancelled) setComputerConfigured(Boolean(status?.configured));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bot.id]);
  const showBrowser = browser.open && (!computer.open || front === "browser");
  const showComputer = computer.open && (!browser.open || front === "computer");
  const hasComputer = computerConfigured || computer.open || computerActive;
  const liveShown = showBrowser || showComputer;
  const liveBusy = (browserActive && !showBrowser) || (computerActive && !showComputer);
  const closeLive = () => {
    if (browser.open) browser.close();
    if (computer.open) computer.close();
  };
  const toggleLive = () => {
    if (liveShown) closeLive();
    else if (hasComputer && !browserActive && (computerActive || front === "computer"))
      computer.show();
    else browser.show();
  };
  const liveLabel = liveShown
    ? "Close live view"
    : browserActive
      ? `Open live view, ${bot.name} is using the browser`
      : computerActive
        ? `Open live view, ${bot.name} is using the computer`
        : "Open live view";
  const liveTabs = hasComputer ? (
    <LiveViewTabs
      front={showComputer ? "computer" : "browser"}
      browserBusy={browserActive && !showBrowser}
      computerBusy={computerActive && !showComputer}
      onBrowser={browser.show}
      onComputer={computer.show}
    />
  ) : undefined;
  const showComputerPanel = computer.show;
  useEffect(() => {
    const onShow = () => {
      setLayout("docked");
      showComputerPanel();
    };
    window.addEventListener(SHOW_COMPUTER_EVENT, onShow);
    return () => window.removeEventListener(SHOW_COMPUTER_EVENT, onShow);
  }, [showComputerPanel, setLayout]);

  return {
    showBrowser,
    showComputer,
    hasComputer,
    liveShown,
    liveBusy,
    liveLabel,
    liveTabs,
    layout,
    setLayout,
    closeLive,
    toggleLive,
  };
}

export type LiveViews = ReturnType<typeof useLiveViews>;

function LiveViewTabs({
  front,
  browserBusy,
  computerBusy,
  onBrowser,
  onComputer,
}: {
  front: "browser" | "computer";
  browserBusy: boolean;
  computerBusy: boolean;
  onBrowser: () => void;
  onComputer: () => void;
}) {
  const tab = (
    key: "browser" | "computer",
    label: string,
    Icon: LucideIcon,
    busy: boolean,
    onClick: () => void,
  ) => (
    <button
      type="button"
      role="tab"
      aria-selected={front === key}
      onClick={onClick}
      className="relative inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm"
      data-testid={`live-view-tab-${key}`}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="@max-lg:sr-only">{label}</span>
      {busy && (
        <>
          <span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden />
          <span className="sr-only">, in use</span>
        </>
      )}
    </button>
  );
  return (
    <div
      role="tablist"
      aria-label="Live view"
      className="inline-flex shrink-0 items-center rounded-lg bg-muted p-0.5"
    >
      {tab("browser", "Browser", Globe, browserBusy, onBrowser)}
      {tab("computer", "Computer", Monitor, computerBusy, onComputer)}
    </div>
  );
}
