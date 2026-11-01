# Marketing site

A one-page marketing site for Tiny Agents: plain HTML and CSS, no build step.
The 45-second film is its hero.

```sh
npx serve site        # or any static file server; open the printed URL
```

Deploy the folder as-is to any static host (Cloudflare Pages, Netlify, GitHub
Pages). Nothing in it depends on the app.

| Path                         | What it is                                                |
| ---------------------------- | --------------------------------------------------------- |
| `index.html`                 | The page: dark-first with a light theme, works at 390px   |
| `media/tiny-agents-film.mp4` | Web encode of `docs/demo/tiny-agents-teaser.mp4` (4.6 MB) |
| `media/film-poster.jpg`      | Poster frame from the film (11 s, browser use)            |

To refresh the media after re-rendering the teaser:

```sh
ffmpeg -i docs/demo/tiny-agents-teaser.mp4 -c:v libx264 -preset slow -crf 24 -tune animation \
  -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart site/media/tiny-agents-film.mp4
ffmpeg -ss 11 -i docs/demo/tiny-agents-teaser.mp4 -frames:v 1 -q:v 3 site/media/film-poster.jpg
```

The repo is private, so the page has no "View on GitHub" button; "Watch the
film" is its call to action until there is somewhere public to send visitors.
