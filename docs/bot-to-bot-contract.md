# Bot-to-bot contract (issue #12)

The `BotMessage` ledger in `app.db` is the single source of truth for cross-bot
delivery. Transcripts remain untouched: delivery, relay targets and loop caps
live in the ledger alone.

## Data model

```
BotMessage {
  id           cuid
  fromBotId    string?   // null = the owner (an @mention from the composer)
  toBotId      string    // receiving bot
  replyToBotId string?   // conversation that gets the answer; null = owner only
  kind         "send" | "mention" | "relay"
  requestId    string    // unique; the pi-durable submit requestId
  sourceKey    string?   // unique; durable tool-call identity (tool replays dedupe)
  text         string
  deliveredAt  DateTime? // submit receipt into toBotId's conversation
  answeredAt   DateTime? // relay receipt of the reply into replyToBotId
  createdAt    DateTime
}
```

Lifecycle (state machine, enforced by the relay):

```
pending ──submit──► delivered ──relay──► answered
```

## Interfaces

### 1. `BotMessagingStore` (packages/agent/src/toolkits/bots.ts)

The agent package sees only this app-provided store. `conversationId` keys
everything (tools run without bot ids).

```ts
export interface BotMessagingStore {
  /** Deliver a message into to's conversation. Idempotent on requestId. */
  deliver(input: {
    conversationId: number; // sender's conversation (api.conversationId)
    toName: string; // target bot name, resolved by the store
    text: string;
    requestId: string; // deterministic: survives pi-durable replays
    sourceKey: string; // durable tool-call identity (row dedupe)
  }): Promise<{ delivered: boolean; reason?: "unknown_bot" | "self" | "loop" | "busy_target" }>;
  /** Bot names the model can message (roster section). */
  roster(conversationId: number): Promise<{ name: string; description: string }[]>;
}
```

`deliver` semantics:

- Unknown target name or the sender itself → `{ delivered: false, reason }`.
- Loop guard: more than 8 `kind="send"` rows from the same sender to the same
  target in the last 10 minutes → `{ delivered: false, reason: "loop" }`.
- Target currently busy (its conversation is generating) → still deliver:
  pi-durable queues the input; it is answered next turn. `busy_target` reason
  is reserved and not returned in v1.
- Success: the row exists with `deliveredAt` set and the message was submitted
  into the target's conversation (the store owns the `submit` call).
- Fire-and-forget: the tool returns immediately; the reply arrives later as a
  new user turn in the sender's conversation (relayed by the app's relay).

### 2. Relay (apps/web/src/server/api/bots/bots.relay.ts)

On `runtime.onActivity` idle transitions (a conversation stopped replying):

1. Find `deliveredAt != null AND answeredAt = null` rows where `toBotId` just
   finished a reply.
2. Read the target's `lastMessage` (assistant text). If none, leave pending.
3. Submit `**Reply from {targetName}:** {text}` into `replyToBotId`'s
   conversation with requestId `botmsg-reply-{rowId}`; then set `answeredAt`.
4. Relay rows (`kind="relay"`) never relay again. Only `send` and `mention`
   kinds produce relays.

### 3. Mention routing (bots.service.ts)

`sendMessage(botId, { requestId, text })` with mentions:

- Frontend sends the raw text including `@Name` tokens; the client also puts
  the bot ids it resolved into the request: `{ requestId, text, mentions?: string[] }`.
- For each mention id ≠ host: create a `kind="mention"` row (fromBotId null,
  replyToBotId = host id) and deliver with requestId
  `mention-{hostRequestId}-{botId}`, text `[From {owner}] {text}` … the host's
  own submit gets the text unchanged.
- Tagged bot sees: `[From owner, in {hostName}'s chat] {text}`.

### 4. Agent runtime additions (packages/agent/src/runtime.ts)

None. The toolkit installs like `tasks`/`web`/`time` via `capabilities` at
open time; conversations select it with `configure`.

### 5. Client (apps/web/src/client)

- Composer: typing `@` (at text start or after whitespace) opens an overlay
  listing other bots (avatar + name + description, host excluded). Enter/Tab/click
  inserts `@Name `. Backdrop click or Esc closes.
- Mentions ship as `mentions: [botId, …]` on send.
- Transcript rendering (Grok-style cards): the pipeline's attribution prefixes
  are parsed at render time by `parsePeerEnvelope`
  (`@tiny-agents/agent/peer-envelope`) and drawn as attributed cards —
  relays (`**Reply from X:**`) and message_bot deliveries (`**Message from X
(bot):**`) as a peer-avatar card with a "reply relayed into this chat" /
  "messaged you" marker, owner mentions (`[From the owner, in Y's chat]`) as
  the owner's bubble with a "You · in Y's chat" label. The stored text and
  everything the model reads is unchanged (issue #13 custody). The
  `message_bot` tool call renders as the handoff pill: peer avatar, "Messaged
  {name}", and the outbound snippet. Bot-list previews strip the prefix via
  `stripPeerEnvelope` (both `previewOf` and `recordReply`).
