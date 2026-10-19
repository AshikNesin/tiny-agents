# Chat Attachments (issue #17)

Images and files in chat: composer staging, two vision paths, durable
transcript rendering.

## Architecture

```
Composer (paperclip/paste) → POST /api/v1/uploads (validate, prepare, store)
  → sendMessage(text, attachments[]) → vision split:
      vision model    → inline pi-ai ImageContent blocks + chat.user entry
      text-only model → see_image note lines + chat.user entry
  → transcript (deriveChat) → ChatMessage.attachments → JWT-cookie content URLs
see_image (tool) → VisionStore (attachmentIds + model variant bytes)
  → transcriber: VISION_MODEL | first gateway vision model | VISION_BASE_URL
```

Two storage copies per image, one consumer each:

| Copy                 | Consumer                  | Why                                 |
| -------------------- | ------------------------- | ----------------------------------- |
| `chat/<id>/original` | UI render, download       | Full quality                        |
| `chat/<id>/model`    | LLM (inline or see_image) | Upright, <=2000px, <=4.5 MiB base64 |

One Prisma `Upload` row is the single validated metadata source (kind, name,
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

| Rule                      | Value                                                       |
| ------------------------- | ----------------------------------------------------------- |
| Image types               | png, jpeg, webp, gif (magic-byte sniffed)                   |
| File types                | document/archive/media allowlist; no executables or scripts |
| Max original image / file | 20 MB / 25 MB                                               |
| Per message               | 10 attachments                                              |
| Prepared image            | EXIF-upright, max 2000x2000, base64 <= 4.5 MiB              |

## The two vision paths

The split is per send, from the model catalog's `input` modality
(`ModelInfo.vision`).

- Vision models receive the image inline as image blocks in the user message.
  No transcription loss, no extra call.
- Text-only models receive note lines (`[image attached: name, WxH (id)]`) and
  the auto-included `vision` toolkit (`agentConfig`, same force-include as
  `skills`; self-adjusts on model switch). `see_image(uploadId, question?)`
  side-calls a vision-capable transcriber and returns the text. Fail-open:
  upstream errors return `isError` with the reason; the bot keeps its turn.

Transcriber selection order: `VISION_MODEL` (if it resolves), the owner's
custom glm-5.3-flash (any custom provider serving it; custom providers
register `input:["text"]` while the upstream model accepts images, and
pi-ai sends image blocks through the same OpenAI-compat wire path), the
first gateway vision model (workers-ai first), then `VISION_BASE_URL` +
`VISION_API_KEY`. Empty answers retry once. None available: the tool errors
and the bot says so.

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
