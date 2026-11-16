# Montage snapshots

Staged by `tools/stage-montage.mjs` (re-runnable; `--fresh` wipes and restarts)
in its own instance on :3160, state in `data/verify/montage/`. The account is
created through first-run setup with the name `Ashik`. The faux model is
scripted by `tools/montage-director.mjs`, and TinyFish web search/fetch are
answered offline by `tools/montage-faux.mjs` (sample results on
`hostels.example.com`, 1.3 s / 1.9 s delay each). Every page opened by the
script gets a silent Vite HMR socket (other scripts' file writes reload the dev
page otherwise), and every request to a host other than localhost and
api.dicebear.com is aborted (this keeps out the FeedbackBee embed and its
floating launcher).

Each state was saved in `desktop` and `mobile`. Every verify result was under
0.003, and every PNG was checked by eye.

## States

- `memory`: the Memory page with the four CAST memories: three under Travel Planner and one under Code Buddy. **Real flow:** each bot saved them with its own `remember` tool after a message from the owner.
- `connections`: the Connections page with GitHub, Linear and Google Calendar, all shown as "Connected" with no error badges. **Answered from Playwright:** `GET /connections` returns the `Connection` shape inside the server's real envelope.
- `models`: Settings → Models with Anthropic · Work (opened, showing Claude Opus 5.5 and Claude Sonnet 5.5), Claude plan, Ollama (local) and OpenAI, each shown as "Connected". **Answered from Playwright:** `GET /models/providers` returns the `accounts`, and the templates are the server's own. `GET /models/roles` is answered too. On desktop the settings pane is scrolled so all four accounts fit. On mobile the page stays at the top.
- `updates`: Settings → Updates showing v1.3.0 · 4727c90 running, c20fb91 available, three real repo commits under "What's new", and **Update & restart**. **Real server:** the script starts the server with `TINY_AGENTS_SUPERVISED=1` and an IPC channel. When the server sends `server-ready`, the script sends back one `update-status`, the same message `pnpm local` sends.
- `yolo`: the Researcher chat with the CAST exchange. The tool group is opened, showing two "Searched the web" rows and one "Read page" row, each marked "auto-approved (YOLO)". The YOLO banner sits above the composer. **Real flow:** YOLO was turned on through the bot menu and its confirm dialog. The calls ran under the real tool gate, with `web_search` and `web_fetch` set to Ask. The faux model row was renamed "Claude Sonnet 5.5" through `PATCH /models/:id`, which is why the composer picker shows that name. **Edit (mobile only):** inline `style="scrollbar-gutter:auto"` on `[data-slot="message-scroller-viewport"]`. On the phone the list's stable gutter is an overlay and takes no width. A desktop embed would draw it as a 10px gutter.
- `yolo-menu`: the same chat with the bot menu open and the YOLO mode row ticked. **Real flow:** the script clicked the bot name in the header. Focus was then moved to the menu element so no item is drawn in `:focus` colours. **Edit (mobile only):** the same gutter edit as `yolo`.
- `terminal`: the Terminal page with one tab after `pnpm test`, ending on `Tests  48 passed (48)` and the prompt `ashik@sandbox:~/code/shop$`. **Answered from Playwright:** `GET /terminal/sessions`, the ticket `POST`, and `routeWebSocket` on `/api/v1/terminal/ws/*`, which sends the pty bytes and answers ping with pong. WebGL2 is reported as unavailable, so xterm uses the DOM renderer it already falls back to, and the screen is real text in the markup.

## Close-up selectors (CSS, valid in the snapshot HTML)

| State | Element | Selector |
| --- | --- | --- |
| memory | "Prefers window seats" row | `section[aria-label="Travel Planner memories"] li:has(button[aria-label='Edit memory "Prefers window seats"'])` |
| connections | GitHub row | `a[href="/connections/conn_github"]` (also `conn_linear`, `conn_gcal`) |
| models | Anthropic · Work account card | `[data-slot="card"]:has(button[aria-label="Check Anthropic · Work again"])` |
| updates | Update & restart button | `button:has(> svg.lucide-download)` (Playwright: `getByRole("button", { name: "Update & restart" })`) |
| yolo | YOLO banner | `[data-testid="yolo-banner"]` |
| yolo | Tool group | `[data-testid="tool-group"]` |
| yolo-menu | YOLO mode row | `[data-testid="yolo-toggle"]` |
| terminal | Last lines: Test Files, Tests 48 passed, blank line, prompt | `[data-testid="terminal-view-ta-term-1"] .xterm-rows > div:nth-child(n+16):nth-child(-n+19)` |
| terminal | "Tests 48 passed (48)" line | `.xterm-rows > div:nth-child(17)` |

## Known limits

- On mobile, the app itself truncates the tool row titles, the bot names on the Memory page and the Terminal page title. The snapshots show the app as it rendered.
- The desktop sidebar also lists Chief of Staff, Travel Planner and Code Buddy. The last two show unread dots from saving their memories.
