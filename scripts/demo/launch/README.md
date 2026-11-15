# Launch film

The product demo film, as a [HyperFrames](https://github.com/heygen-com/hyperframes)
project: HTML compositions rendered frame by frame to video. Three cuts come out
of the same scenes:

| Cut      | File                                        | Size      | Length |
| -------- | ------------------------------------------- | --------- | ------ |
| Film     | `docs/demo/tiny-agents-launch.mp4`          | 1920x1080 | 76 s   |
| Vertical | `docs/demo/tiny-agents-launch-vertical.mp4` | 1080x1920 | 57 s   |
| Teaser   | `docs/demo/tiny-agents-launch-teaser.mp4`   | 1920x1080 | 15 s   |

`STORYBOARD.md` is the story, `SPEC.md` the numbers the scenes are built to,
`CAST.md` the sample data, `REVIEW.md` what was checked and what was not.

## What is on screen

Everything inside the film's "screen" is the app's own markup and stylesheet,
not a redraw. `tools/stage-*.mjs` drive a throwaway tiny-agents instance (the
fake model, scripted to say the lines in `CAST.md`) into each state the story
needs, and `tools/snaplib.mjs` saves that state's markup to `snap/`. A scene
includes a state by name and animates it. `snap/NOTES-*.md` say, state by
state, what was a real flow in the app and what had to be answered for it
(no sandbox VM, signed-in Claude account or MCP server exists where this was
made). The phone screens are real renders of the Android app's Compose UI
(`android/NOTES.md`).

## Render

```sh
cd scripts/demo/launch
./render.sh            # all three cuts into docs/demo/
./render.sh teaser     # one cut: index, vertical or teaser
QUALITY=draft ./render.sh index
```

Needs Node 22+, FFmpeg, Python 3 with numpy, and Playwright with Chromium (for
the cue sheets). `render.sh` builds the scenes, reads the sound cues out of
them, generates and masters the score and effects, and renders with
`hyperframes@0.9.53`.

To look at a scene while working on it:

```sh
SCENE=s02-code node tools/build.mjs
npx hyperframes@0.9.53 snapshot --at 1,4,9 -o .hyperframes/shots
npx hyperframes@0.9.53 preview
```

`index.html`, `vertical.html`, `teaser.html` and `compositions/` are build
output: edit `src/`, then run `node tools/build.mjs`.

## Files

| Path                      | Role                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| `src/scenes/*.html`       | The 16:9 scenes: a style block, markup that names app states, and a timeline  |
| `src/scenes/v/*.html`     | The vertical scenes, on the app's phone layout                                |
| `src/cuts.mjs`            | Which scenes each cut plays, for how long, and which stretch of each          |
| `src/fixes.mjs`           | Edits a scene may ask for on a state (swap in the sidebar, mark a row read)   |
| `lib/film.js`, `film.css` | Camera, pointer, captions, typing, scrolling; the screen and caption styles   |
| `snap/`                   | The app states, as saved markup, with notes on how each was staged            |
| `assets/`                 | The app's stylesheet and fonts as saved from the running app, and bot avatars |
| `android/`                | The phone stills                                                              |
| `tools/build.mjs`         | Sources to HyperFrames compositions                                           |
| `tools/snaplib.mjs`       | Saves a running app's state and stylesheet; checks it embeds pixel for pixel  |
| `tools/stage-*.mjs`       | Stage the states of one area each (inbox, travel, code, montage)              |
| `tools/cues.mjs`          | Reads each cut's sound cues from its scenes                                   |
| `tools/music.py`          | The score and effects, synthesised with numpy from a cue sheet                |
| `render.sh`               | Everything, in order                                                          |

## Changing things

- **A caption or a timing:** the scene's source in `src/scenes/`. Times are
  seconds from the scene's start.
- **The sample data:** `CAST.md`, then re-run the area's `tools/stage-*.mjs`
  (each starts its own instance; see `tools/README.md`).
- **The app changed:** re-run the staging scripts. Scenes find elements by the
  app's roles, labels and test ids, so most survive a restyle; a renamed test id
  shows up as a scene that fails to build its timeline.
- **The music:** replace `assets/audio/music.<cut>.wav` after `render.sh` has
  made it, or change `tools/music.py`. The effects are a separate stem.
