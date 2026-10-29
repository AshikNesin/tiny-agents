---
"@groot/web": minor
"@tiny-agents/agent": minor
---

Bots read uploaded files, not just images (issue #58).

- Every upload is sniffed: the stored MIME is the bytes' type, a mismatch or an executable is a 415, and code and plain-text extensions are allowed.
- Files extract in a worker thread (memory cap, timeout) to `chat/<id>/extract.json`:
  - text and code, CSV/TSV, JSON/YAML (validity), HTML as text;
  - PDF pages, outline and metadata (unpdf);
  - DOCX/ODT as Markdown, XLSX/ODS sheets (cached formula values, hidden sheets), PPTX/ODP slides with notes;
  - zip/tar/tgz/gz listings with traversal, ratio and size caps, never extracted.
- `Upload` gains `sha256`, `extractStatus`, `extractError`, `extractMeta` and `extractedAt`.
- Sends carry a reference line per file with its id and state, plus the file's text when it is small, fenced as `<attachment … untrusted>`.
- New `attachments` toolkit, given to every bot: `list_attachments`, `read_attachment`, `search_attachment` and `copy_attachment_to_sandbox` (binary SFTP writes: `SandboxSession.writeFile` takes bytes). Ids are scoped to the conversation.
- New routes `GET /uploads/:id` and `GET /uploads/:id/text`; content responses send `nosniff`; deleting an upload removes its extraction.
- File chips show the extraction state and open a text-only preview. The owner's bubble and memory capture leave file text out (`stripAttachmentNotes`).
- The vision send path keeps file notes alongside the images.
