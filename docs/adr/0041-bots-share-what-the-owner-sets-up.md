# ADR 0041: Bots share what the owner sets up, guests included

- Status: **accepted** (extends [0004](0004-every-bot-has-every-toolkit.md))
- Date: 2026-11-26

## Context

Built-in toolkits already reached every bot (0004), and so did vault items
(`vault_items.bots_json` null). Connections and skills did not. Each one was
off for every bot until the owner switched it on bot by bot, and tool
permissions were kept per bot, so "Always allow" covered only the bot that
asked. The owner found this mapping too much work (issue #559). The Grok Bot
model works the other way: a connector is set up once for the account, and
the guardrail is approval when a tool is used.

The first draft kept bots shared with guests out of the shared default,
because read-only connection tools run without asking and a guest could
read the owner's data through them. The owner rejected that guardrail. A
guest on a shared bot is someone the owner chose to work with, and the
owner wants a guest to use the same GitHub connection the owner uses.

## Decision

- **Connections and skills reach every bot by default.** `allBots` is on for
  a new connection or skill. A `bot_connections` or `bot_skills` row is an
  exception: `enabled` false turns the item off for one bot, and true gives
  it to a bot the default leaves out. With `allBots` off, only bots with an
  enabled row get the item. The rules live in
  `apps/web/src/server/api/bots/bot-reach.ts`.
- **Guests are not a boundary.** A bot shared with guests gets the same
  connections, skills and tool permissions as any other bot. What protects
  the owner is the bot's tool permissions: effectful tools ask the owner,
  only the owner can answer a vault use or a skill save, and only the owner
  can "Always allow".
- **Project bots are left out of the default.** A project chat (0040) keeps
  its fixed toolkit set and gets a connection or skill only through an
  enabled row.
- **A skill a bot saves stays with that bot** until the owner widens it.
- **A shared connection is always deferred** behind `tool_search`, whatever
  its size, and `deferred_tools` names at most 8 of its tools. Sharing a
  connection costs each request one short line, not its tool schemas.
- **Tool permissions are set once.** Settings > Tools holds one map that
  every bot starts from, and a bot's own entry wins for that bot. "Allow for
  every bot" on an approval card writes that map and drops the bot's own
  entry.
- Migration 0038 keeps every bot's current set. A connection or skill that
  every non-project bot already had becomes shared. Everything else keeps
  its list.

## Consequences

- Adding a connection or skill is one step, and bots made later get it too.
- A guest on a shared bot can run the owner's read-only connection tools
  without asking. An owner who does not want that sets the tool to Ask or
  Off for that bot, or turns the connection off for it.
- Every bot pays a few tokens per shared connection for its
  `deferred_tools` line, and the first use of one costs a `tool_search`
  round trip.

## Alternatives considered

- **Keep guest-shared bots out of the default.** Safer for owner data, but
  the owner wants guests to use the shared connections.
- **Presets or bot groups.** A mapping by another name. It still has to be
  kept up to date as connections are added.
- **An "Add to all bots" button with opt-in kept.** Fewer clicks today, but
  every new bot still starts without the connection.
