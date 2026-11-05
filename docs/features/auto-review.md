# Auto-review

A bot's **Ask** tools wait for your approval card. With **Auto-review** on, a
small classifier looks at each such call first: when you clearly asked for it
and the worst case is minor, it runs without a card. Anything else still asks
you (issue #65).

Turn it on per bot in **Edit bot → Tools → Auto-review**. It is off by default.

## What it can and cannot do

- It only **removes** cards. It never denies a call and never touches tools set
  to **Allow** or **Off**. When it does not approve, or fails (an error, a
  timeout, a malformed reply), you get the card exactly as before.
- These always ask, whatever the classifier says:
  - vault uses (logins, cards, API keys: their own policy decides),
  - **Ask (always)** tools (`askOnly`, e.g. saving a skill),
  - turns another bot started (a message from another bot is not your
    request).
- Auto-approved calls show **auto-approved** on their row in the chat, and the
  server logs one `Auto-review` line per review (tool, scores, outcome,
  duration; never the call's arguments).

## How it decides

The classifier gets three things:

- the bot's instructions,
- your latest five messages in the chat,
- the pending call: tool name and arguments.

It never sees tool results, web pages or emails, which is where injected
instructions come from. It answers two questions:

| Question    | Type        | Approves when                                  |
| ----------- | ----------- | ---------------------------------------------- |
| `requested` | yes/no      | P(you asked for this exact action) ≥ 0.9       |
| `risk`      | score 0 – 3 | worst-outcome score ≤ 1, with confidence ≥ 0.6 |

The questions and thresholds live in `packages/agent/src/reviewer.ts`
(`REVIEW_QUESTIONS`, `REVIEW_THRESHOLDS`). The Tool gate (`gate.ts`,
[ADR 0013](../adr/0013-tool-gate-and-engine-seam.md)) asks the reviewer, on pi
and on the Claude plan alike. A verdict is stored with the call, so a restart
never reviews the same call twice.

## Setup

The classifier is Cloudflare's [Clef](https://developers.cloudflare.com/workers-ai/models/clef/)
on Workers AI, called through your Cloudflare AI Gateway (its `workers-ai`
route) with the same settings as chat models: `CLOUDFLARE_API_KEY` (sent as
`cf-aig-authorization`), `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_GATEWAY_ID`.
Every review shows up in the gateway's logs.

| Var                | Default               | What it is                                                             |
| ------------------ | --------------------- | ---------------------------------------------------------------------- |
| `CLASSIFIER_MODEL` | `@cf/cloudflare/clef` | Any Workers AI classifier: `@cf/cloudflare/clef-flash`, `typesafe/jev` |

Without the gateway settings, bots with auto-review on keep every card. An
unknown `CLASSIFIER_MODEL` logs a warning at boot and turns it off.

## Cost

Clef costs $0.24 per million input tokens, and output is free. A review is
roughly 1–2k tokens, so the Workers AI free allocation (10,000 Neurons a day,
about 458k Clef input tokens) covers about 230–450 reviews a day. On Workers
Paid, more costs about $0.0005 per review. On Workers Free, calls fail after
the daily allocation until 00:00 UTC, and you just get cards again.
[Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## Another classifier

Callers depend on the `Classifier` interface in
`packages/agent/src/classifier.ts`, not on Clef. pi-ai already speaks the
System One formats of every Workers AI classifier, so switching to TypeSafe's
Jev is `CLASSIFIER_MODEL=typesafe/jev`. Its probabilities may sit differently
from Clef's, so check the thresholds before relying on it. A classifier on
another provider is a new `Classifier` built with `classifierFromModels`.
