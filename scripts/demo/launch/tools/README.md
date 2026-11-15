# Staging tools

The film embeds the app's own markup and styles. These scripts drive a running
tiny-agents instance into each state the storyboard needs and save it with
`snaplib.mjs` (read its header).

Each `stage-<area>.mjs` is re-runnable: it stages its states, calls `dumpCss`
on every distinct page and `snap` for each state in both modes (`desktop`
1280x720, `mobile` 390x844), then checks each with `verify`.

Sample data comes from `../CAST.md`, word for word.

## Rules for a staging script

1. **The app renders everything.** A state is real when the app's own client
   rendered it. Ways to get there, best first:
   - the real flow in a throwaway instance with the fake model (see
     `.agents/skills/verify-tiny-agents/SKILL.md` for how an instance is
     launched; `scripts/demo/faux-director.mjs`, `register.mjs`, `hooks.mjs`
     and `seed.mjs` show how the earlier demo scripted the fake model's replies
     and tool calls and seeded history, though they may be stale);
   - seeding the instance's own databases;
   - answering the client's `/api/v1` requests and streams from Playwright
     (`page.route`, `page.routeWebSocket`) with data in the server's real shapes
     (`apps/web/src/shared/api/`), when the server can't produce the state here
     (no sandbox VM, no signed-in Claude account, no Shelley).
   - Last resort: changing text or attributes of elements the app rendered,
     in `page.evaluate` before the snapshot. Never add markup the app did not
     render. List every such edit in the notes.
2. **Never change product code** (`apps/`, `packages/`, `mobile/`). Staging
   lives in `scripts/demo/launch/tools/` and in a data directory of its own
   under `data/verify/<area>/`.
3. **Your own instance, your own port.** Start it yourself on the port you were
   given (port + 1 must be free too) and leave it running when you finish. Do
   not run `ta-verify down` or stop servers you did not start. Point snaplib at
   it with `TA_URL=http://localhost:<port>`.
4. **Light theme, sample data.** `snaplib.open()` sets the light theme. All
   text comes from `../CAST.md`. No real credentials, and no network beyond
   localhost and the avatar host snaplib already uses.
5. **Check every snapshot.** `verify(mode, name)` must be under 0.003, and look
   at the PNG: no error toasts, no loading spinners, no dev overlays, no
   "Echo:" replies, nothing cut off that the state is about.
6. **Do not edit `snaplib.mjs`**, and do not commit, push or `git add`.
7. **Write `snap/NOTES-<area>.md`:** one line per state saying what it shows
   and how it was staged (real flow, seeded, answered from Playwright, or
   edited, with the edit), then the selectors that find the elements the
   state is about (prefer `aria-label`, roles and `data-testid`).
