# Questions for the owner

A bot can stop mid-reply and ask the owner questions. The chat shows a questionnaire card (one question per step: single choice as radios, multiple choice as checkboxes, open questions as a text box) and the sidebar shows a badge; the reply waits, across reloads, until the owner answers, skips, dismisses, or writes in the chat. The bot then goes on with the answers, and the card collapses into an `Asked you N questions` row that expands to each answer.

## Sub-features

- `questions-card` `data-testid=question-card` (group `Questions from <bot>`) with `<bot> has 3 questions for you`, `Question n of 3`, and a `Dismiss` button.
- `questions-badge` sidebar badge labelled `1 question for you`; `GET /api/v1/bots` has `questions: 1`.
- `questions-reload` the waiting card survives a reload.
- `questions-answer` radio answers on click and moves on; checkboxes + `Next`; open text box named after the question; `Send answers`.
- `questions-echo` the bot gets one `Q:` / `A:` pair per question (faux echoes `Echo: The owner answered your questions …`).
- `questions-trace` the answered call collapses to button `Asked you 3 questions`, expanding to each answer.
- `questions-skip` `Skip` sends `A: (skipped)` for that question.
- `questions-dismiss` `Dismiss`: the bot goes on (`Echo: The owner dismissed these questions …`).
- `questions-chat-dismiss` writing in the chat while the card waits dismisses it (`dismissed by you`) and the message is answered.

## How to get to it (user POV)

- A bot's chat whose model calls `ask_owner`. With the faux model, send a message starting with `/ask`.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. A bot of the journey's own (`setup:` via the API). `ask_owner` is on (the default **Allow**).

- **Ask.** Send `/ask <stamp>`. The card shows `<bot> has 3 questions for you` and `Which stack should the project use?`; badge `1 question for you`.
- **Reload.** `page.reload()`; the card is back.
- **Answer.** Radio `React` → `Question 2 of 3`; checkboxes `Auth`, `Tests`, `Next`; textbox `Anything else I should know?` → text; `Send answers`. Card gone.
- **Echo.** `Echo: The owner answered your questions`, `A: React`, `A: Auth; Tests`, `A: <text>` visible; badge gone.
- **Trace.** Click `Asked you 3 questions`: the open answer and `Auth, Tests` show.
- **Skip.** `/ask` again, radio `Svelte`, `Skip`, text, `Send answers`: `A: (skipped)` echoed.
- **Dismiss.** `/ask` again, `Dismiss`: `Echo: The owner dismissed these questions` arrives.
- **Write instead.** `/ask` again, then send a normal message: card gone, `dismissed by you`, the message is echoed.
- **Proof.** `ta-verify drive $S/journeys/questions.mjs` → `questions/asked`, `answering`, `answered`, `dismissed`, `chat-dismissed`.

## Gotchas

- The bot receives a multiple-choice answer joined with `; ` (`A: Auth; Tests`), while the trace row shows it joined with `, ` (`Auth, Tests`).
- The echoes of the answers are long and stream at 6 tokens/s: allow ~60 s.
- Wait for `Send message` (idle) before the next `/ask`, or it steers into the previous reply.
- A single-choice question answers on the click, so there is no `Next` on question 1.
- Read-only past chats show waiting cards as not answered, with no buttons.
