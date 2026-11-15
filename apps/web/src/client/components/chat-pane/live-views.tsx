/**
 * The chat's live views: the Browser and Computer panels, which one is in
 * front, the header toggle's state and label, and the tabs between them.
 */
import { useEffect, useState } from "react";
import { Globe, Monitor, type LucideIcon } from "lucide-react";
import type { Bot } from "../../../shared/api/bots";
import type { ChatMessage } from "../../lib/chat-types";
import { botsApi } from "../../lib/bots-api";
import {
  browserInUse,
  computerInUse,
  useBrowserPanel,
  useComputerPanel,
} from "../../lib/browser-panel";
import { SHOW_COMPUTER_EVENT } from "../../lib/owner-actions";

export function useLiveViews(bot: Bot, messages: ChatMessage[]) {
  // The Browser panel opens itself the first time the bot drives its browser
  // in this conversation (friction #37); once the owner closes it, it stays
  // closed and the header toggle shows the activity instead.
  const browserActive = browserInUse(messages);
  // One live view at a time: the panel opened last is in front.
  const [front, setFront] = useState<"browser" | "computer">("browser");
  const browser = useBrowserPanel(bot.conversationId, browserActive, () => setFront("browser"));
  // The Computer panel (issue #108) follows the same rule, and also opens
  // when the bot asks the owner to take over its computer.
  const computerActive = computerInUse(messages);
  const computer = useComputerPanel(bot.conversationId, computerActive, () => setFront("computer"));
  // Whether this server has a computer at all; the toggle hides otherwise.
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
  // One header button for both live views; with a computer, tabs in the
  // panel switch between them.
  const hasComputer = computerConfigured || computer.open || computerActive;
  const liveShown = showBrowser || showComputer;
  const liveBusy = (browserActive && !showBrowser) || (computerActive && !showComputer);
  const closeLive = () => {
    if (browser.open) browser.close();
    if (computer.open) computer.close();
  };
  const toggleLive = () => {
    if (liveShown) closeLive();
    // Open what the bot is using, else the view last in front.
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
  // "Open computer" on a takeover card in the transcript.
  const showComputerPanel = computer.show;
  useEffect(() => {
    const onShow = () => showComputerPanel();
    window.addEventListener(SHOW_COMPUTER_EVENT, onShow);
    return () => window.removeEventListener(SHOW_COMPUTER_EVENT, onShow);
  }, [showComputerPanel]);

  return {
    showBrowser,
    showComputer,
    hasComputer,
    liveShown,
    liveBusy,
    liveLabel,
    liveTabs,
    closeLive,
    toggleLive,
  };
}

/** What the header's live-view toggle shows and does. */
export type LiveViews = ReturnType<typeof useLiveViews>;

/**
 * The live view's switch between the bot's browser and its computer, in the
 * open panel's title: a compact segmented control, an icon and a label each
 * (the icon alone in a narrow panel).
 * A dot marks the one the bot is using out of sight.
 */
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
      {/* A narrow panel (a phone) keeps the icons; the label stays for screen readers. */}
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
