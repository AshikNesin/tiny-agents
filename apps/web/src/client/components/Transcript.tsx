import {
  Fragment,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
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

export interface TranscriptPages {
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => unknown;
}

export interface TranscriptProps {
  botName: string;
  timeline: TimelineItem[];
  pages: TranscriptPages;
  actions?: OwnerActions;
  unreadDividerId?: string | null;
  scrollAnchor?: (index: number) => boolean;
  empty?: ReactNode;
  tail?: ReactNode;
  contentTestId?: string;
}

function useOlderPages(pages: TranscriptPages, timeline: TimelineItem[]) {
  const sentinel = useRef<HTMLDivElement>(null);
  const keepFromBottom = useRef<{ el: HTMLElement; distance: number } | null>(null);
  const requested = useRef(false);
  const isLoadingOlder = useEffectEvent(() => pages.loadingOlder);
  const loadOlder = useEffectEvent(() => pages.loadOlder());
  const { hasMore, loadingOlder } = pages;

  useEffect(() => {
    const viewport = sentinel.current?.closest<HTMLElement>(
      '[data-slot="message-scroller-viewport"]',
    );
    if (!viewport || !hasMore) return;
    let armed = false;
    const check = () => {
      if (!armed || viewport.scrollTop > 400) return;
      if (requested.current || isLoadingOlder()) return;
      requested.current = true;
      keepFromBottom.current = {
        el: viewport,
        distance: viewport.scrollHeight - viewport.scrollTop,
      };
      void Promise.resolve(loadOlder())
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
