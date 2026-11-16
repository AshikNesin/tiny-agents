# YOLO mode

In a bot's chat the owner can switch on YOLO mode: tool calls that would show an approval card run straight away instead, including Ask (always) tools. It asks for confirmation first, shows a banner above the composer while on, applies to that chat only, survives a reload, approves cards already waiting when it is switched on, and switches off with the banner's `Turn off` or a New chat.

## Sub-features

- `yolo-confirm` dialog `Turn on YOLO mode?` with `Cancel` / `Turn on`.
- `yolo-state` bot menu (header `<bot> menu`) row `data-testid=yolo-toggle` (`menuitemcheckbox`, `aria-checked`, `YOLO mode`) and banner `data-testid=yolo-banner` (`YOLO · no approval needed, except vault items`).
- `yolo-persist` the switch is server-side per chat: kept across reloads.
- `yolo-run` an Ask (always) call runs without a card; its row reads `auto-approved (YOLO)`.
- `yolo-waiting` switching on approves a card that is already waiting.
- `yolo-off` banner `Turn off` (or the bot menu's `YOLO mode` row) brings cards back.
- `yolo-new-chat` New chat starts with YOLO off.

## How to get to it (user POV)

- A bot's chat → header `<bot> menu` (the bot's name) → `YOLO mode`. Owners only; guests have no bot menu.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. A faux bot with a known system prompt (API setup).
- Faux trigger `/improve` makes the bot call `update_instructions` (Ask always) to append `Self-improvement e2e: append this line.`

- **Confirm.** Click the toggle → dialog → `Cancel`: still `aria-pressed=false`, no banner. Again → `Turn on`: pressed, banner shown. Reload: still on.
- **Run unasked.** Send `/improve`: no `<bot> wants to update own instructions` card, a row with `auto-approved (YOLO)`; `GET /bots/:id` `systemPrompt` contains the line once.
- **Off.** Banner `Turn off` → banner gone; `/improve` shows the card; prompt unchanged while it waits.
- **Approve waiting.** With that card up, switch YOLO on: the card goes, a second `Updated own instructions` row appears, the prompt now has the line twice.
- **New chat.** `Start a new chat` → `New chat`: toggle `aria-pressed=false`, no banner, also after reload.
- **Proof.** `ta-verify drive $S/journeys/yolo.mjs` → `on`, `auto-approved`, `card-again`, `waiting-approved`, `new-chat-off`.

## Gotchas

- A card approved by switching YOLO on is recorded as an ordinary approval: its row reads `… waited 1s for you`, not `auto-approved (YOLO)` (the docs only promise the YOLO marker for calls that ran under it). The journey asserts the call ran, not the marker.
- Vault uses, turns started by another bot or a guest, Questions and routines keep asking under YOLO; none of these is reachable on the faux model without a vault item (`SECRETS_KEY`) or a model that calls tools on a peer's turn.
- Use `/improve` (askOnly) rather than a toggled tool: it asks regardless of the bot's permissions.
