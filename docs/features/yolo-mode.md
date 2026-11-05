# YOLO mode

A bot's **Ask** tools wait for your approval card. With **YOLO mode** on in a
chat, they run straight away instead, except anything that uses a vault item
(issue #151).

Turn it on with the lightning button in the chat header. It asks you to
confirm, then stays on for **that chat only** until you turn it off or start a
**New chat** (continuing a past chat brings back the state it had). While it
is on, the button is highlighted and a banner above the composer says so.

## What it covers

- Every tool call that would show an approval card, including **Ask (always)**
  tools (`askOnly`: closing a window, reading the clipboard, saving a skill,
  updating the bot's instructions).
- Cards already waiting when you turn it on: they are approved too.
- Calls that ran under it show **auto-approved (YOLO)** on their row.

## What still asks

- **Vault uses.** A call that would put a login, card, code or API key
  somewhere (`browser_fill_secret`, `computer_fill_secret`, `browser_enter_code`
  with a handle, `http_request` with `auth`, `run_command` with `secrets`)
  always shows its vault card. The same tools without a vault item run under
  YOLO. The broker re-checks the owner's approval before it releases a value,
  so YOLO cannot release one even by mistake.
- **Turns you did not start.** A turn started by another bot (a delivery, a
  relayed reply, a mention) or, in a shared chat, by a guest still shows cards.
  YOLO trusts your instructions, not text another agent or person put in the
  chat.
- **Other owner waits** are not approvals and are untouched: Questions,
  credential requests, computer takeovers.
- **Off** tools stay hidden from the model.
- **Routines** (`unattended` conversations) keep refusing calls that would ask.

## How it works

- State: the conversation document `tiny.yolo` (`YoloDoc` in
  `packages/agent/src/policy.ts`): `{ on, since, by }`, where `by` is your user
  id. It is separate from `tiny.permissions`, which is recompiled from the bot
  on every send. A fork starts with it off.
- The Tool gate (`packages/agent/src/gate.ts`, [ADR 0013](../adr/0013-tool-gate-and-engine-seam.md)),
  the same on pi and on the Claude plan: after the unattended refusal and
  before auto-review, a call that would ask and carries no vault plan
  (`plan.details.vault`) checks YOLO once (`gate:yolo` memo, so a replay or a
  toggle mid-call never flips it). The turn must be yours (`ownerTurn` over the
  engine's user messages: the newest is no peer delivery and, in a shared
  chat, its author is `by`). The call then runs with `approval: "yolo"` and
  never sets `gate:approved`.
- `AgentRuntime.setYolo(ref, on, by)` writes the document and, when switching
  on, has the gate approve the waiting non-vault cards in your turn
  (`ToolGate.approveWaiting`: `recordYoloDecision` for a pi call, the held
  answer for a Claude plan call). `AgentRuntime.yolo(ref)` reads it.
- API: `PUT /api/v1/bots/:id/yolo` with `{ "on": boolean }` answers
  `{ on, approved }`. Owner only (not in `guest.guard.ts`). The bot's chat
  stream sends `{ "type": "yolo", "on": … }` when it opens and on every switch.
