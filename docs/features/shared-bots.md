# Shared bots

Chat with a friend and a bot together, like a group chat (issue #145).

## Using it

1. **Settings → People → Add a guest**: their name, email and a password you
   pass on. They can add a passkey later from their own Settings.
2. **Bot settings → Sharing**: switch the guest on. They now see that bot in
   their sidebar.
3. Both of you open the bot's chat. It is **one conversation**: everybody sees
   every message and reply live, and each message shows who sent it.

Sharing a bot shares its current chat history too. For a clean room, make a
new bot (or press "New chat") before sharing it.

## What a guest can do

- Chat with the bots shared with them, answer approval cards and Questions,
  watch the bot's browser and computer, attach files. Watching only: a
  guest can't take control, start, resize or reset them, and the VNC bridge
  drops a guest viewer's keys, clicks and clipboard, because a shared
  browser holds the owner's logins.
- Use the **Code** page: read, start and work in every thread. The harness
  host stays the owner's: a guest can't browse or choose directories, find
  files, upload, make worktrees, move a thread, open file assets or pick the
  no-prompts (bypass) mode. The page hides those controls for a guest and the
  routes refuse them.
- Change their theme, password and passkeys.

Everything else is the owner's: other bots, bot settings, New chat and Chat
history, Tasks, Routines, Skills, Memory, Connections, Vault, Terminal,
Computer and Settings. The server enforces it: `guest.guard.ts` lets a guest
call only an explicit list of routes, and only for bots shared with them;
anything else answers 403, so a route added later is closed to guests until
it is listed.

## How the bot behaves in a shared chat

- It reads each message as `Name: message` (the transcript shows only the
  words; the sender is stored on the entry as `author`).
- Its system prompt gains a line naming everyone in the chat and asking it to
  answer only when someone talks to it, asks for something or @mentions it,
  and otherwise reply exactly `[skip]`. Those replies are hidden in the chat
  and don't touch the sidebar preview or unread badge.
- It works with the tools you allowed, for either of you, except that it
  cannot create bots or change its own instructions there.
- **Vault:** every use asks, even for items set to "allowed", and only the
  owner can approve it.
- **Memory is off** while the bot is shared: nothing from the chat is captured,
  and memories are not injected.
- Pushover pushes stay the owner's, and a guest having the chat open does not
  hold them back. A guest has their own unread marker per shared bot.

## Data

- `guests` (`user_id`): a row makes an account a guest. No row = owner, so
  nothing changes until a guest is added.
- `bot_guests` (`bot_id`, `user_id`, `last_read_at`): who a bot is shared with,
  and each guest's read marker.

Code: `apps/web/src/server/api/people/` (`access.ts` for the viewer and
every check past the guard, the guard, live access, service, routes),
`bots.conversation.ts` (`sharedChatGuidance`), `bots.owner.ts` (`shared`),
`apps/web/src/client/components/PeopleSettings.tsx`, the Sharing tab
(`components/bot-dialog/SharingSection.tsx`),
`apps/web/src/client/queries/viewer.ts`.
