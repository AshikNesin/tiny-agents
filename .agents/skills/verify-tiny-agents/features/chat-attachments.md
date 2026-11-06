# Chat attachments

A user attaches images and files to a chat message from the composer's `+` menu (or by paste or drop). Staged items show as thumbnails or file chips that can be removed before sending; an image alone is a valid message. Sent images render in the bubble, open in a full-window viewer and survive a reload. Sent files show as chips with their extraction state, open a read-only text preview, and the bot receives their text. A file whose bytes don't match its extension is refused at upload.

## Sub-features

- `attach-stage` stages an image through `Add files or mention a bot` → `Add files or images` (the OS file chooser): thumbnail `data-testid=staged-image` in `data-testid=staged-strip`.
- `attach-send` sends image + text: the bubble carries button `Enlarge <name>` and the bot replies.
- `attach-reload` re-renders the image from the server after a reload (the image really loads, `naturalWidth > 0`).
- `attach-image-only` sends an image with no text; the bot list preview reads `[Image] <name>` until the reply lands; two image-only sends don't swallow each other.
- `attach-remove` removes a staged item with `Remove <name>` before sending.
- `attach-file` sends a text file: chip button `Preview <name>` (shows `N lines` once extracted) plus link `Download <name>`; the preview dialog (named after the file) shows the extracted text.
- `attach-file-read` the bot receives the file's text inline (the faux echo repeats `[file attached: …] <text>`).
- `attach-refused` a file whose bytes don't match its extension (e.g. text named `.pdf`): staged chip `Upload failed` (`img` named `<name>: <reason>`) plus an error toast.
- `attach-enlarge` the image viewer, dialog `Image <name>`, should cover the window and close with `Close image`.

## How to get to it (user POV)

- Open a bot's chat (`/chats/<botId>`), press the `+` button (`Add files or mention a bot`) → `Add files or images`. Paste into the composer and drag-and-drop onto the chat (overlay `Drop files to attach`) stage files too.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. A bot of the journey's own (`setup:` via `POST /api/v1/bots` with the default model from `GET /api/v1/models`).

- **Stage.** `page.waitForEvent("filechooser")`, click `Add files or mention a bot` → menuitem `Add files or images`, `setFiles(...)`. Wait for `Send message` to be enabled (upload settled).
- **Send image + text.** Fill composer `Message <bot>`, click `Send message`. The strip disappears; `Enlarge <name>` shows; `Echo: …` arrives.
- **Reload.** `page.reload()`; the `img` inside `Enlarge <name>` is visible with `naturalWidth > 0`.
- **Image-only.** Stage, click `Send message` with no text. Poll `GET /api/v1/bots` (100 ms) for `lastMessagePreview === "[Image] <name>"`. Reload; still rendered.
- **Remove.** Stage, click `Remove <name>`; the strip is gone.
- **File.** Stage a `.txt`, send with text. Chip `Preview <name>` contains `lines`; click it, dialog `<name>` shows the text; Escape closes. The bot's echo contains the file text.
- **Refused.** Stage `fake.pdf` with text bytes: `img` named `fake.pdf: …`, text `Upload failed`; remove it.
- **Enlarge.** Click `Enlarge <name>`: dialog `Image <name>` should span the viewport, and `Close image` should close it.
- **Proof.** `ta-verify drive $S/journeys/chat-attachments.mjs` → `chat-attachments/staged`, `sent-image`, `image-only`, `file-preview`, `file-read`, `refused`, `enlarged`.

## Gotchas

- Known product bug (2026-11): the enlarged image viewer is a `fixed inset-0` overlay rendered inside the transcript row, whose `content-visibility: auto` makes it the containing block, so the "lightbox" is clipped to the message row and its `Download` button covers `Close image`. The journey's last step asserts the correct full-window viewer and fails until it is fixed; every earlier step still proves the rest.
- Use the real file chooser path, not `setInputFiles` on the hidden input: the hidden input skips the `+` menu the user goes through.
- A 1x1 PNG renders as a near-invisible dot; use a bigger image (the journey crops a screenshot of the app) so proofs are readable.
- The faux model is text-only: the composer shows `Test Model (faux) reads images with the see_image tool`, and an image-only send echoes as a bare `Echo:`.
- The `[Image] <name>` preview is replaced by the reply's preview once the bot answers: poll fast right after sending.
- The verify instance runs Vite in dev mode: a file change anywhere in the checkout (another agent's edit) can hot-reload the page mid-step and close an open dialog. Rerun on a quiet tree before calling it a bug.
