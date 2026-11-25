# Play Store assets

Graphics for the Google Play listing of the Tiny Agents Android app
(`io.nesin.tinyagents`), generated from the app's existing branding
(the launcher mark in `mobile/android/app/src/main/res/drawable/ic_launcher_foreground.xml`
and the site's look in `site/`).

| File                              | What it is                                |
| --------------------------------- | ----------------------------------------- |
| `play-store-icon.png`             | 512x512 app icon (Play requirement)       |
| `play-store-feature-graphic.png`  | 1024x500 feature graphic with the tagline |
| `phone-screenshot-{1..4}.png`     | 1080x1920 listing screenshots (mockups)   |
| `icon.svg`, `feature-graphic.svg` | Sources for the two PNGs above            |
| `mark.svg`                        | The logo mark on transparent, for reuse   |

The screenshots are mockups: the app screenshots from `site/media/` framed
on the launcher background with the mark, wordmark and a caption.

Regenerate the PNGs with `cairosvg` (see git history for the render script):

```sh
python -m venv /tmp/csvg && /tmp/csvg/bin/pip install cairosvg pillow
```

Note: the renderer falls back to DejaVu Sans if Inter is not installed;
if pixel-perfect Inter matters, re-render on a machine with Inter available.
