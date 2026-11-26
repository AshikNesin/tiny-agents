# ADR 0042: Code threads use the owner's shared connections

- Status: **accepted** (extends [0041](0041-bots-share-what-the-owner-sets-up.md))
- Date: 2026-11-26

## Context

Connections (remote MCP servers) reached bot chats only. A Code thread had
its coding tools and nothing else, so the owner could not read an issue
tracker or a mailbox from a coding session (issue #524). The first design
let a Code project borrow a bot's connections, because connections were
chosen bot by bot. ADR 0041 removed that reason: a connection now reaches
every bot unless the owner narrows it, and tool permissions are one map in
Settings > Tools.

## Decision

- **A Code thread gets every connection with `allBots` on**, with no
  project or thread setting. A connection narrowed to some bots stays out of
  Code. There is no bot to borrow.
- **Settings > Tools decides allow, ask and off** for those tools, as it does
  for bots. The coding mode's own permissions win for the coding tools.
- **They are deferred.** A shared connection is always deferred (0041), so a
  thread pays for one short `deferred_tools` line until the model loads a
  group with `tool_search`.
- **Native** threads get this through `nativeConfig` in
  `apps/web/src/server/api/code/code.registry.ts`, which re-reads the
  connections on every message, so a change applies from the next message.
- **Shelley** keeps its own MCP configuration.

## Consequences

- A connection the owner shares with every bot can be used from any Native
  Code thread, including in Bypass mode; Bypass covers only the coding tools,
  so a connection tool on "ask" still asks.
- Skills, vault and memory stay out of Code threads.
