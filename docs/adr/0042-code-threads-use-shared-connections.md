# ADR 0042: Code threads use the owner's shared connections and skills

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
- **Claude Code** threads get each shared connection as an in-process SDK
  MCP server on the worker, so tools keep their `mcp__<slug>__<tool>` names.
  The tool's body only sends a `tool_call` event back to the app, which runs
  the call on its own connection, so OAuth tokens never reach the sandbox. A
  tool on "ask" raises the thread's usual approval card from inside the call,
  so it asks in every permission mode, Bypass included; the tools are on
  `allowedTools` so Claude Code does not ask a second time. The worker turns
  on Claude Code's own tool search (`ENABLE_TOOL_SEARCH`) unless the worker's
  environment sets it, so tool schemas load on demand. The list is read when
  the Claude Code process starts, so a change applies to the next process.
- **Skills shared with every bot** reach Code threads the same way. Native
  threads get the `skills` toolkit (a name and description per skill, the
  body only on `load_skill`), with `save_skill` off because a Code thread has
  no bot to save to. Claude Code threads get them as a local plugin the
  worker writes under `~/.tiny-agents/code-skills/<session>/`
  (`packages/claude-worker/src/coding-skills.ts`) and passes with the SDK's
  `plugins` option, so Claude Code lists descriptions and loads a body only
  when it uses the skill. A skill file path that leaves its skill's folder is
  skipped.
- **Shelley** keeps its own MCP configuration and skills.

## Consequences

- A connection the owner shares with every bot can be used from any Native
  or Claude Code thread, including in Bypass mode; Bypass covers only the
  coding tools, so a connection tool on "ask" still asks.
- A Claude Code tool call that is running when the app restarts runs again
  once the app reconnects, since only the worker's `tool_call_closed` event
  marks it done. A call the app never answers fails after ten minutes.
- Vault and memory stay out of Code threads.
