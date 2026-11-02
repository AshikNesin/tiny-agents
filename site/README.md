# Marketing site

A one-page marketing site for Tiny Agents: plain HTML and CSS, no build step.
Light only, graphite on white, with the 50-second demo video under the hero.

```sh
npx serve site        # or any static file server; open the printed URL
```

Deploy the folder as-is to any static host (Cloudflare Pages, Netlify, GitHub
Pages). Nothing in it depends on the app.

| Path                         | What it is                                                |
| ---------------------------- | --------------------------------------------------------- |
| `index.html`                 | The page; works down to 360px wide                        |
| `media/tiny-agents-demo.mp4` | Web encode of `docs/demo/tiny-agents-teaser.mp4` (4.5 MB) |
| `media/demo-poster.jpg`      | Poster frame from the video (11 s, browser use)           |

To refresh the media after re-rendering the teaser:

```sh
ffmpeg -i docs/demo/tiny-agents-teaser.mp4 -c:v libx264 -preset slow -crf 24 -tune animation \
  -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart site/media/tiny-agents-demo.mp4
ffmpeg -ss 11 -i docs/demo/tiny-agents-teaser.mp4 -frames:v 1 -q:v 3 site/media/demo-poster.jpg
```

The code is not public yet, so the calls to action are "Watch the demo" and
"Follow @AshikNesin" on X for the open-source launch. Swap in a GitHub link
once the repo is public.

The video's start button is a `<button>` laid over the poster. It hides by a
`.playing` class on the player, not the `hidden` attribute: the button's own
`display` rule would override `hidden`, leaving it over the native controls
(including fullscreen) while the video plays.
