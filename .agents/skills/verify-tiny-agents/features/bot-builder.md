# Bot builder

A bot can create a new bot when the owner asks for one. The request always waits on an approval card naming the new bot, with its instructions behind Read more; nothing is created until the owner approves, a denial creates nothing, and an approved bot appears in the sidebar with the proposed name, description, model and instructions.

## Sub-features

- `builder-card` card `<bot> wants to create a new bot — “<new name>”`; instructions over 120 characters fold behind `Read more`.
- `builder-deny` Deny: row `Created bot “<new name>” … denied by you`, no bot with that name.
- `builder-approve` Approve: row `Created bot “<new name>”`; expanding it shows `The owner can open it at /chats/<id>`; the sidebar lists the new bot without a reload.
- `builder-result` the new bot's chat opens; `Edit <new bot>` shows the proposed description, the creating bot's model and the instructions as `System prompt`.
- `builder-permission` Tools tab: `Create a new bot permission` offers only `Ask (always)` and `Off`.

## How to get to it (user POV)

- In a bot's chat, ask it for a new bot; the bot calls `create_bot` and the card appears in the transcript.
- The result: sidebar region `Bots` → the new bot → `Edit <new bot>`.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. A faux bot `Builder Bot <stamp>` on `test-model` (API setup).
- Faux trigger: `/newbot NAME` calls `create_bot` with that name, description `Made by the bot-builder e2e` and two lines of instructions ending `The owner reads these instructions on the approval card before the bot exists.`

- **Permission.** `Edit <bot>` → `Tools`: radiogroup `Create a new bot permission` has `Ask (always)` on and no `Allow`.
- **Card.** Send `/newbot Built Bot <stamp>` → card naming the new bot; `Read more` reveals the instructions.
- **Deny.** `Deny` → denied row; `GET /bots` has no bot of that name.
- **Approve.** `/newbot` again → `Approve` → `GET /bots` lists it; the ran row expands to the `/chats/<id>` line; the sidebar shows it.
- **Second view.** Open `/chats/<id>`, `Edit <new bot>`: `System prompt` equals the proposed instructions; the model is `test-model`.
- **Proof.** `ta-verify drive $S/journeys/bot-builder.mjs` → `card`, `denied`, `approved`, `created-editor`.

## Gotchas

- The card's one-line title shows the new bot's name, not the instructions; instructions of 120 characters or fewer are not shown on the card at all.
- After the approved call the faux bot echoes the user's `/newbot` text, not the tool result; assert on the tool row instead.
- Routine runs, other bots' messages and chats shared with guests are refused server-side; the faux model cannot produce those turns here, so they are covered by `tests/server/api/bots/bot-builder.store.test.ts`, not driven.
- Cleanup deletes both bots; the created one is found by name.
