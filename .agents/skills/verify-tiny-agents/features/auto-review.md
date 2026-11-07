# Auto-review

A per-bot switch lets a small classifier approve low-risk Ask tool calls the owner clearly asked for, so they run without a card and show `auto-approved` on their row. It never denies; without a configured classifier, on a failure, for Ask (always) tools, vault uses and turns another bot started, the owner gets the card as before.

## Sub-features

- `review-switch` switch `Auto-review` in Edit bot → Tools, off by default, saved with the bot.
- `review-fallback` with no classifier configured, Ask calls keep their card.
- `review-ask-only` Ask (always) tools always show their card with Auto-review on.
- `review-approve` the classifier approves a call (row `auto-approved`): **unreachable in a verify run**.

## How to get to it (user POV)

- A bot's chat → `Edit <bot>` → tab `Tools` → switch `Auto-review` → `Save changes`.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. A faux bot with `toolPermissions: { browser_snapshot: "ask" }` (API setup).

- **Default.** Tools tab: `Auto-review` `aria-checked=false`; `GET /bots/:id` `autoReview: false`.
- **On.** Click it, `Save changes` → API `autoReview: true`; after a reload the switch is still checked.
- **Fallback.** Send `/browse 1 …` → card `<bot> wants to read the page`, no `auto-approved` anywhere; Deny.
- **Ask (always).** Send `/improve` → card `<bot> wants to update own instructions`; Deny.
- **Off.** Switch off, save → API `autoReview: false`.
- **Proof.** `ta-verify drive $S/journeys/auto-review.mjs` → `on`, `still-asks`, `off`.

## Gotchas

- Unreachable: an actual auto-approval. It needs a classifier model role (a Cloudflare AI Gateway account with network and a key; credits for `@cf/cloudflare/clef*`), and a real chat model whose request the classifier can judge. The faux runtime wires no reviewer at all, so even with the gateway keys a `TINY_AGENTS_FAUX=1` run never reviews.
- The server logs one `Auto-review` line per review; a verify run has none, which is expected.
- The switch is hidden while the Tools search box has text.
