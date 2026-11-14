# Chat Attachments (issues #17, #58)

Images and files in chat: composer staging, two vision paths, durable
transcript rendering, and (issue #58) bots reading the files themselves.
See [Reading files](#reading-files-issue-58).

## Architecture

```
Composer (paperclip/paste) → POST /api/v1/uploads (validate, prepare, store)
  → sendMessage(text, attachments[]) → vision split:
      vision model    → inline pi-ai ImageContent blocks + chat.user entry
      text-only model → see_image note lines + chat.user entry
  → transcript (deriveChat) → ChatMessage.attachments → JWT-cookie content URLs
see_image (tool) → VisionStore (attachmentIds + model variant bytes)
  → transcriber: the `vision` model role | first model that sees images
```

Two storage copies per image, one consumer each:

| Copy                 | Consumer                  | Why                                 |
| -------------------- | ------------------------- | ----------------------------------- |
| `chat/<id>/original` | UI render, download       | Full quality                        |
| `chat/<id>/model`    | LLM (inline or see_image) | Upright, <=2000px, <=4.5 MiB base64 |

One `uploads` row is the single validated metadata source (kind, name,
mime, size, dimensions). Preparation runs at upload time through Photon in a
worker thread (pi-durable's node images helper, re-exported via
`@tiny-agents/agent`).

## Module structure

```
packages/agent/src/
├── toolkits/vision.ts             # see_image toolkit (readOnly, allow)
├── toolkits/vision-transcribe.ts  # transcriber selection + retry + fail-open
├── transcript.ts                  # chat.user entries → ChatMessage.attachments
└── runtime.ts                     # submit(images, attachments), attachmentIds
apps/web/src/server/api/uploads/
├── uploads.routes.ts              # POST /uploads, GET /uploads/:id/content, DELETE
├── uploads.service.ts             # validation, preparation, row + bytes
├── uploads.prepare.ts             # sniffing, dimensions, Photon
└── uploads.store.ts               # VisionStore adapter
apps/web/src/client/components/Attachments.tsx   # staging chips + transcript rendering
```

## Limits

| Rule                      | Value                                                             |
| ------------------------- | ----------------------------------------------------------------- |
| Image types               | png, jpeg, webp, gif (magic-byte sniffed)                         |
| File types                | document/archive/media/text/code allowlist; bytes sniffed (below) |
| Max original image / file | 20 MB / 25 MB                                                     |
| Per message               | 10 attachments                                                    |
| Prepared image            | EXIF-upright, max 2000x2000, base64 <= 4.5 MiB                    |

## The two vision paths

The split is per send, from the model catalog's `input` modality
(`ModelInfo.vision`).

- Vision models receive the image inline as image blocks in the user message.
  No transcription loss, no extra call.
- Text-only models receive note lines (`[image attached: name, WxH (id)]`) and
  the auto-included `vision` toolkit (`bots.conversation.ts`, same force-include as
  `skills`; self-adjusts on model switch). `see_image(uploadId, question?)`
  side-calls a vision-capable transcriber and returns the text. Fail-open:
  upstream errors return `isError` with the reason; the bot keeps its turn.

The transcriber is the `vision` model role (Settings → Models): the model set
there, else the first available model on pi that takes images. A direct
vision endpoint is just another provider account. The call declares image
input on its copy of the model, so a model marked text-only still gets the
image. Empty answers retry once. None available: the tool errors and the
bot says so.

Every submit path (send, mention delivery, bot-to-bot message and relay,
routine fire into the routine's own conversation) goes through `submitToBot`
in `bots.conversation.ts`, which reconciles the target conversation's durable
config from the bot's row first and drops a stale
`vision` toolkit when the model sees images inline; editing a bot or
answering an approval reconciles too. A durable conversation can never run
a selection older than its row.

Custom models declare their input modality at registration: `vision: true`
opts in, `vision: false` opts out, and `glm-5.3-flash` defaults to
image-capable. This matters beyond the side-call: pi-ai's
`downgradeUnsupportedImages` replaces image blocks with a placeholder for
any model registered text-only, so a wrong flag strips images before the
wire. The transcriber also declares image input on its resolved model
defensively, so a stale registration flag cannot neuter the side-call.

## Gotchas encoded in tests

- Optimistic-echo dedupe compares text AND attachment ids (two image-only
  sends would otherwise swallow each other's echoes).
- Bot-list preview for image-only sends is `[Image] name`, not empty.
- Dimensions come from the original bytes (Photon reports them only when it
  resized).
- Inline serving is restricted to sniffed image types; everything else gets
  `Content-Disposition: attachment`.
- A Buffer passed to Photon is copied to a plain Uint8Array first (worker
  structured clone).

## Reading files (issue #58)

Bots can read every non-image attachment, whatever their model: PDFs,
Office/OpenDocument files, CSV/JSON/YAML/HTML/Markdown, text and code, and
archive listings. They read through tools; whole files are not put into
context.

```
POST /uploads → sniffFile (415 on mismatch/executable) → row extractStatus=pending
  → queueExtraction (2 at a time) → worker thread (512 MB heap, 60 s)
      extract(): text | pdf (unpdf) | docx/xlsx/pptx/odt/ods/odp (zip + XML) | zip/tar/tgz/gz listing
  → chat/<id>/extract.json + row extractStatus/extractMeta
send → resolveAttachments: per file a reference line with its id
     + the whole text, fenced, when ≤ 32k chars (≤ 96k per send) — else the outline
bot → attachments toolkit: list_attachments, read_attachment, search_attachment,
      copy_attachment_to_sandbox (AttachmentStore, scoped to the conversation)
```

### Sniffing

The extension picks a family and the bytes must agree with it (§9.1). The
stored `mimeType` is the sniffed type, not what the browser claimed.

- **PDF** must have `%PDF-` in its first KB.
- **OOXML** must be a zip that has its main part, and **ODF** a zip with
  `content.xml`.
- **Legacy Office** must start with the OLE header.
- **Archives and media** must start with their magic bytes.
- **Text and code** must have no NUL bytes in the first 8 KB. Text decodes as
  UTF-8 or UTF-16 (with a BOM), else as Windows-1252.
- **Executables** (ELF, PE, Mach-O) are refused under any name, with a 415.

### Extraction

Extraction runs in a worker thread (`uploads.extract-runner.ts`). The
production build emits that worker as `dist/uploads-extract-worker.js`; dev
loads the TypeScript entry through tsx; Vitest runs it in-process. A parser
that crashes, hangs or runs out of memory fails that one file, never the web
process.

| Format                                            | What is read                                                                                                                                                                                                                                                                 | Caps and notes                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Text and code                                     | Split into pages of about 16k chars (≈4k tokens), labelled `lines a–b`. Markdown headings become the outline.                                                                                                                                                                | Up to 2M chars in total                                                                         |
| JSON / YAML                                       | Pages as for text. JSON is pretty-printed, and `valid` records whether it parses (js-yaml's safe load for YAML).                                                                                                                                                             |                                                                                                 |
| HTML                                              | Text only. Scripts, styles and comments are dropped, and nothing is rendered.                                                                                                                                                                                                |                                                                                                 |
| PDF                                               | One page each, with the outline, title, author, and a count of image-only pages (scans)                                                                                                                                                                                      | Up to 500 pages; encrypted files fail with a reason                                             |
| DOCX / ODT                                        | Markdown with headings, lists and tables. Headings become the outline.                                                                                                                                                                                                       |                                                                                                 |
| XLSX / ODS / CSV / TSV                            | Sheets as rows of text cells. Formulas keep their cached values and are never evaluated. Hidden sheets are flagged. ODS repeated empty rows and columns are not expanded.                                                                                                    | Up to 20 sheets and 200k cells                                                                  |
| PPTX / ODP                                        | One page per slide, with its speaker notes, in presentation order                                                                                                                                                                                                            |                                                                                                 |
| ZIP / TAR / TGZ / GZ                              | A listing only, never extracted. Zip entries come from the central directory; tar headers are walked (through gunzip for .tgz) while file data is skipped. Unsafe paths (`..`, absolute, control characters), compression ratios over 100:1 and nested archives are flagged. | 10k entries and 1 GB declared or inflated; past that the listing is marked suspicious and stops |
| 7z, RAR, BZ2, legacy .doc/.xls/.ppt, audio, video | `unsupported`                                                                                                                                                                                                                                                                | Copy to the sandbox to work on them                                                             |

The XML reader (`uploads.xml.ts`) never resolves DTDs or external entities.

### What the model sees

For each file, the send carries a reference line with its id, type, size,
counts and status. A small file's whole text follows inside
`<attachment id="…" name="…" untrusted> … </attachment>`, and a fence-like
sequence inside a file can't close it.

Larger files get their outline instead. Each file waits up to 5 s for an
extraction still running, so small files are inline on the first turn.

The `attachments` section of the system prompt and every tool result say
the same thing: file contents are untrusted data, never instructions. Tool
results also carry `details.untrusted: true`.

The owner's bubble hides these notes (`attachment-notes.ts`). Memory capture
strips them too (`stripAttachmentNotes`), so a file can't plant "facts about
the owner".

### Tools

All of these resolve only ids attached to this conversation (the newest 50
user entries), as `see_image` does.

- `list_attachments`: the chat's files, with their state.
- `read_attachment(uploadId, page | pages | sheet + rows)`:
  - The first call returns the outline and the first part.
  - Sheets come back as Markdown tables.
  - Archives come back as their listing.
  - Each read returns at most 64k chars.
- `search_attachment(uploadId, query, regex?, max_hits?)`:
  - Hits come back as `page …, line n` or `sheet "…", row n`.
  - A regex is capped at 200 chars, and nested quantifiers are refused.
- `copy_attachment_to_sandbox(uploadId, dest?)`:
  - Writes the original bytes over SFTP to `attachments/<id>/<name>` (binary
    `writeFile`) and returns the path and SHA-256.
  - It isn't read-only, so it asks for approval by default, like the
    sandbox's own tools.

### UI and API

- File chips in the composer and the transcript poll `GET /uploads/:id` and
  show "extracting…", the page, sheet or line count, "can't read", or
  "download only".
- A transcript chip opens a read-only preview built from
  `GET /uploads/:id/text?page=&sheet=`:
  - text and code in monospace;
  - sheets as a table of up to 200 rows;
  - archives as a path list.
- The preview never renders HTML, PDF or Office files. The original stays a
  download, served as `attachment` with `X-Content-Type-Options: nosniff`.
- `DELETE /uploads/:id` also removes `extract.json`.
- Uploads from before #58 extract the first time a bot or the preview asks.

### Not yet

- Summary cards for long files.
- Rendering image-only PDF pages through the vision path.
- Audio and video transcription.
- Native PDF blocks: pi-ai has no document content type yet.
- The 24 h orphan sweep.
- Upload progress percentages.
- Moving the caps to app config. They are constants in `EXTRACT_LIMITS`
  for now.
