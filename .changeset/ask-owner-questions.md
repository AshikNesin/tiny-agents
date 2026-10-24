---
"@tiny-agents/agent": minor
"@groot/web": minor
---

Bots can ask the owner clarifying questions mid-reply (human in the loop).
The new `ask_owner` tool (runtime-installed `questions` capability, read-only)
takes 1–4 questions with optional options and multiple choice, and waits
durably — the approval gate's wait, now shared as `waitForOwner`/`WaitTracker`
in `waiting.ts` — until `AgentRuntime.answerQuestions` records the answers or
a dismissal; `dismissQuestions` and `pendingQuestions` cover the rest, and
`ActivityChange.questions` counts waiting calls. Transcript tool calls gain
the `awaiting_answer` status and `questions`/`answers`. App side: every bot
gets the toolkit, `POST /bots/:id/questions/:taskId` answers or dismisses,
an owner message dismisses waiting questions so it is read right after, the
bot list carries a `questions` count for the sidebar badge, and the chat
renders the questions with the shadcn Questionnaire. Faux mode asks sample
questions on "/ask".
