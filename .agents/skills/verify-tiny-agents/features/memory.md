# Memory

Each bot keeps its own long-term memories about the owner. The Memory page lists them per bot, grouped by category, and lets the owner add, edit, search and delete them and switch learning off per bot. A deleted memory is never captured again, but the owner can add the same text back by hand.

## Sub-features

- `memory-empty` bots with no memories are listed together in region `Bots without memories` with `Add memory for <bot>` and the learning switch.
- `memory-add` dialog `Add memory` (`Memory` text, `Category` select: Preferences, Facts, Goals, Habits); toast `Memory added`; row says `Added manually`.
- `memory-groups` region `<bot> memories` with a count (`1 memory`) and a heading per category.
- `memory-edit` `Edit memory "<text>"` → dialog `Edit memory` → `Save`; toast `Memory saved`.
- `memory-search` searchbox `Search memories` across bots; no hit shows `No matching memories`.
- `memory-switch` switch `Turn off memory for <bot>` / `Turn on memory for <bot>`; off shows `Off. This bot no longer learns from chats or uses what it knows.`
- `memory-delete` `Delete memory "<text>"` → alert dialog `Delete this memory?` → `Delete`; toast `Memory deleted`.
- `memory-restore` adding a deleted text by hand brings it back as one active memory.

## How to get to it (user POV)

- Sidebar account button `Account and navigation` → menu item `Memory` (`/memory`).

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. A faux bot with no memories (API setup).

- **Open.** Account menu → `Memory`; heading `Memory`; the bot is in `Bots without memories`, switch checked.
- **Add.** `Add memory for <bot>` → `Add` is disabled until text is typed; fill `Prefers green tea <stamp>`, Category `Facts`, `Add` → section shows the text, `1 memory`, heading `Facts`, `Added manually`. `GET /bots/:id/memories?includeArchived=true` → `{ status: "active", category: "fact", source: "manual" }`.
- **Edit.** Change text and Category `Preferences` → `Memory saved`; reload keeps it; API category `preference`.
- **Search.** A matching query keeps the section; `nothing-<stamp>` → `No matching memories`; clear restores.
- **Switch.** Turn off → note shown, API `memoryEnabled: false`, still off after reload; turn back on.
- **Delete.** Confirm → toast, text gone, bot back under `Bots without memories`; the memories list (even with archived) no longer has it.
- **Restore.** Add the same text again → one active row.
- **Proof.** `ta-verify drive $S/journeys/memory.mjs` → `added`, `searched`, `off`, `deleted`, `restored`.

## Gotchas

- The list endpoint answers `{ memories: [...] }`; deleted tombstones are never listed, even with `includeArchived=true`.
- The account button's name is `Account and navigation`, not the user's name.
- Unreachable on the faux model: background capture (faux mode has no side-caller), chat-side `remember` / `forget` (the faux bot never calls them), injection into the prompt (echo replies cannot show it), supersession, expiry and archival (only capture or the budget produce them, so `Restore to active` and the `Archived` fold never appear).
