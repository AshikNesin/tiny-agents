# Questions for the Owner (human in the loop)

A bot can stop mid-reply and ask the owner clarifying questions. The chat
shows them as a questionnaire card; the reply waits until the owner answers
(or dismisses them) and then goes on with the answers.

## Behavior

| Owner action                         | What the bot gets                                                   |
| ------------------------------------ | ------------------------------------------------------------------- |
| Picks options / types and sends      | One `Q:` / `A:` pair per question as the tool result                |
| Skips a question                     | `A: (skipped)` for that question                                    |
| Dismiss                              | "The owner dismissed these questions …": go on, state assumptions   |
| Writes in the chat instead           | The dismissal, then the owner's message right after (a steer joins) |
| Stop                                 | The reply ends; the call is `aborted`                               |
| Nothing (closes the tab, restarts …) | Keeps waiting: the questions survive reloads and server restarts    |

The card is the [shadcn Questionnaire](https://ui.shadcn.com/docs/react/questionnaire)
(`@shadcn/react/questionnaire`, headless) styled like the approval card: one
question per step with Back / Skip / Next / Send answers, options as radios
(checkboxes when the question takes several), number keys 1–9 to pick, an
"Other" field for an answer in the owner's own words (exclusive with the
options on a single-choice question), and a Dismiss button. Once answered,
the call collapses into an "Asked you N questions" trace row that expands to
each question and answer.

While questions wait, the bot's sidebar row shows the count badge (with
approvals: "1 awaiting approval, 2 questions for you").

## The tool

`ask_owner` takes 1–4 questions, each with an optional `description`,
optional `options` (2–6 `{ label, description? }`; none makes it an open
question) and `multiple`. The tool trims the questions and drops repeated
options before showing them. It is a read-only tool (default **Allow**), so it
needs no approval; set it to **Off** in a bot's Tools tab to stop that bot
from asking.

## Architecture

```
model calls ask_owner → waitForOwner (waiting.ts, the approval gate's wait)
  → task-scoped tiny.questions doc { status: pending, questions, answers }
  → details { question: "pending", questions } → transcript: status awaiting_answer
  → SSE → QuestionCard (Questionnaire) ── POST /bots/:id/questions/:taskId
                                          { answers } | { dismissed: true }
  → AgentRuntime.answerQuestions → checkAnswers → doc answered | dismissed
  → the call resumes → tool result for the model, details { question, questions, answers }
owner send while questions wait → submit (steer) → AgentRuntime.dismissQuestions
```

- **Durable wait.** The same mechanism as approvals: the call is
  `replay: "safe"`, so after a restart it re-runs, finds its document and
  keeps waiting, or acts on answers recorded meanwhile. A `WaitTracker` per
  kind counts waiting calls per conversation for the activity feed
  (`ActivityChange.questions`, `BotListEntry.questions`).
- **The runtime owns it.** `AgentRuntime.open` installs the `questions`
  capability itself (it answers the document); the app enables it for every
  bot through `BOT_TOOLKITS`.
- **Validation.** `answerQuestions` refuses (`InvalidAnswersError` → 400) a
  wrong answer count, a pick that is not an option, several picks on a
  single-choice question and an over-long own-words answer, and
  (`QuestionNotPendingError` → 409) a call that was answered, ended, or never
  asked questions.
- **No deadlock on chat messages.** A waiting call blocks the reply, so an
  owner message would only queue behind it. `sendMessage` submits the message
  first, then dismisses the waiting questions, so the bot reads it right
  after the tool result.

Like approvals, questions asked during a bot-to-bot delivery wait until the
owner opens that bot's chat. A routine run never waits: nobody watches a
routine's conversation, so `ask_owner` returns at once and tells the model to
carry on and put open questions in its reply (see [routines](./routines.md)).

## Module structure

```
packages/agent/src/
├── waiting.ts              # WaitTracker + waitForOwner (shared with approvals.ts)
├── toolkits/questions.ts   # ask_owner, QuestionsDoc, checkAnswers
├── transcript.ts           # details → ChatToolCall.questions / answers / awaiting_answer
└── runtime.ts              # pendingQuestions, answerQuestions, dismissQuestions
apps/web/src/server/api/bots/
├── bots.routes.ts          # POST /bots/:id/questions/:taskId
└── bots.service.ts         # answerQuestions, dismiss on owner send, list count
apps/web/src/client/components/QuestionCard.tsx   # QuestionCard + AskedQuestions
```

## Trying it without a model

With `TINY_AGENTS_FAUX=1 pnpm dev`, send a message starting with `/ask`: the
faux bot asks a single-choice, a multiple-choice and an open question, then
echoes the answers it gets back. `tests/e2e/questions.spec.ts` drives the
same flow.
