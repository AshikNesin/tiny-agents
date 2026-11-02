# Teaser (50 s)

[`docs/demo/tiny-agents-teaser.mp4`](../../../docs/demo/tiny-agents-teaser.mp4) is a
50-second, 1080p60 product film: one trip to Japan from Chennai, told through
the features that make it work. It complements the 1:39
[recorded tour](../README.md). The tour shows the real app, while the teaser
is a motion-graphics piece that sells the benefits.

**What it is:** the UI is redrawn in the app's own dark design language
(logo, warm greys, chat, approval card, Allow / Ask / Off permissions,
terminal, bot handoffs) as a single HTML page. It is monochrome on purpose:
colour appears only where it means something (LIVE, an approval, a pass). Every element is a pure function of time, so
`render(t)` draws any frame and the film is reproducible to the pixel. The
score is original, synthesised with numpy, and royalty-free.

## Storyboard

| Time | Beat              | On screen                                                      |
| ---- | ----------------- | -------------------------------------------------------------- |
| 0.0  | Hook              | "Say it once." / "Your agents take it from there."             |
| 2.5  | Chat              | "Plan 7 days in Japan this April. Flying from Chennai."        |
| 5.1  | Memory            | Recalled: window seat, ₹2.5L budget, quiet temples             |
| 8.5  | Browser use       | Live browser, Chennai → Tokyo flights, the bot picks the best  |
| 12.5 | Computer use      | Its own desktop, filling a day-by-day itinerary                |
| 16.5 | Approvals & Vault | Pay ₹1,36,840? Approve. Card filled from the Vault, never seen |
| 20.5 | Permissions       | Allow / Ask / Off per tool; shell switched off                 |
| 24.5 | Terminal          | `npm test` passes in a shell on the sandbox VM, then `git log` |
| 28.5 | MCP               | Calendar, email, docs, chat, files, any MCP server             |
| 32.5 | Routines · Alerts | 7 AM fare drop, visa reminder, an approval-needed push         |
| 36.5 | Multi-agent       | Chief of Staff hands off to Travel Planner, Writer, Researcher |
| 40.5 | Durable           | Server restarts mid-reply; it reconnects and keeps streaming   |
| 44.5 | Team              | Six bots: "A team that never clocks out."                      |
| 46.5 | Logo              | Tiny Agents, "Your team of always-on AI agents."               |

The score is 120 BPM with bars starting at 0.5 s, and every scene after the
chat is two bars long, so each cut lands on a downbeat. The opening bells
follow the words, a chime plays on the Approve click, and the music
tape-stops when the server restarts, then drops back in on reconnect.

## Rendering

Needs Node with Playwright (or the repo's `playwright-core`), ffmpeg, and
Python 3 with numpy.

```sh
./scripts/demo/teaser/build.sh                  # frames + score + master -> docs/demo/tiny-agents-teaser.mp4
SKIP_FRAMES=1 ./scripts/demo/teaser/build.sh    # re-score and re-mux only
STILLS=4.8,9.4,15.2 node scripts/demo/teaser/render.mjs   # review stills in tmp/demo/teaser-frames
```

`render.mjs` takes `WORKERS` (parallel pages, default 4), `FPS` (default 60),
`FROM` (seconds; re-render only from there on, e.g. after a copy change),
`FRAMES_DIR` and `CHROMIUM_PATH` (set it when the installed `playwright-core`
expects a browser build that isn't downloaded).

| File          | Role                                                           |
| ------------- | -------------------------------------------------------------- |
| `teaser.html` | The film: scenes, timeline and `render(t)`                     |
| `render.mjs`  | Captures each frame with Chromium                              |
| `music.py`    | Original score, timed to the cuts                              |
| `build.sh`    | Renders, masters the score to -16 LUFS (linear), muxes the MP4 |
