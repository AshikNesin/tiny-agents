# Bot to bot

In a bot's chat the owner can @mention another bot. The mentioned bot gets the message, labeled as coming from the owner in the host's chat, and its answer is relayed back into the host chat as a card naming the peer, so the whole exchange is watchable in one place.

## Sub-features

- `b2b-hint` with two or more bots the composer shows `Type @ to tag another bot` until a mention is used.
- `b2b-autocomplete` typing `@` + a prefix opens listbox `Mention a bot` with matching bots (never the host); a non-matching prefix closes it; click or Enter inserts `@<full name>`.
- `b2b-menu` composer `Add files or mention a bot` → `Mention a bot` inserts `@` and should open the list.
- `b2b-relay` the peer's reply shows in the host chat as `data-testid=peer-card`: `<peer> · reply relayed into this chat`, payload `Echo: [From the owner, in …]`.
- `b2b-peer-chat` the peer's own chat shows the owner's message labeled `You · in <host>'s chat`.

## How to get to it (user POV)

- Any bot chat with at least one other bot: type `@` in the composer, or press `+` → `Mention a bot`.
- The peer's chat: its link in the sidebar `Bots` region.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. Two faux bots `Relay Peer <stamp>` and `Relay Host <stamp>` (API setup), host chat open.

- **Hint.** `data-testid=composer-hint` reads `Type @ to tag another bot`.
- **Autocomplete.** Type (key by key) `@Relay` → option `Relay Peer <stamp>`, no option for the host; type `zz` → listbox gone.
- **Pick.** Type `what do you think @Relay`, click the option → composer value `what do you think @Relay Peer <stamp> `.
- **Send + relay.** Add `ping <stamp>`, Enter. Within ~45 s a peer card for the peer contains `reply relayed into this chat`, `Echo: [From the owner` and `ping <stamp>`; no bubble shows `Reply from <peer>:`.
- **Peer chat.** Open the peer's sidebar link: `You · in <host>'s chat` and the ping text; no bubble shows `From the owner, in`.
- **Menu.** Back in the host chat, fill `second thought `, `+` → `Mention a bot`: the composer must keep focus with the list open, Enter picks the bot (regression check for #167).
- **Proof.** `ta-verify drive $S/journeys/bot-to-bot.mjs` → `mention-picked`, `relayed`, `peer-chat` (and `failure` for the menu step while the bug stands).

## Gotchas

- Regression check for #167 (fixed 2026-11): `+` → `Mention a bot` used to insert `@` while the closing menu returned focus to `+`, so the list never opened. The step runs last, so the relay proofs are captured either way.
- The mention query is the word after `@` up to the caret, without spaces: type `@Relay`, not `@Relay Peer`. `fill()` does not move the tracked caret reliably; use `pressSequentially`.
- An unanchored `getByText(/Echo: …/)` can match the whole transcript's text; scope to the peer card or anchor the regex.
- `message_bot` (the bot messaging a peer on its own, `data-testid=bot-handoff`) needs a model that calls tools; the faux bot never does.
