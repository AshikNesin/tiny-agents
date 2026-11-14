# Auto-review

A bot's **Ask** tools wait for your approval card. With **Auto-review** on, a
small classifier looks at each such call first: when you clearly asked for it
and the worst case is minor, it runs without a card. Anything else still asks
you (issue #65).

Turn it on per bot in **Edit bot → Tools → Auto-review**. It is off by default.

## What it can and cannot do

- It only **removes** cards. It never denies a call and never touches tools set
  to **Allow** or **Off**. When it does not approve, or fails (an error, a
  timeout after 10 seconds, a malformed reply), you get the card exactly as
  before.
- These always ask, whatever the classifier says:
  - vault uses (logins, cards, API keys: their own policy decides),
  - **Ask (always)** tools (`askOnly`, e.g. saving a skill),
  - turns another bot started (a message from another bot is not your
    request),
  - in a shared bot's chat, turns a guest started: as with YOLO, only your
    own messages are your request.
- Auto-approved calls show **auto-approved** on their row in the chat, and the
  server logs one `Auto-review` line per review (tool, scores, outcome,
  duration; never the call's arguments).

## How it decides

The classifier gets three things:

- the bot's instructions,
- your latest five messages in the chat (never a guest's, in a shared chat),
- the pending call: tool name and arguments.

It never sees tool results, web pages or emails, which is where injected
instructions come from. It answers two questions:

| Question    | Type        | Approves when                                  |
| ----------- | ----------- | ---------------------------------------------- |
| `requested` | yes/no      | P(you asked for this exact action) ≥ 0.9       |
| `risk`      | score 0 – 3 | worst-outcome score ≤ 1, with confidence ≥ 0.6 |

The questions and thresholds live in `packages/agent/src/reviewer.ts`
(`REVIEW_QUESTIONS`, `REVIEW_THRESHOLDS`). The Tool gate (`gate.ts`,
[ADR 0014](../adr/0014-tool-gate-and-engine-seam.md)) asks the reviewer, on pi
and on the Claude plan alike. A verdict is stored with the call, so a restart
never reviews the same call twice.

## Setup

The classifier is the `classifier` model role (Settings → Models,
[Models](./models.md#model-roles)): a classifier model of a Cloudflare AI
Gateway account, such as TypeSafe's
[Jev](https://developers.cloudflare.com/ai/models/typesafe/jev/) (`typesafe/jev`)
on Workers AI. Adding a gateway account lists its Workers AI classifiers next
to its chat models; pick one under Default models → Auto-review. Calls go to
Workers AI's `/accounts/{account}/ai/run` with the `cf-aig-gateway-id` header
(Cloudflare's recommended gateway route), so every review shows up in the
gateway's logs. The account's key is sent as `Authorization` and as
`cf-aig-authorization`. A failed review logs
`Auto-review failed; asking the owner` with the error.

Through the gateway, Cloudflare's own `@cf/cloudflare/clef*` models bill
against the gateway's **Unified Billing** credits. Without credits every call
answers `402 Insufficient unified billing credits` and every call gets a card,
so use them only on a gateway with credits.

With no classifier role set, every review fails and bots with auto-review on
keep every card.

## Cost

Jev costs $0.042 per million input tokens, and output is free. A review is
roughly 300–2k tokens, so about $0.0001 per review, charged to the gateway.
[Pricing](https://developers.cloudflare.com/ai/models/typesafe/jev/).

## Another classifier

Callers depend on the `Classifier` interface in
`packages/agent/src/classifier.ts`, not on Jev. pi-ai already speaks the
System One formats of every Workers AI classifier, so switching to Clef is
picking `@cf/cloudflare/clef` as the classifier role. Its probabilities may sit differently
from Jev's, so check the thresholds before relying on it. A classifier on
another provider is a new provider kind whose classifier models the catalog routes.
