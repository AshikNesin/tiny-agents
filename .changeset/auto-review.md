---
"@tiny-agents/agent": minor
"groot": minor
"@groot/web": minor
---

Add auto-review (issue #65): a per-bot switch that lets a classifier approve
low-risk "Ask" tool calls the owner clearly asked for, so they run without an
approval card. The reviewer can only remove a card, never deny: a call it does
not approve, a classifier error or a timeout shows the card as before. Vault
uses and askOnly tools always ask, and so do turns another bot started. The
classifier reads the bot's instructions, the owner's latest messages and the
pending call, never tool results.

The agent package gains `Classifier` / `createClassifier` (Workers AI
classifiers through pi-ai: Clef by default, any other via `CLASSIFIER_MODEL`,
e.g. `typesafe/jev`), `createReviewer`, the `reviewer` runtime option and
`CapabilitySelection.autoReview`. Gated results of auto-approved calls carry
`approval: "auto"`, and chat tool calls show it. The schema adds
`Bot.autoReview` (default off). New env var: `CLASSIFIER_MODEL`. See
docs/features/auto-review.md.
