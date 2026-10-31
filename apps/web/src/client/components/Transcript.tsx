/**
 * A bot conversation's transcript, for the live chat and for a Past chat:
 * messages and routine results on one timeline with day dividers, older
 * pages loading as the owner scrolls to the top (the view staying where it
 * was), and the cards acting through the `OwnerActions` given (none in a
 * Past chat, whose cards then render without actions).
 *
 * The transcript is fed by a page source: the messages loaded so far,
 * whether older ones exist, and how to load the page above. The live chat
 * feeds it from the chat store; a Past chat from its own pages.
 *
 * It must render inside a `MessageScrollerProvider` (the pane drives the
 * scroller too: send → scroll to the end).
 */
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { botsApi } from "../lib/bots-api";
import { chatTimeline } from "../lib/chat-timeline";
import type { ChatMessage, PendingMessage, RoutineRunCard } from "../lib/chat-types";
import { formatDayDivider } from "../lib/day-divider";
import { OwnerActionsProvider, type OwnerActions } from "../lib/owner-actions";
import { ChatMessageView, type ToolLabels } from "./ChatMessageView";
import { RoutineRuns } from "./RoutineRuns";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
} from "./ui/message-scroller";

/** A transcript's pages: what is loaded, and how to load the page above it. */
export interface TranscriptPages {
  messages: ChatMessage[];
  /** Older messages exist above `messages[0]`. */
  hasMore: boolean;
  /** The page above is being fetched. */
  loadingOlder: boolean;
  /** Fetch the page above the oldest loaded message. */
  loadOlder: () => unknown;
}

export interface TranscriptProps {
  botName: string;
  pages: TranscriptPages;
  routineRuns: RoutineRunCard[];
  /** What the cards act through; leave out for a read-only transcript (a Past chat). */
  actions?: OwnerActions;
  /** Echoes of owner sends not yet confirmed, after everything else. */
  echoes?: PendingMessage[];
  /** The message the "New messages" divider goes above. */
  unreadDividerId?: string | null;
  /** Whether message `index` is a scroll anchor (the live chat opens on the newest read one). */
  scrollAnchor?: (index: number) => boolean;
  /** Rendered instead of the timeline when there is nothing to show. */
  empty?: ReactNode;
  /** Rows between the timeline and the Echoes (typing indicator, queued messages). */
  tail?: ReactNode;
  contentTestId?: string;
}

const NO_TOOL_LABELS: { done: ToolLabels; ask: ToolLabels } = { done: {}, ask: {} };

/**
 * Tool labels for transcript rows (past tense) and approval cards
 * (imperative), from the capability catalog (fetched once per page load).
 */
function useToolLabels(): { done: ToolLabels; ask: ToolLabels } {
  const [labels, setLabels] = useState(NO_TOOL_LABELS);
  useEffect(() => {
    let cancelled = false;
    void botsApi
      .capabilities()
      .then((capabilities) => {
        if (cancelled) return;
        const tools = capabilities.flatMap((capability) => capability.tools);
        setLabels({
          done: Object.fromEntries(tools.map((tool) => [tool.name, tool.label])),
          ask: Object.fromEntries(
            tools.flatMap((tool) => (tool.askLabel ? [[tool.name, tool.askLabel]] : [])),
          ),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return labels;
}

/**
 * Older pages load when the top of the transcript is in view after the
 * owner's own scrolling (issue #92): the scroller's jump to the latest
 * message on open must not fetch a page nobody asked for. What was on
 * screen stays where it was once the page lands.
 */
function useOlderPages(pages: TranscriptPages) {
  const sentinel = useRef<HTMLDivElement>(null);
  const keepFromBottom = useRef<{ el: HTMLElement; distance: number } | null>(null);
  // Set at the call, before the source's own flag re-renders: one fetch at a time.
  const requested = useRef(false);
  const latest = useRef(pages);
  latest.current = pages;
  const { hasMore, loadingOlder, messages } = pages;

  useEffect(() => {
    const viewport = sentinel.current?.closest<HTMLElement>(
      '[data-slot="message-scroller-viewport"]',
    );
    if (!viewport || !hasMore) return;
    let armed = false;
    const check = () => {
      if (!armed || viewport.scrollTop > 400) return;
      if (requested.current || latest.current.loadingOlder) return;
      requested.current = true;
      keepFromBottom.current = {
        el: viewport,
        distance: viewport.scrollHeight - viewport.scrollTop,
      };
      void Promise.resolve(latest.current.loadOlder())
        .catch(() => undefined)
        .finally(() => {
          requested.current = false;
        });
    };
    const arm = () => {
      armed = true;
      check();
    };
    viewport.addEventListener("wheel", arm, { passive: true });
    viewport.addEventListener("touchmove", arm, { passive: true });
    viewport.addEventListener("keydown", arm);
    viewport.addEventListener("scroll", check, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", arm);
      viewport.removeEventListener("touchmove", arm);
      viewport.removeEventListener("keydown", arm);
      viewport.removeEventListener("scroll", check);
    };
  }, [hasMore, messages.length]);

  useLayoutEffect(() => {
    const kept = keepFromBottom.current;
    if (!kept || loadingOlder) return;
    keepFromBottom.current = null;
    kept.el.scrollTop = kept.el.scrollHeight - kept.distance;
  }, [messages, loadingOlder]);

  return sentinel;
}

function DayDivider({ at }: { at: number }) {
  return (
    <div className="text-muted-foreground flex justify-center py-2 text-xs">
      {formatDayDivider(at)}
    </div>
  );
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

export function Transcript({
  botName,
  pages,
  routineRuns,
  actions,
  echoes = [],
  unreadDividerId,
  scrollAnchor,
  empty,
  tail,
  contentTestId,
}: TranscriptProps) {
  const toolLabels = useToolLabels();
  const sentinel = useOlderPages(pages);
  const { messages, hasMore, loadingOlder } = pages;
  // Routine results (issue #63): quiet lines between messages, by finish time.
  const timeline = useMemo(() => chatTimeline(messages, routineRuns), [messages, routineRuns]);
  const last = timeline[timeline.length - 1];

  return (
    <OwnerActionsProvider actions={actions}>
      <MessageScroller className="h-full">
        <MessageScrollerViewport className="mx-auto w-full max-w-3xl px-2.5 py-4 sm:px-5">
          <MessageScrollerContent className="space-y-4" data-testid={contentTestId}>
            {hasMore && (
              <div
                ref={sentinel}
                className="text-muted-foreground py-2 text-center text-xs"
                aria-live="polite"
                data-testid="older-messages"
              >
                {loadingOlder ? "Loading earlier messages…" : "Earlier messages"}
              </div>
            )}
            {timeline.length === 0 && echoes.length === 0 && empty}
            {timeline.map((item, t) => {
              const prev = timeline[t - 1];
              const dayDivider = (!prev || !sameDay(prev.at, item.at)) && (
                <DayDivider at={item.at} />
              );
              if (item.kind === "routine-runs") {
                const key = `runs-${item.runs[0].id}`;
                return (
                  <Fragment key={key}>
                    {dayDivider}
                    <MessageScrollerItem messageId={key}>
                      <RoutineRuns runs={item.runs} />
                    </MessageScrollerItem>
                  </Fragment>
                );
              }
              const { message, index } = item;
              return (
                <Fragment key={message.id}>
                  {dayDivider}
                  {unreadDividerId === message.id && (
                    <div
                      data-testid="unread-divider"
                      className="text-muted-foreground/80 flex items-center gap-2 py-1 text-[11px]"
                    >
                      <span className="bg-border h-px flex-1" aria-hidden="true" />
                      New messages
                      <span className="bg-border h-px flex-1" aria-hidden="true" />
                    </div>
                  )}
                  <MessageScrollerItem
                    messageId={message.id}
                    scrollAnchor={scrollAnchor?.(index) ?? false}
                  >
                    <ChatMessageView
                      message={message}
                      botName={botName}
                      toolLabels={toolLabels.done}
                      toolAskLabels={toolLabels.ask}
                    />
                  </MessageScrollerItem>
                </Fragment>
              );
            })}
            {tail}
            {echoes.length > 0 && (
              <>
                {(!last || !sameDay(last.at, echoes[0].createdAt)) && (
                  <DayDivider at={echoes[0].createdAt} />
                )}
                {echoes.map((echo) => (
                  <MessageScrollerItem key={echo.id} messageId={echo.id}>
                    <ChatMessageView
                      message={{
                        id: echo.id,
                        role: "user",
                        text: echo.text,
                        ...(echo.attachments?.length ? { attachments: echo.attachments } : {}),
                        status: "streaming",
                        createdAt: echo.createdAt,
                      }}
                      botName={botName}
                    />
                  </MessageScrollerItem>
                ))}
              </>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton
          direction="end"
          className="absolute right-4 bottom-4"
          aria-label="Jump to the latest message"
        />
      </MessageScroller>
    </OwnerActionsProvider>
  );
}
