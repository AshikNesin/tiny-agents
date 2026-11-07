# Bot builder

A bot can create a new bot when the owner asks for one ("make a bot called
Engineer - Limitless that works on ~/Code/GoLimitless-Visuals and uses
Shelley for code changes"), through `create_bot` (issue #149). The owner no
longer has to leave the chat for the New bot dialog.

## The tool

`create_bot` (capability `bot-builder`, in every bot's toolkit) takes:

- `name`: unique among bots, compared case-insensitively (the same rule as
  the New bot dialog);
- `description` (optional): one line;
- `instructions`: the new bot's complete system prompt;
- `model` (optional): a model id; the creating bot's model when omitted. An
  unknown id is refused with the list of available ones.

The new bot is made by the same `createBot` as the dialog, so it gets every
built-in toolkit, its own chat and default tool permissions. It shows up in
the sidebar when the reply ends, and the creating bot can `message_bot` it
straight away.

## Guards

1. **The owner approves every new bot.** The tool is `askOnly` (like
   `update_instructions`): it waits in chat even when its permission says
   `allow`. The approval card reads "<bot> wants to create a new bot —
   “<name>”" and lists the description, the model ("default model" when
   the bot names none) and the full instructions; instructions longer than
   120 characters fold behind Read more. In YOLO mode
   ([`yolo-mode.md`](./yolo-mode.md)) the chat approves Ask (always) tools
   too, so `create_bot` runs without a card there.
2. **Only the owner's own turns.** The store adapter
   (`apps/web/src/server/api/bots/bot-builder.store.ts`) refuses a routine
   run or a turn started by another bot's message (`isUnattended`), so a peer
   can never spawn bots.
3. **Not from a shared chat.** Managing bots is the owner's, and guests can
   answer approval cards in a shared bot's chat, so a shared bot refuses.
4. **The dialog's validation.** The adapter parses the input with
   `createBotSchema`, the New bot dialog's own schema, so a blank name or an
   over-long description is refused with the dialog's message.

An interrupted `create_bot` is not re-run after a restart (`replay:
"unsafe"`): the model sees the interruption instead of a duplicate bot.

## Tests

- `tests/server/app/agent/bot-builder.test.ts`: the capability; `askOnly`
  holds even at `allow`, a denial creates nothing, refusals reach the model.
- `tests/server/api/bots/bot-builder.store.test.ts`: the adapter; creates on
  the owner's turn (on the creator's model by default), refuses taken names,
  unknown models, unattended turns, shared chats and unknown conversations.
