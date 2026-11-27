# ADR 0046: Code threads reach every connection and skill a bot chat reaches

- Status: **accepted** (amends [0042](0042-code-threads-use-shared-connections.md))
- Date: 2026-11-27

## Context

ADR 0042 gave Code threads only the connections and skills with `allBots`
on. The owner found that tools and skills they used in bot chats were
missing from Code. Two common cases fell outside `allBots`:

- a connection or skill the owner switched on for some bots, including any
  item migration 0038 left narrowed because not every bot had it;
- every skill a bot saved, since a saved skill stays with that bot (0041).

Code is for the owner only, so narrowing an item to some bots says which
bots get it, not that the owner wants it kept from their own coding.

## Decision

- **A Code thread reaches an item when it has `allBots` on, or when at least
  one bot reaches it** under the rules in
  `apps/web/src/server/api/bots/bot-reach.ts`. Project bots count.
- **An item no bot reaches stays out of Code.** Turning a connection or skill
  off for every bot is how the owner keeps it out.
- Everything else in 0042 holds: connections are deferred, Settings > Tools
  decides allow, ask and off, and `save_skill` stays off.

## Consequences

- What the owner can use in a bot chat they can use in Code, through both
  the Native and the Claude Code harness.
- Reaching Code costs one read of the reach links per call to
  `reachedConnections` or `reachedSkills`.
