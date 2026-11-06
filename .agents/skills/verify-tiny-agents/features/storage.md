# File storage

The owner browses files on `/storage`: creates folders, uploads several files at once into the open folder, downloads a file byte for byte, views it in a new tab, renames it, deletes single files or a selection after confirming, and deletes a whole folder after confirming.

## Sub-features

- `storage-folder` creates a folder from `New Folder`; opening it updates the breadcrumb and the `?path=` URL.
- `storage-upload` uploads many files in one go from `Upload` (toast `2 uploaded`); rows show name, size and date.
- `storage-download` downloads through the row's `Download <name>` button with the exact uploaded bytes.
- `storage-view` opens the file in a new tab (`View`).
- `storage-rename` renames through the `Rename File` dialog.
- `storage-delete` deletes one file from its row (no confirm) or the selected files (`Select All Files` / row checkboxes → `Delete` → `Delete N file(s)?`).
- `storage-folder-delete` deletes a folder and its contents after `Delete folder "<name>/"?`.
- `storage-persist` keeps folder, files and names across a reload.

## How to get to it (user POV)

- Only by URL: `/storage` is not in the sidebar, the account menu or the ⌘K palette.
- `/storage?path=<folder>/` opens a folder directly; the home icon (`Go to root folder`) goes back to the root.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. Uploads land in the run's own `UPLOADS_DIR`. No folder `verify-folder-<stamp>`.

- **Folder.** `New Folder` → dialog `Create New Folder`, `Folder Name` = `verify-folder-<stamp>`, `Create`. Cell with the name. Click its button: URL has `path=verify-folder-<stamp>`, breadcrumb navigation contains it.
- **Upload.** Click `Upload` and answer the file chooser with `hello-<stamp>.txt` (UTF-8 text with `✓`) and `bytes-<stamp>.bin` (512 bytes, every byte value). Text `2 uploaded`; both rows; the binary row reads `512 Bytes`.
- **Download.** `Download bytes-<stamp>.bin` → a browser download named the same whose bytes equal the upload; toast `File downloaded successfully`. Second view: `GET /api/v1/storage/files/download?filePath=…` returns the same bytes.
- **View.** Row `View` → a new tab whose body shows the file's text (expected `second line ✓`).
- **Rename.** `Rename hello-<stamp>.txt` → dialog `Rename File`, `New Name` prefilled; set `renamed-<stamp>.txt`, `Rename`. New row, old row gone; `GET /storage/files?folder=…` agrees. Reload: rows still there.
- **Delete.** `Delete renamed-<stamp>.txt` removes it at once. `Select All Files` shows `Clear (2)` (the folder's `.keep` marker counts); `Clear (2)` resets. Tick the binary row's checkbox → `Clear (1)` → `Delete` → alertdialog `Delete 1 file?` → `Delete`.
- **Folder delete.** `Go to root folder`, `Delete folder verify-folder-<stamp>` → alertdialog `Delete folder "verify-folder-<stamp>/"?` → `Delete`. Cell gone; the root listing no longer has it.
- **Proof.** `ta-verify drive $S/journeys/storage.mjs` → `storage/uploaded`, `storage/renamed-after-reload`, `storage/folder-deleted`, `storage/view-tab.png`.

## Gotchas

- Regression check for #168 (fixed 2026-11): `View` opens a blob URL, and a blob keeps only `text/plain`, so UTF-8 text decoded as windows-1252 (`✓` as `âœ“`). The download route now adds `charset=utf-8` and `View` re-types text blobs; the step `View decodes UTF-8 text correctly` asserts the right text. The breadcrumb's console check (#172) is in `result.json` `consoleErrors`.
- A folder is a `.keep` marker: it is listed as a file inside the folder, `Select All Files` selects it, and deleting it removes the (now empty) folder.
- Upload through the `Upload` button's file chooser (`page.waitForEvent("filechooser")`), not the hidden input: the FeedbackBee embed adds another file input to the page.
- Storage is per instance, not per user; stamp every name.
- The breadcrumb renders `<li>` inside `<li>` (React logs a hydration warning in `server.log`); harmless for driving.
