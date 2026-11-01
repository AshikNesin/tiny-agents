# Demo video

[`docs/demo/tiny-agents-demo.mp4`](../../docs/demo/tiny-agents-demo.mp4) is a
1:39, 1080p30 tour of the app, recorded from the real UI by the scripts in this
folder. Re-running them reproduces the video.

**What's real:** the app, the browser (Google Chrome on the sandbox VM showing
live Google Flights, Chennai → Bangalore), the fare the bot quotes (read off
that page), the terminal and its `npm test` run, and every tool call.
**What's scripted:** the chat replies. `TINY_AGENTS_FAUX=1` runs the
faux model, and [`faux-director.mjs`](./faux-director.mjs) decides what it says
per prompt. Web search results come from [`web-stub.mjs`](./web-stub.mjs) so no
gateway credentials are needed.

For the 45-second teaser (a motion-graphics cut that sells the benefits),
see [`teaser/`](./teaser/README.md).

## Re-recording

Needs a Debian/Ubuntu amd64 machine with root (it doubles as the sandbox VM),
Node 24, pnpm, ffmpeg, and Python 3 with numpy.

```sh
pnpm install
sudo ./scripts/demo/setup-vm.sh   # exedev user, sshd on 127.0.0.1:2222, Chrome, TigerVNC, tmux
sudo ./scripts/demo/reset.sh      # fresh demo DBs, server on :3000, seeded bots and history
sudo node scripts/demo/record.mjs # frames + timestamps into tmp/demo/frames
./scripts/demo/finish.sh          # encode, score, master -> docs/demo/tiny-agents-demo.mp4
```

Run `reset.sh` before every take. `record.mjs` takes `SCENES=browse,terminal`
to record only some scenes, `FRAMES_DIR` to write elsewhere, and
`CHROMIUM_PATH` to use a specific Chromium build. `finish.sh` takes an optional
frames folder and output path.

## Files

| File                    | Role                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `setup-vm.sh`           | Turns this machine into the sandbox VM; host key is generated into `tmp/demo/`             |
| `vm/sshd_config`        | Localhost-only, keyless sshd for the `exedev` user                                         |
| `start.sh` / `reset.sh` | Demo server with the faux model and demo env; `reset.sh` also clears the VM and seeds      |
| `register.mjs`          | `--import` preload: swaps in the director and answers web search offline                   |
| `hooks.mjs`             | Module resolve hook that points pi-ai's faux provider at the director                      |
| `faux-director.mjs`     | Scripted replies and tool calls, matched by prompt                                         |
| `web-stub.mjs`          | Canned web search results                                                                  |
| `seed.mjs`              | Bots, permissions, chat history, routines, memories, and skills for the demo account       |
| `stage.html`            | The 1920x1080 stage: window chrome, captions, cursor, zoom, title cards                    |
| `record.mjs`            | Storyboard: drives the app with Playwright and captures a CDP screencast                   |
| `encode.py`             | Frames + timestamps (with speed-ups) → H.264                                               |
| `music.py`              | Original background track, synthesized with numpy to the cut's exact length (royalty-free) |
| `finish.sh`             | Encode, render the music, EQ and loudness-normalize to -16 LUFS, mux the final MP4         |
