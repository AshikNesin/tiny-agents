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
- A send runs in a fresh conversation of the target's own
  (`ownConversation` on the row), unattended and with a routine run's
  500k-token budget, like a routine run: the target's chat history never
  rides along, and a routine that messages a bot cannot escape its own
  budget. So a busy target answers at once, and the message must carry its
  own context. Owner @mentions still land in the target's chat.
- Success: the row exists with `deliveredAt` set and the message was submitted
  into the conversation pinned on the row (the store owns the `submit` call).
- A chat shared with guests reaches only bots every guest of that chat can
  open: another bot is refused with `{ delivered: false, reason: "shared" }`,
  like the other refusals privileged in a shared chat, and the roster lists
  only those bots. A routine run and the owner's own chat are unlimited.
- Fire-and-forget: the tool returns immediately; the reply arrives later as a
  new user turn in the sender's conversation (relayed by the app's relay).

### 2. Relay (apps/web/src/server/api/bots/bots.delivery.ts)

The first step of the settled pipeline (`startSettledPipeline`,
`bots.settled.ts`; see Settled and Delivery in GLOSSARY.md) answers a
conversation's Deliveries when it settles; its boot sweep answers those a
restart left behind. Both are the Delivery adapter of the Awaited submission
module (`bots.awaited.ts`), which Routine runs share.

1. Find `deliveredAt != null AND answeredAt = null` rows pinned to the
   conversation that settled.
2. Read the Finished reply to each row's request id (`finishedReplyTo`). If
   it has not finished, or is not in the transcript yet, leave it pending.
3. Submit `**Reply from {targetName}:** {text}` into `replyToBotId`'s
   conversation through `submitToBot` (`bots.conversation.ts`, which
   reconciles the host first) with requestId `botmsg-reply-{rowId}`; then
   set `answeredAt`.
4. At boot, a row on an idle conversation with no Finished reply was cut off
   by the restart (the runtime resumes interrupted turns before the sweep, so
   one still running shows busy and waits for its idle). It is closed, and
   the asking bot gets `(couldn't answer: interrupted by a server restart)`,
   unless the row was delivered more than a day ago: then it closes quietly.
5. Relay rows (`kind="relay"`) never relay again. Only `send` and `mention`
   kinds produce relays.

### 3. Mention routing (chats.service.ts)

`sendMessage(botId, { requestId, text })` with mentions:

- Frontend sends the raw text including `@Name` tokens; the client also puts
  the bot ids it resolved into the request: `{ requestId, text, mentions?: string[] }`.
- For each mention id ≠ host: create a `kind="mention"` row (fromBotId null,
  replyToBotId = host id) and deliver with requestId
  `mention-{hostRequestId}-{botId}`, text `[From {sender}, in {hostName}'s
  chat] {text}` … the host's own submit gets the text unchanged. The sender is
  `the owner`, or the name of the guest who wrote the message: a guest's words
  are never framed as the owner's, and the entry carries that guest as its
  `author`.
- A guest's mention reaches only the bots that guest can open
  (`openableBots` in `people/access.ts`, the same share the guest guard
  checks); the others are dropped without an error, as unknown ids are.
- Tagged bot sees the same `[From {sender}, in {hostName}'s chat] {text}`
  prefix — one mention format everywhere (the model-facing custody line).

### 4. Agent runtime additions (packages/agent/src/runtime.ts)

`finishedReplies(ref)` for the relay (step 2). The toolkit installs like
`tasks`/`web` via `capabilities` at open time; conversations select it with
`configure`.

### 5. Client (apps/web/src/client)

- Composer: typing `@` (at text start or after whitespace) opens an overlay
  listing other bots (avatar + name + description, host excluded). Enter/Tab/click
  inserts `@Name `. Backdrop click or Esc closes.
- Mentions ship as `mentions: [botId, …]` on send.
- Transcript rendering (Grok-style cards): attribution is **trusted entry
  metadata** (`peer` on the `chat.user` entry, set by relay/message_bot/mention
  delivery), not parsed from the message text — a typed text that merely looks
  like a prefix renders as a plain bubble. The prefix itself stays in the
  stored text for the model (issue #13 custody) and is stripped for the card;
  cards are drawn only when the `peer` metadata is present.
  relays (`**Reply from X:**`) and message_bot deliveries (`**Message from X
  (bot):**`) as a peer-avatar card with a "reply relayed into this chat" /
  "messaged you" marker, owner mentions (`[From the owner, in Y's chat]`) as
  the owner's bubble with a "You · in Y's chat" label. The stored text and
  everything the model reads is unchanged (issue #13 custody). The
  `message_bot` tool call renders as the handoff pill: peer avatar, "Messaged
  {name}", and the outbound snippet. Bot-list previews strip the prefix via
  `stripPeerEnvelope` (both `previewOf` and `recordReply`).
