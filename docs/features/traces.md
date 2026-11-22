# Traces

Traces (issue #363) shows every LLM call the bots make: which model, how
many tokens, how much was cached, what it cost and how long it took. Open it
from the account menu (**Traces**) or at `/traces`. It is owner only.

## What it reads

Traces is a read-only view over data the app already keeps. It writes
nothing for a conversation and makes no model calls.

| Concept    | Source                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session    | One durable conversation: a bot's chat (`bots`), a Past chat (`bot_chats`), a routine run (`routine_runs.conversation_id`) or a bot-to-bot delivery (`bot_messages.own_conversation`). |
| Totals     | The conversation's `pi.usage` document: tokens and cost per model and per tool, compactions included.                                                                                  |
| Turn       | A user entry (owner message, routine prompt, peer message) and the entries that answer it.                                                                                             |
| Model call | A `pi.assistant` entry: provider, model, thinking level, usage and cost, stop reason, error, start time and `durationMs`.                                                              |
| Tool call  | A `pi.tool-result` entry: tool name, error flag, `durationMs`, and its own usage when the tool called a model.                                                                         |
| Compaction | A `pi.compaction` entry and its reason.                                                                                                                                                |
| Side-call  | An `llm_calls` row (below).                                                                                                                                                            |

The projection lives in `packages/agent/src/trace.ts` (`traceOf`), and the
runtime exposes it as `AgentRuntime.trace(ref)` and `AgentRuntime.usage(ref)`.
Turn inputs are clipped to 200 characters and errors to 300; the full
messages stay in the chat, which **Open chat** links to.

Claude plan turns keep only their model in their entries, so they list with
"usage not reported".

## Side-calls

One-shot model calls made outside any conversation (memory capture, Past
chat titles, Code thread and PR names, the
auto-review classifier) leave one row each in `llm_calls`: purpose, bot,
model, tokens, cost, duration, outcome and a short error. Never the prompt or
the answer. `side-call.ts` and the classifier wrapper in `bots.runtime.ts`
write them through `recordLlmCall` (`server/api/traces/traces.calls.ts`),
which also prunes rows older than 30 days.

## API

All under `/api/v1`, owner only:

- `GET /traces/summary`: the last 7 days (sessions active in it, side-calls made in it).
- `GET /traces/sessions?kind=chats|routine|delivery&before=<ms>`: 30 sessions a page, newest activity first.
- `GET /traces/sessions/:id`: one session's totals and turns.
- `GET /traces/side-calls?before=<ms>`: 30 side-calls a page.

Field meanings follow the OpenTelemetry GenAI conventions (provider, model,
finish reason, input, output and cache tokens), so an OTLP exporter could map
them without a schema change.
