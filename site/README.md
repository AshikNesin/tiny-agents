# Marketing site

A one-page marketing site for Tiny Agents: plain HTML and CSS, deployed as-is.
Light only, graphite on white, with the 76-second demo film under the hero.

```sh
npx serve site        # or any static file server; open the printed URL
```

Deploy the folder as-is to any static host (Cloudflare Pages, Netlify, GitHub
Pages). Nothing in it depends on the app.

| Path                         | What it is                                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| `index.html`                 | The page; works down to 360px wide                                |
| `media/tiny-agents-demo.mp4` | Web encode of `docs/demo/tiny-agents-launch.mp4` (7.7 MB)         |
| `media/demo-poster.jpg`      | Poster frame from the film (2.4 s, the bot list)                  |
| `media/og.png`               | Link preview image, 1200x630 (`scripts/demo/launch/tools/og.mjs`) |
| `media/*.webp`               | App screenshots as webp (`docs/screenshots/`, plus PR 471)        |
| `assets/demos.{js,css}`      | Built "How it works" demos (from `demos/`, committed)             |
| `demos/`                     | Source of those demos: React + the Stageshow kit                  |

The media is refreshed by `scripts/demo/launch/render.sh` whenever it renders the
film into `docs/demo/` (see [the film's README](../scripts/demo/launch/README.md)).

The copy follows the repo's README: the tagline, the "Why", the screenshots
and the quick start. When the README changes, update the page to match. The
main call to action is the GitHub repo; the Android APK link is in "Run it"
and the FAQ.

The video's start button is a `<button>` laid over the poster. It hides by a
`.playing` class on the player, not the `hidden` attribute: the button's own
`display` rule would override `hidden`, leaving it over the native controls
(including fullscreen) while the video plays.

## How it works demos

The three pictures in "How it works" are animated product demos built with
[Stageshow](https://benji.org/stageshow) (the skill lives in
`.agents/skills/stageshow`; its React kit is copied to `demos/kit/`). Each
step is its own stage, 360 x 252, and they play once, in reading order, as the
section scrolls in: Payments is set to Ask, the request is sent and answered,
then the payment is approved. A Replay button plays the story again. With
reduced motion each shows its finished frame; without JavaScript the static
pictures in the markup stay.

| File                           | What it is                                                         |
| ------------------------------ | ------------------------------------------------------------------ |
| `demos/scenes/StepSetup.tsx`   | Step 1: permissions, Payments from Allow to Ask                    |
| `demos/scenes/StepAsk.tsx`     | Step 2: the request, memory chips, a tool row, the answer          |
| `demos/scenes/StepApprove.tsx` | Step 3: the approval card, Approve, then Paid                      |
| `demos/chain.ts`               | Makes each demo wait for the one before it                         |
| `demos/look.css`               | The Tiny Agents look as Stageshow tokens                           |
| `demos/parts.ts`               | The kit parts used, imported file by file (keeps the bundle small) |

The site itself has no build step, so after editing anything in `demos/`
rebuild the bundle and commit `assets/`:

```sh
pnpm site:build
```

To film a demo the way the skill expects (contact sheets, the rehearsal gate),
serve `site/` and point the skill's filmer at the page; see
`.agents/skills/stageshow/references/rehearse.md`.

The page also reveals sections as they scroll in, marks the section in view
in the nav, lifts feature cards on hover and animates the FAQ answers. All of
it sits in the inline script and styles and stands down under reduced motion.
