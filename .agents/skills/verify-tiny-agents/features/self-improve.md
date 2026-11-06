# Self-improvement

A bot can propose a change to its own instructions (system prompt). The proposal always waits on an approval card that shows the proposed text; nothing changes until the owner approves, a denial leaves the instructions alone, and an approved change is visible in the bot's editor and applies from the next message.

## Sub-features

- `improve-card` card `<bot> wants to update own instructions — “<start of the change>”`.
- `improve-deny` Deny: row `Updated own instructions … denied by you`, instructions unchanged.
- `improve-approve` Approve: row `Updated own instructions …`, the text is appended to the system prompt.
- `improve-always-asks` Always allow does not stop future asks (the tool is Ask (always)).
- `improve-read-more` proposals over 120 characters fold behind `Read more` / `Read less` (`aria-expanded`).
- `improve-permission` Tools tab: `Update own instructions permission` offers only `Ask (always)` and `Off`.

## How to get to it (user POV)

- In a bot's chat, the bot calls `update_instructions` on its own; the card appears in the transcript.
- The result: `Edit <bot>` → `Profile` → `System prompt`.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. A faux bot with system prompt `Base prompt <stamp>.` (API setup).
- Faux triggers: `/improve` appends `Self-improvement e2e: append this line.`; `/improve long` appends a three-line paragraph ending `This line exists only to push the payload over the fold threshold.`

- **Permission.** `Edit <bot>` → `Tools`: radiogroup `Update own instructions permission` has `Ask (always)` on and no `Allow`.
- **Card.** Send `/improve` → card containing the line, no `Read more`.
- **Deny.** `Deny` → denied row; `GET /bots/:id` `systemPrompt` equals the base.
- **Approve.** `/improve` → `Approve` → prompt contains base + line. Reload, `Edit <bot>`: `System prompt` field shows both.
- **Always allow.** `/improve` → `Always allow` (applies); `/improve` again still shows the card (deny it).
- **Read more.** `/improve long` → `Read more` (`aria-expanded=false`), the last line hidden; click → `Read less` (`true`), whole text visible; `Approve` → prompt contains the paragraph.
- **Proof.** `ta-verify drive $S/journeys/self-improve.mjs` → `card`, `denied`, `approved-editor`, `read-more`.

## Gotchas

- Rows use the done-label `Updated own instructions` even when denied; match `/^Updated own instructions .* denied by you/`.
- The faux bot only triggers on a message that starts with `/improve`, and only in a turn without tool results yet.
- There is no UI for the `prompt_revisions` history; only the current prompt is observable.
- A peer or routine turn calling `update_instructions` is refused server-side; the faux model cannot produce that call from a peer delivery, so it is not driven here.
