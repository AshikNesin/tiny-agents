# Skills

A user keeps a library of skills on `/skills`: reusable markdown instructions a bot loads when a task needs them. They write one from scratch or import a pasted `SKILL.md`, edit its description and instructions with a live preview, attach it to bots (from the skill page or the bot's own dialog), search the list, and delete it after a warning that names how many bots use it.

## Sub-features

- `skills-list` lists skills with `manual`/`imported`, `used by N bot(s)` and last update; empty state `No skills yet`.
- `skills-search` filters by name or description (searchbox `Search skills`, shown once a skill exists); `No matching skills` when nothing matches.
- `skills-create` adds a skill from dialog `New skill` (Name, Description, Instructions). The name is validated inline (lowercase letters, digits, single hyphens) and `Create skill` stays disabled until it is valid.
- `skills-edit` edits Description and `Skill instructions (markdown)` on `/skills/:id`; `Preview` tab renders the markdown; `Save changes` (enabled only when dirty) shows `Skill saved`. The name is read-only.
- `skills-attach` ticks a bot (`Use <skill> with <bot>`) on the skill page; the bot's `Edit <bot>` dialog → tab `Skills` has the same link as switch `Assign <skill>`.
- `skills-import` pastes a `SKILL.md` (frontmatter `name` + `description`) in dialog `Import skill` → `Preview` → `Install`; a name that already exists cannot be installed.
- `skills-delete` deletes through dialog `Delete skill?`, which says `N bot uses "<name>"` when attached; the bot loses the link.

## How to get to it (user POV)

- Sidebar button `Account and navigation` → menuitem `Skills` (`/skills`); also the ⌘K palette.
- A skill: its row button in the list (`/skills/<id>`).
- From a bot: its sidebar row's `<bot> actions` → `Edit bot` → tab `Skills`.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. A bot to attach to (`setup:` via `POST /api/v1/bots`). No skill named `verify-skill-<stamp>` / `verify-import-<stamp>`.

- **Open.** Account menu → `Skills`. Heading `Skills`.
- **Create.** `New skill`; Name `Bad Name`, blur → the hyphen rule shows, `Create skill` disabled. Name `verify-skill-<stamp>`, Description, Instructions → `Create skill`. Toast `Skill created`, URL `/skills/<id>`, heading = name, `Name` disabled; row in `GET /api/v1/skills`.
- **Edit.** Fill `Description` and `Skill instructions (markdown)` (`# Edited heading <stamp>`), tab `Preview` shows that heading, `Save changes` → `Skill saved`. Reload: values return; `GET /api/v1/skills/<id>` agrees.
- **Attach (skill side).** Check `Use <skill> with <bot>`. `botIds` on the skill and `skillIds` on `GET /api/v1/bots/<id>` both contain the other.
- **Attach (bot side).** `/chats/<botId>` → `<bot> actions` → `Edit bot` → tab `Skills`: switch `Assign <skill>` is on. Turn it off, `Save changes` → link gone in both APIs; turn it on again, save → back.
- **List + search.** Row button starting with the name contains `used by 1 bot` and `manual`; searching nonsense shows `No matching skills`.
- **Import.** `Import` (exact) → `SKILL.md content` → `Preview` → name and rendered body heading → `Install` → toast `Skill installed`, opens the new skill. Importing the same name again: `Install` disabled.
- **Delete.** On the skill, `Delete` → dialog `Delete skill?` contains `1 bot uses` → `Delete` (exact). Toast `Skill deleted`, back on `/skills`, row gone, not in the API, bot's `skillIds` no longer has it.
- **Proof.** `ta-verify drive $S/journeys/skills.mjs` → `skills/created`, `edited-preview`, `attached`, `bot-dialog-skills`, `list`, `import-preview`, `deleted`.

## Gotchas

- `Import` collides with an imported skill's row button (`verify-import-…`); use `exact: true`.
- Search only appears once at least one skill exists.
- A bot _using_ a skill (loading it mid-task) needs a real model: the faux model only echoes, so the proof stops at the bot↔skill link stored on both sides.
- `GitHub URL` import fetches from github.com; it needs network access the verify run does not promise and is not driven.
- Leaving the editor with unsaved edits is guarded (`LeaveGuard`); save or revert before navigating.
