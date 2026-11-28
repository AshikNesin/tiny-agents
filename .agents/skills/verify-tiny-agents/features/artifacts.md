# Artifacts

A bot writes a document, diagram or page into a panel next to the chat. Each change is a version; the owner can view any version, copy or download it, and restore an old one as the newest. HTML and SVG run only in the sandboxed artifact frame, with no cookies, storage or network.

## Sub-features

- `artifact-card` a finished write shows a card (`data-testid="artifact-card"`) with the title, kind and version, and an `Open` button.
- `artifact-follow` a new version opens the panel (`data-testid="artifact-panel"`) on it.
- `artifact-frame` HTML runs in `data-testid="artifact-frame"` (`sandbox="allow-scripts"`); its scripts work, `localStorage` throws `SecurityError`.
- `artifact-source` the `Source` tab shows the content as text.
- `artifact-restore` combobox `Version` → an old version shows `Viewing version N of M.` and `Restore as latest`, which writes a new version `restored by you`.

## How to get to it (user POV)

- In a bot's chat, the bot calls `create_artifact`, `edit_artifact` or `rewrite_artifact`; the card appears in the transcript and the panel opens.

## Driving it with ta-verify

Preconditions: baseline run, doctor OK, signed in, a faux bot (API setup). Faux triggers: `/artifact html` creates `Counter page` (a counter button and a storage probe); `/artifact markdown` creates `Trip plan` with `Fly`; `/artifact markdown v1` rewrites it to `Take the train`. At 6 tokens/s a write takes up to a minute, so wait on the card, not the Stop button.

- **Card and panel.** Send `/artifact html` → card `Counter page`, panel opens.
- **Frame.** In the frame, `Add` twice → `2`; the probe reads `blocked: SecurityError`.
- **Rewrite.** `/artifact markdown`, then `/artifact markdown v1` → the panel shows `Take the train`.
- **Restore.** `Version` → `v1` → `Restore as latest` → panel shows `Fly`. Reload, open the last card: `Version` lists `v3 · restored by you`.

Journey: `../journeys/artifacts.mjs`.
