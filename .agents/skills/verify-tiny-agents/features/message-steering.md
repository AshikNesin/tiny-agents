# Message steering

While a bot is replying, the composer stays live. Enter steers the running reply (the message joins it and gets answered), Alt+Enter or the queue button holds a follow-up for when the reply ends. Held messages show as rows over the composer, survive a reload and can be withdrawn with their x. Stop (or Esc) ends the reply and withdraws everything held.

## Sub-features

- `steer-buttons` one round action button: `Stop generating` while busy with nothing typed; typing turns it into `Steer the reply`, with `Queue for after this reply` beside it. Hint line `data-testid=composer-hint`: `Enter steers · Alt+Enter queues · Esc stops`.
- `steer-hold` Enter while busy: a held row `data-testid=queued-bubble` with `data-mode=steer` and the label `Steering`, in list `Waiting to send`.
- `steer-reload` held rows are server state and come back after a reload.
- `steer-cancel` the row's `Cancel this message` withdraws it; it never reaches the transcript.
- `steer-placed` a kept steer is placed when the current generation ends and the bot answers it in the same run.
- `steer-followup` Alt+Enter, or the `Queue for after this reply` button: `data-mode=followUp`, label `Queued`; answered after the reply.
- `steer-stop` Esc (or `Stop generating`) stops the reply and withdraws held messages.

## How to get to it (user POV)

- Any bot chat (`/chats/<botId>`): send a long message, then type into the composer while the reply streams.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. Faux model at 6 tokens/s (the `up` default), so a ~40-word message keeps the bot busy for a few seconds. A bot of the journey's own (`setup:` via the API).

- **Busy.** Send a long message; wait for `Stop generating`. The hint reads `Enter steers · Alt+Enter queues · Esc stops`. Type: `Steer the reply` and `Queue for after this reply` show, `Stop generating` is gone.
- **Steer + reload.** Press Enter: `queued-bubble` has `data-mode=steer`, text `Steering` and the message. `page.reload()`: the row is still there.
- **Cancel.** `Cancel this message`: the row is gone; after the reply ends the message text appears nowhere.
- **Kept steer.** New long message, Enter a steer, wait: `Echo: <steer>` shows and the row is gone.
- **Follow-up.** New long message, Alt+Enter: `data-mode=followUp`, text `Queued`; later `Echo: <follow-up>`. Same with the `Queue for after this reply` button.
- **Stop.** New long message, Alt+Enter a follow-up (composer clears), press Escape in the composer: the row is gone, `Send message` is back, the reply never finishes and the follow-up never lands.
- **Proof.** `ta-verify drive $S/journeys/message-steering.mjs` → `message-steering/busy-typing`, `held-after-reload`, `steer-answered`, `followup-queued`, `stopped`.

## Gotchas

- With a text-only reply there is no tool round to steer into, so a steer places at the generation's end and the run continues with another generation: the steer's echo arrives after the first echo, not inside it.
- `Stop generating` only shows with an empty composer; to stop while text is typed, press Escape in the composer.
- Each long reply takes several seconds at 6 tokens/s: wait for `Send message` before starting the next scenario, or the new message is itself a steer.
