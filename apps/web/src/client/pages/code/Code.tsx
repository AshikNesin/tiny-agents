/**
 * Code page: a first-class window onto Shelley, the coding agent on another
 * machine. tiny-agents runs no agent loop for it; the page drives Shelley's
 * own API through the `/shelley` proxy: start a conversation, watch it live
 * (text, thinking, every tool call with its input and output, streaming as it
 * happens), steer it mid-turn, queue a follow-up, or stop it.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Code2, ListPlus, Plus, Send, Square, TriangleAlert } from "lucide-react";
import { Streamdown } from "streamdown";
import { Button, EmptyState, ErrorState, Input, LoadingState, monoClass } from "@groot/ui";
import { Textarea } from "@groot/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { cn } from "@groot/shell/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "../../components/ui/message-scroller";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from "../../components/ui/trace";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "../../components/ui/code-block";
import { Spinner } from "../../components/ui/spinner";
import { TypingIndicator, USER_PILL } from "../../components/ChatMessageView";
import { markdownComponents } from "../../lib/markdown";
import { subscribeSse } from "../../lib/sse";
import { errorMessage } from "../../lib/errors";
import {
  buildTranscript,
  conversationTitle,
  shelleyApi,
  type ShelleyConversation,
  type ShelleyMessage,
  type ShelleyModel,
  type ShelleyStatus,
  type ShelleyStreamEvent,
  type ToolCall,
  type TranscriptItem,
} from "../../lib/shelley-api";

const LIST_REFRESH_MS = 5_000;
const CWD_KEY = "tiny-agents:shelley-cwd";

function readCwd(): string {
  try {
    return window.localStorage.getItem(CWD_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveCwd(cwd: string) {
  try {
    window.localStorage.setItem(CWD_KEY, cwd);
  } catch {
    // Private mode: just not remembered.
  }
}

/** ⌘/Ctrl+Enter or plain Enter (without Shift) submits the composer. */
function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>, submit: () => void) {
  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
    event.preventDefault();
    submit();
  }
}

export function CodePage() {
  const { conversationId } = useParams();
  const [status, setStatus] = useState<ShelleyStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ShelleyConversation[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    shelleyApi
      .status()
      .then(setStatus)
      .catch((error: unknown) =>
        setStatusError(errorMessage(error, "Could not load the Shelley status.")),
      );
  }, []);

  const refresh = useCallback(async () => {
    try {
      setConversations(await shelleyApi.list());
      setListError(null);
    } catch (error) {
      setListError(errorMessage(error, "Could not load conversations."));
    }
  }, []);

  useEffect(() => {
    if (!status?.configured) return;
    void refresh();
    const timer = setInterval(() => void refresh(), LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [status?.configured, refresh]);

  let body;
  if (statusError) {
    body = <ErrorState title="Could not reach the server" description={statusError} />;
  } else if (!status) {
    body = <LoadingState text="Loading…" />;
  } else if (!status.configured) {
    body = (
      <EmptyState
        icon={Code2}
        title="Shelley is not connected"
        description={
          <>
            Set <code className={monoClass}>SHELLEY_URL</code> (for example{" "}
            <code className={monoClass}>http://my-vm:9999</code> over Tailscale) and restart.
          </>
        }
      />
    );
  } else {
    body = (
      <div className="ring-border flex h-[calc(100dvh-12rem)] min-h-96 overflow-hidden rounded-xl ring-1">
        <aside
          className={cn(
            "border-border w-full shrink-0 flex-col border-r md:flex md:w-72",
            conversationId ? "hidden" : "flex",
          )}
        >
          <ConversationList
            conversations={conversations}
            error={listError}
            activeId={conversationId}
          />
        </aside>
        <section
          className={cn("min-w-0 flex-1 flex-col", conversationId ? "flex" : "hidden md:flex")}
        >
          {conversationId ? (
            <ConversationPane key={conversationId} id={conversationId} onChange={refresh} />
          ) : (
            <NewConversation onCreated={refresh} />
          )}
        </section>
      </div>
    );
  }

  return (
    <PageLayout
      title="Code"
      description={
        status?.url ? (
          <>
            Shelley at <span className={monoClass}>{status.url}</span>
          </>
        ) : (
          "Drive your Shelley coding agent."
        )
      }
      maxWidth="full"
      backTo={conversationId ? "/code" : undefined}
      actions={
        status?.configured && conversationId ? (
          <Button asChild variant="outline" size="sm">
            <Link to="/code">
              <Plus />
              New
            </Link>
          </Button>
        ) : undefined
      }
    >
      {body}
    </PageLayout>
  );
}

function ConversationList({
  conversations,
  error,
  activeId,
}: {
  conversations: ShelleyConversation[] | null;
  error: string | null;
  activeId?: string;
}) {
  return (
    <>
      <div className="border-border flex items-center justify-between border-b p-2">
        <span className="text-muted-foreground px-2 text-xs">Conversations</span>
        <Button asChild variant="ghost" size="sm">
          <Link to="/code" data-testid="code-new">
            <Plus />
            New
          </Link>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {error && <p className="text-destructive p-2 text-xs">{error}</p>}
        {!conversations && !error && <LoadingState text="Loading…" />}
        {conversations?.length === 0 && (
          <p className="text-muted-foreground p-3 text-sm">No conversations yet.</p>
        )}
        {conversations?.map((c) => {
          const working = c.working ?? c.agent_working;
          return (
            <Link
              key={c.conversation_id}
              to={`/code/${c.conversation_id}`}
              className={cn(
                "hover:bg-muted flex flex-col gap-0.5 rounded-lg px-3 py-2 text-sm",
                c.conversation_id === activeId && "bg-muted",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{conversationTitle(c)}</span>
                {working && <Spinner className="size-3.5" aria-label="Working" />}
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {c.preview || c.cwd || "—"}
              </span>
              <span className="text-muted-foreground text-xs">
                {formatRelativeTime(c.updated_at)}
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function NewConversation({ onCreated }: { onCreated: () => void }) {
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [cwd, setCwd] = useState(readCwd);
  const [model, setModel] = useState("default");
  const [models, setModels] = useState<ShelleyModel[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    shelleyApi
      .models()
      .then((list) => setModels(list.filter((m) => m.ready)))
      .catch(() => setModels([]));
  }, []);

  const start = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true);
    try {
      saveCwd(cwd.trim());
      const { conversationId } = await shelleyApi.create({
        message: message.trim(),
        cwd: cwd.trim() || undefined,
        model: model === "default" ? undefined : model,
      });
      onCreated();
      navigate(`/code/${conversationId}`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not start the conversation."));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={start} className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4 md:mt-12">
      <Textarea
        autoFocus
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => submitOnEnter(e, () => void start())}
        placeholder="What should Shelley build or fix?"
        rows={5}
        data-testid="code-new-message"
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="Working directory (e.g. /home/exedev/repo)"
          className={cn("flex-1", monoClass)}
          aria-label="Working directory"
        />
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger className="sm:w-56" aria-label="Model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default model</SelectItem>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.display_name || m.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!message.trim() || busy}>
          {busy ? <Spinner /> : <Send />}
          Start
        </Button>
      </div>
    </form>
  );
}

/** One live conversation: its stream folded into a transcript, plus the composer. */
function useShelleyConversation(id: string) {
  const [messages, setMessages] = useState<Map<number, ShelleyMessage>>(() => new Map());
  const [conversation, setConversation] = useState<ShelleyConversation | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const connection = subscribeSse(
      shelleyApi.streamPath(id),
      (raw) => {
        const event = raw as ShelleyStreamEvent;
        if (event.type === "ping") return;
        if (event.type === "error") {
          setError(event.message ?? "Stream error");
          setLoaded(true);
          return;
        }
        const incoming = event.messages;
        if (incoming?.length) {
          setMessages((prev) => {
            const next = new Map(prev);
            for (const m of incoming) next.set(m.sequence_id, m);
            return next;
          });
          // A stored agent message replaces the text that streamed into it.
          if (incoming.some((m) => m.type === "agent")) setPartial("");
        }
        if (event.conversation) setConversation(event.conversation);
        if (event.conversation_state) {
          setWorking(event.conversation_state.working);
          setLoaded(true);
        }
        const tool = event.tool_progress;
        if (tool) setProgress((prev) => ({ ...prev, [tool.tool_use_id]: tool.output }));
        const delta = event.stream_delta;
        if (delta?.type === "text") setPartial((prev) => prev + delta.text);
      },
      {
        onOpen: () => {
          setError(null);
          setPartial("");
        },
      },
    );
    return () => connection.close();
  }, [id]);

  const items = useMemo(() => buildTranscript(messages.values(), progress), [messages, progress]);
  return { items, conversation, working, partial, error, loaded };
}

function ConversationPane({ id, onChange }: { id: string; onChange: () => void }) {
  const { items, conversation, working, partial, error, loaded } = useShelleyConversation(id);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const send = async (queue = false) => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { status } = await shelleyApi.chat(id, text, queue);
      setDraft("");
      if (status === "queued" && queue) toast.success("Queued for after this turn");
      onChange();
    } catch (err) {
      toast.error(errorMessage(err, "Could not send the message."));
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    try {
      await shelleyApi.cancel(id);
    } catch (err) {
      toast.error(errorMessage(err, "Could not stop Shelley."));
    }
  };

  return (
    <>
      <header className="border-border flex items-center gap-2 border-b px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {conversation ? conversationTitle(conversation) : id}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {[conversation?.cwd, conversation?.model].filter(Boolean).join(" · ")}
          </div>
        </div>
        {working && (
          <Button variant="outline" size="sm" onClick={() => void stop()} data-testid="code-stop">
            <Square />
            Stop
          </Button>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        {!loaded ? (
          <LoadingState text="Connecting to Shelley…" />
        ) : (
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="h-full">
              <MessageScrollerViewport className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-5">
                <MessageScrollerContent className="space-y-4">
                  {items.map((item) => (
                    <MessageScrollerItem
                      key={item.key}
                      messageId={item.key}
                      scrollAnchor={item.kind === "user"}
                    >
                      <TranscriptRow item={item} />
                    </MessageScrollerItem>
                  ))}
                  {partial && (
                    <MessageScrollerItem messageId="partial">
                      <div className="chat-md min-w-0 px-0.5">
                        <Streamdown components={markdownComponents}>{partial}</Streamdown>
                      </div>
                    </MessageScrollerItem>
                  )}
                  {working && (
                    <MessageScrollerItem messageId="working">
                      <TypingIndicator label="working" />
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
      </div>

      {error && (
        <p className="text-destructive border-border flex items-center gap-2 border-t px-4 py-2 text-xs">
          <TriangleAlert className="size-3.5" />
          {error} — reconnecting…
        </p>
      )}

      <div className="border-border border-t p-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => submitOnEnter(e, () => void send(false))}
            placeholder={
              working ? "Steer Shelley — sent into the running turn" : "Reply to Shelley"
            }
            rows={2}
            className="min-h-0 flex-1 resize-none"
            data-testid="code-composer"
          />
          {working && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => void send(true)}
              disabled={!draft.trim() || sending}
              title="Queue for after this turn"
              aria-label="Queue for after this turn"
            >
              <ListPlus />
            </Button>
          )}
          <Button
            size="icon"
            onClick={() => void send(false)}
            disabled={!draft.trim() || sending}
            title={working ? "Steer now" : "Send"}
            aria-label={working ? "Steer now" : "Send"}
            data-testid="code-send"
          >
            {sending ? <Spinner /> : <Send />}
          </Button>
        </div>
      </div>
    </>
  );
}

function TranscriptRow({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className={cn(USER_PILL, "max-w-[85%] whitespace-pre-wrap")}>{item.text}</div>
        </div>
      );
    case "assistant":
      return (
        <div className="chat-md min-w-0 px-0.5">
          <Streamdown components={markdownComponents}>{item.text}</Streamdown>
        </div>
      );
    case "thinking":
      return (
        <Trace>
          <TraceCollapsible>
            <TraceCollapsibleTrigger>
              <TraceLine>
                <TraceTitle>Thinking</TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <p className="text-muted-foreground text-sm whitespace-pre-wrap">{item.text}</p>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      );
    case "notice":
      return (
        <p className="text-destructive flex items-start gap-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="whitespace-pre-wrap">{item.text}</span>
        </p>
      );
    case "tool":
      return <ToolRow call={item} />;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function ToolRow({ call }: { call: ToolCall }) {
  const input =
    call.input === undefined || call.input === null ? "" : JSON.stringify(call.input, null, 2);
  return (
    <Trace className="gap-1">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine
            status={
              call.status === "running" ? "running" : call.status === "error" ? "error" : undefined
            }
          >
            <TraceTitle>
              {call.name}
              {call.summary && <span className={cn("ml-1.5", monoClass)}>{call.summary}</span>}
            </TraceTitle>
            {call.durationMs !== undefined && (
              <TraceDescription>{formatDuration(call.durationMs)}</TraceDescription>
            )}
            {call.status === "error" && <TraceDescription>failed</TraceDescription>}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="space-y-2">
          {input && input !== "{}" && <DetailBlock title="Input" value={input} />}
          {call.output && (
            <DetailBlock
              title={call.status === "running" ? "Output (live)" : "Output"}
              value={call.output}
              destructive={call.status === "error"}
            />
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function DetailBlock({
  title,
  value,
  destructive = false,
}: {
  title: string;
  value: string;
  destructive?: boolean;
}) {
  const lines = value.replace(/\n$/, "").split("\n");
  return (
    <CodeBlock size="sm" variant={destructive ? "destructive" : "default"}>
      <CodeBlockHeader>
        <CodeBlockTitle>{title}</CodeBlockTitle>
      </CodeBlockHeader>
      <CodeBlockContent wrap className="max-h-80 overflow-y-auto overscroll-contain">
        {lines.map((line, i) => (
          <CodeBlockLine key={i}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}
