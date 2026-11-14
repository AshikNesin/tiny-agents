/**
 * A bot conversation's transcript, for the live chat and for a Past chat:
 * messages and routine results on one timeline with day dividers, older
 * pages loading as the owner scrolls to the top (the view staying where it
 * was), and the cards acting through the `OwnerActions` given (none in a
 * Past chat, whose cards then render without actions).
 *
 * The transcript is fed a timeline (lib/chat-timeline.ts: the messages
 * loaded so far and the routine cards, plus the live chat's Echoes) and a
 * page source: whether older messages exist and how to load the page
 * above. Both come from the chat session's view, through
 * `ChatSessionTranscript`, which sets the rest by the session's mode.
 *
 * It must render inside a `MessageScrollerProvider` (the pane drives the
 * scroller too: send → scroll to the end).
 */
import { Fragment, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import type { TimelineItem } from "../lib/chat-timeline";
import { formatDayDivider } from "../lib/day-divider";
import { OwnerActionsProvider, type OwnerActions } from "../lib/owner-actions";
import { useToolLabels } from "../lib/use-tool-labels";
import { ChatMessageView } from "./ChatMessageView";
import { RoutineRuns } from "./RoutineRuns";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
} from "./ui/message-scroller";

/** A transcript's pages: whether older ones exist, and how to load the page above. */
export interface TranscriptPages {
  /** Older messages exist above the oldest loaded one. */
  hasMore: boolean;
  /** The page above is being fetched. */
  loadingOlder: boolean;
  /** Fetch the page above the oldest loaded message. */
  loadOlder: () => unknown;
}

export interface TranscriptProps {
  botName: string;
  /** What to show, in order: messages, routine cards and Echoes. */
  timeline: TimelineItem[];
  pages: TranscriptPages;
  /** What the cards act through; leave out for a read-only transcript (a Past chat). */
  actions?: OwnerActions;
  /** The message the "New messages" divider goes above. */
  unreadDividerId?: string | null;
  /** Whether message `index` is a scroll anchor (the live chat opens on the newest read one). */
  scrollAnchor?: (index: number) => boolean;
  /** Rendered instead of the timeline when there is nothing to show. */
  empty?: ReactNode;
  /** Rows after the timeline (the typing indicator). */
  tail?: ReactNode;
  contentTestId?: string;
}

/**
 * Older pages load when the top of the transcript is in view after the
 * owner's own scrolling (issue #92): the scroller's jump to the latest
 * message on open must not fetch a page nobody asked for. What was on
 * screen stays where it was once the page lands.
 */
function useOlderPages(pages: TranscriptPages, timeline: TimelineItem[]) {
  const sentinel = useRef<HTMLDivElement>(null);
  const keepFromBottom = useRef<{ el: HTMLElement; distance: number } | null>(null);
  // Set at the call, before the source's own flag re-renders: one fetch at a time.
  const requested = useRef(false);
  const latest = useRef(pages);
  latest.current = pages;
  const { hasMore, loadingOlder } = pages;

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
  }, [hasMore, timeline.length]);

  useLayoutEffect(() => {
    const kept = keepFromBottom.current;
    if (!kept || loadingOlder) return;
    keepFromBottom.current = null;
    kept.el.scrollTop = kept.el.scrollHeight - kept.distance;
  }, [timeline, loadingOlder]);

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
  timeline,
  pages,
  actions,
  unreadDividerId,
  scrollAnchor,
  empty,
  tail,
  contentTestId,
}: TranscriptProps) {
  const toolLabels = useToolLabels();
  const sentinel = useOlderPages(pages, timeline);
  const { hasMore, loadingOlder } = pages;

  return (
    <OwnerActionsProvider actions={actions}>
      <MessageScroller className="h-full">
        <MessageScrollerViewport className="mx-auto w-full max-w-3xl px-4 pt-6 pb-4 sm:px-6">
          <MessageScrollerContent className="gap-4" data-testid={contentTestId}>
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
            {timeline.length === 0 && empty}
            {timeline.map((item, t) => {
              const prev = timeline[t - 1];
              const dayDivider = (!prev || !sameDay(prev.at, item.at)) && (
                <DayDivider at={item.at} />
              );
              if (item.kind === "echo") {
                // An owner send not yet confirmed: drawn as the bubble it will become.
                const { echo } = item;
                return (
                  <Fragment key={echo.requestId}>
                    {dayDivider}
                    <MessageScrollerItem messageId={echo.requestId}>
                      <ChatMessageView
                        message={{
                          id: echo.requestId,
                          role: "user",
                          text: echo.text,
                          ...(echo.attachments?.length ? { attachments: echo.attachments } : {}),
                          status: "streaming",
                          createdAt: item.at,
                        }}
                        botName={botName}
                      />
                    </MessageScrollerItem>
                  </Fragment>
                );
              }
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
              const dividerHere =
                unreadDividerId != null && (item.ids ?? [message.id]).includes(unreadDividerId);
              return (
                <Fragment key={message.id}>
                  {dayDivider}
                  {dividerHere && (
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
