---
"@tiny-agents/agent": minor
---

Three deep modules replace logic that was spread across the runtime, the
gate, the toolkits and the transcript:

- **Owner wait.** Each wait kind (approval, Question, credential request)
  owns its document, the card details the chat renders (`approvalOf`,
  `questionsOf`, `credentialsOf` parse what the same file produces), the
  host-side answer (`recordDecision`, `recordAnswers`, `readPendingRequest` /
  `settleRequest`) and the not-pending error. One `refuseUnattended` serves
  every kind, so a refused `ask_owner` now carries `approval: "refused"` and
  a Routine run sees it as blocked. `decideApproval` refuses a call that
  never asked: the wait marks its document `asked`, and a decision for a
  running call without that mark throws `ApprovalNotPendingError` instead
  of approving it. `GateHooks.replaySafe(args)` lets a tool declare a call
  replay-safe for some arguments (one that only waits on the owner), so a
  restart re-attaches instead of reporting "interrupted".
- **Chat projection** (`ChatProjection`). The fold from pi-durable events to
  chat states, the window and the diff moved out of `watchChat` into a pure
  module tests drive with recorded events. Unanswered reasons are recovered
  from the conversation's submission records on every snapshot, so a
  reconnect and a one-shot `readChat` show them. `readChat` of an idle
  conversation reads the store directly without opening a watch.
- **Policy** (`compilePolicy`, `applyPermissions`, `resolveModelId`,
  `PermissionsDoc`). A pure function from catalog, selection and installed
  extensions to the agent change and the permissions document. `familyOf`
  reads the `custom:` tag the runtime actually emits.
