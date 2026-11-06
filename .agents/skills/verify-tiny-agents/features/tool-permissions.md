# Tool permissions

Every bot has every tool, and the owner sets each one to Allow (runs unattended), Ask (waits for an approval card in the chat) or Off (hidden from the bot) in the bot's settings. An Ask call shows a card `<bot> wants to <action>` with Deny, Approve and Always allow; Always allow approves and switches that tool to Allow for the bot.

## Sub-features

- `perm-toggle` per-tool segmented control (radiogroup `<Action> permission`, radios `Allow` / `Ask` / `Off`; Ask-only tools offer `Ask (always)` / `Off`). Read-only tools default to Allow, writable ones to Ask; the selected radio is visibly distinct.
- `perm-group` per-toolkit control (radiogroup `All <Toolkit> tools`) sets every tool in the group; shows `Mixed` when they differ.
- `perm-presets` buttons `Allow read-only` and `Ask for everything`.
- `perm-search` searchbox `Search tools` (matches name, label, description, toolkit); no match says `No tools match “<q>”.`
- `perm-card` the approval card, `Nothing runs until you answer.`
- `perm-deny` Deny: the row reads `<Label> … denied by you`, the bot is told the owner denied the call.
- `perm-approve` Approve: the call runs once; the permission stays Ask.
- `perm-always` Always allow: the call runs and the tool becomes Allow (no card next time).
- `perm-off` Off: no card, the bot gets `Tool <name> is not available`.

## How to get to it (user POV)

- A bot's chat → header button `Edit <bot>` (or the sidebar row's `<bot> actions` → `Edit bot`) → tab `Tools` → `Save changes`.
- The card appears in the chat whenever the bot calls an Ask tool.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. A faux bot (setup through the API is fine: the bot is not the feature).
- The faux trigger `/browse 1` makes the bot call `browser_snapshot` (`Read the page`, read-only, default Allow) once.

- **Tools tab.** Open `Edit <bot>` → `Tools`. `Add a task permission` has `Ask` on; click `Off` in `All Tasks tools` and both `Add a task` and `List tasks` go Off; `Ask for everything` / `Allow read-only` flip them back. Search `zz-nothing-<stamp>` → the no-match line.
- **Set Ask.** Search `browser snapshot`; radiogroup `Read the page permission` shows `Allow` on; click `Ask`, `Save changes`. `GET /bots/:id` → `toolPermissions.browser_snapshot === "ask"`.
- **Card + Deny.** Send `/browse 1 …` → text `<bot> wants to read the page`. `Deny` → button `Read the page denied by you …`, reply `Echo: The owner denied this browser_snapshot call…`.
- **Approve.** Send again, `Approve` → the tool runs (in a verify run it answers `No browser is installed on the server…`); permission still `ask`.
- **Always allow.** Send again, `Always allow` → permission becomes `allow`; the next `/browse 1` shows no card; reopened Tools tab shows `Allow` on.
- **Off.** Set `Off`, save → `/browse 1` gets `Echo: [error] Tool browser_snapshot is not available`, no card.
- **Proof.** `ta-verify drive $S/journeys/tool-permissions.mjs` → `set-ask`, `approval-card`, `denied`, `always-allowed`, `off`.

## Gotchas

- Radiogroup names use the tool's ask label, capitalised (`List tasks permission`, not `Listed tasks`), and only exist while the toolkit group is expanded: groups over 8 tools start collapsed, so search for the tool first.
- Permission changes apply only after `Save changes`; Cancel drops them.
- Approve and Deny buttons have no per-card scope in ARIA; keep one card waiting at a time and use `exact: true`.
- With no browser binary in a verify run, an approved `browser_snapshot` ends in an error row; that still proves the call ran.
