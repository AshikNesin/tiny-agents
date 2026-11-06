# Tasks

A user keeps a personal task list on `/tasks`: quick-add a task for today, open it to edit notes, status, priority and due date, tick it off (it moves to Completed with an Undo toast), reopen it, and delete it after confirming.

## Sub-features

- `tasks-tabs` filters by `Today`, `Upcoming`, `Completed` (tablist `Task filters`).
- `tasks-quick-add` adds a task from the `New task title` box (natural language like `tomorrow 5pm !high` is parsed).
- `tasks-edit` edits Title, Notes, Status, Priority and Due in the `Edit task` dialog.
- `tasks-complete` completes a task: it leaves the open list, toast `Task completed` with `Undo`.
- `tasks-reopen` marks a completed task not done from the `Completed` tab.
- `tasks-delete` deletes from the editor after the `Delete task?` confirmation.

## How to get to it (user POV)

- Sidebar navigation `Primary` → `Tasks` (`/tasks`).

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. No task titled `Verify task <stamp>`.

- **Open.** Go to `/tasks`. Tab `Today` has `aria-selected=true`.
- **Quick add.** Fill textbox `New task title` with `Verify task <stamp>`, press button `Add task`. A row button whose name starts with the title appears; `GET /api/v1/tasks` has it with `status: "todo"`.
- **Edit.** Click the row. Dialog `Edit task`: fill `Notes`, press `Save`. Toast `Task saved`; the row read back has the new `description`.
- **Complete.** Button `Complete "<title>"`. Toast `Task completed`; that button is gone from Today; tab `Completed` shows `Mark "<title>" as not done`; API `status: "done"`.
- **Reopen.** Press `Mark "<title>" as not done`. API status returns to `todo`.
- **Delete.** Tab `Today`, open the row, `Delete` in the dialog, then `Delete` (exact) in dialog `Delete task?`. Toast `Task deleted`; row gone; not in the API.
- **Proof.** `ta-verify drive $S/journeys/tasks.mjs` → `tasks/added`, `tasks/completed`, `tasks/deleted`.

## Gotchas

- The `Task completed` toast repeats the task title, so `getByText(title)` matches twice. Locate the row as a button whose name starts with the title.
- Quick add parses dates and `!priority` out of the text; a title containing `tomorrow` lands in Upcoming, not Today.
- Completing removes the row from Today immediately (optimistic); assert on the Completed tab, not on a struck-through row.
