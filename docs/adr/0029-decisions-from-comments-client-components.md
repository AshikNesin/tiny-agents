# 0029 — Decisions recorded from code comments: client components

- Status: accepted
- Date: 2026-11-20

## Context

These decisions came out of the comment sweep of `apps/web/src/client/components/`
under [ADR 0028](./0028-code-carries-no-comments.md). Each was a comment next to
the code it governs; none could be recovered from the code or its tests alone.
The vendored Fluid Functionalism copy in `apps/web/src/client/components/fluid/`
was not swept.

## Transcript rows use content-visibility

A message row in the transcript scroller has `content-visibility: auto`. That
makes the row the containing block for anything `position: fixed` inside it,
and it breaks percentage `max-width` on its descendants. So the enlarged image
overlay in `Attachments.tsx` (`MessageAttachments`) is rendered through a
portal, never inline, or it is clipped to the row (#165). And the user pill in
`chat-message/UserMessage.tsx` is capped in width by its flex parents, not by a
wrapper with a percentage width.

## Peer cards come only from trusted metadata

`ChatMessageView.tsx` draws a bot-to-bot peer card only from `message.peer`,
the attribution the delivery pipeline sets on the entry. A user text that
merely looks like a peer envelope renders as a plain bubble. Parsing the text
for an envelope would let anyone forge a card from another bot.

## Composer focus and keys follow the pointer

`ChatComposer.tsx` treats a coarse pointer (touch) differently from a physical
keyboard:

- It autofocuses the textarea when a chat opens only on a fine pointer; on
  touch that would pop the on-screen keyboard over the chat.
- Enter sends only on a fine pointer, and never while an IME composition is
  open (CJK input commits a candidate with Enter). On touch Enter inserts a
  newline and the round button is the only way to send. While a reply runs,
  Enter steers and Alt+Enter queues a follow-up.
- The round buttons cancel `mousedown` so pressing them never takes focus from
  the textarea: the caret stays put on desktop, and the on-screen keyboard does
  not collapse and reopen on every send.
- The caret after an inserted mention is placed in a layout effect, in the same
  commit as the new text. A frame later it races the owner's next keystrokes.
- When the "+" menu closes after "Mention a bot", its default return of focus
  to "+" is cancelled; otherwise the textarea's blur closes the mention list
  (#167).
- Busy does not block sending (the server queues a steer). There is one round
  button: Send while something is sendable, Stop otherwise, so two round
  buttons never compete and Stop is never hidden behind a disabled Send.

## A chat opens on read anchors, then follows the reply

`ChatSessionTranscript.tsx` (`useOpeningAnchors`) passes read messages as the
scroller's anchors only while the chat opens, for two animation frames after
the first render with messages. The scroller re-targets anchors whenever the
transcript's children are swapped (an Echo replaced by its confirmed row),
which pulled the view back to an old read message while a reply streamed.
After opening, auto-scroll alone keeps the newest message pinned. For the same
initial positioning, the first-load spinner sits outside the scroller content,
which must hold only transcript rows. `Transcript.tsx` loads an older page only
once the owner has scrolled to the top themselves, so the scroller's own jump
to the newest message on open never fetches a page.

## Live views: who resizes the remote side

`browser/VncView.tsx` and `live/LivePanel.tsx`:

- The browser viewer fits the remote display and Chrome's window to its box.
  The computer's desktop keeps a fixed size, because the bot's click
  coordinates depend on it, and its viewer only scales (see
  [ADR 0006](./0006-computer-is-a-desktop-on-the-sandbox-vm.md)).
- A guest's viewer and the picture in picture never resize the remote window
  (S2): a guest watches at the owner's size, and the small floating view would
  otherwise shrink the bot's pages under it. `surface.fitsWindow` says which
  surfaces need that.
- noVNC's `resizeSession` is set in a layout effect so noVNC's own resize
  observer sees the new value when the box changes in the same commit (docking,
  or shrinking to the picture in picture).
- On a Mac, Cmd chords are captured before noVNC sees them and sent as Ctrl
  chords: the remote side is Linux Chrome, and noVNC would send Meta as Super.
- Neither live view opens on its own (`chat-pane/live-views.tsx`). A bot using
  its browser or computer only lights the header toggle; the owner opens the
  view.

## OAuth connections open their popup inside the click

`connections/AddConnectionDialog.tsx` starts the save synchronously in the
click handler. An OAuth connection opens its sign-in popup before the first
`await`; a popup opened after an `await` is no longer in the user gesture and
the browser blocks it.

## Credential requests never save one-time codes

`vault/CredentialRequestForm.tsx` offers "save" only for a password, a card
number or a sign-in identifier (username, email, mobile number, by its
autocomplete token). OTPs and security codes are never saved to the vault.

## The bot dialog resets only when it opens

`BotDialog.tsx` rebuilds its draft on the transition from closed to open, and
never on later prop changes. A model catalog that arrives while the dialog is
open must not wipe the owner's edits; a new bot opened before the catalog loaded
takes the default model once it is known, and only if no model was picked.
