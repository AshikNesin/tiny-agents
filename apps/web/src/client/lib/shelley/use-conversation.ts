/**
 * One Shelley conversation, live (issue #143). The stream is opened first
 * and the history read after it connects (again on every reconnect), and
 * both merge by `sequence_id`, so a reload mid-turn neither loses nor
 * duplicates a message.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscribeSse } from "../sse";
import {
  shelleyApi,
  type ShelleyConversation,
  type ShelleyEvent,
  type ShelleyMessage,
} from "./api";
import { buildTranscript, maxSequence, type TranscriptItem } from "./transcript";

export interface ConversationState {
  loaded: boolean;
  error: string | null;
  conversation: ShelleyConversation | null;
  subagents: ShelleyConversation[];
  messages: ShelleyMessage[];
  items: TranscriptItem[];
  working: boolean;
  contextWindow: number;
  /** Text the model is streaming right now (not yet a stored message). */
  partialText: string;
  partialThinking: string;
  maxSequenceId: number;
  reload(): Promise<void>;
}

export function useShelleyConversation(id: string): ConversationState {
  const [messages, setMessages] = useState<Map<number, ShelleyMessage>>(() => new Map());
  const [conversation, setConversation] = useState<ShelleyConversation | null>(null);
  const [subagents, setSubagents] = useState<ShelleyConversation[]>([]);
  const [working, setWorking] = useState(false);
  const [contextWindow, setContextWindow] = useState(0);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [partialText, setPartialText] = useState("");
  const [partialThinking, setPartialThinking] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(id);
  current.current = id;

  const merge = useCallback((incoming: ShelleyMessage[]) => {
    setMessages((prev) => {
      const next = new Map(prev);
      for (const m of incoming) next.set(m.sequence_id, m);
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    const forId = id;
    try {
      const detail = await shelleyApi.get(forId);
      if (current.current !== forId) return;
      merge(detail.messages ?? []);
      setConversation(detail.conversation);
      setSubagents(detail.subagents ?? []);
      setWorking(Boolean(detail.conversation?.agent_working ?? detail.conversation?.working));
      if (detail.context_window_size) setContextWindow(detail.context_window_size);
      setError(null);
    } catch (err) {
      if (current.current === forId) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (current.current === forId) setLoaded(true);
    }
  }, [id, merge]);

  useEffect(() => {
    setMessages(new Map());
    setConversation(null);
    setSubagents([]);
    setWorking(false);
    setProgress({});
    setPartialText("");
    setPartialThinking("");
    setLoaded(false);
    setError(null);
    const connection = subscribeSse(
      shelleyApi.eventsPath(id),
      (raw) => {
        const event = raw as ShelleyEvent;
        if (event.type === "error") {
          setError(event.message);
          return;
        }
        if (event.type !== "frame") return;
        const frame = event.frame;
        if (frame.messages?.length) {
          merge(frame.messages);
          if (frame.messages.some((m) => m.type === "agent")) {
            setPartialText("");
            setPartialThinking("");
          }
        }
        if (frame.conversation) setConversation(frame.conversation);
        if (frame.conversation_state) {
          setWorking(frame.conversation_state.working);
          if (!frame.conversation_state.working) {
            setPartialText("");
            setPartialThinking("");
          }
        }
        if (frame.context_window_size) setContextWindow(frame.context_window_size);
        const tool = frame.tool_progress;
        if (tool) setProgress((prev) => ({ ...prev, [tool.tool_use_id]: tool.output }));
        const delta = frame.stream_delta;
        if (delta?.type === "text") setPartialText((prev) => prev + delta.text);
        else if (delta?.type === "thinking") setPartialThinking((prev) => prev + delta.text);
      },
      {
        // Read the history once the stream is live: nothing falls between.
        onOpen: () => {
          setPartialText("");
          setPartialThinking("");
          void reload();
        },
      },
    );
    // Read now as well: the page must not wait on the stream to show history.
    void reload();
    return () => connection.close();
  }, [id, merge, reload]);

  const list = useMemo(() => [...messages.values()], [messages]);
  const items = useMemo(() => buildTranscript(list, { progress }), [list, progress]);
  return {
    loaded,
    error,
    conversation,
    subagents,
    messages: list,
    items,
    working,
    contextWindow,
    partialText,
    partialThinking,
    maxSequenceId: maxSequence(list),
    reload,
  };
}
