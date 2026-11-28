# ADR 0053: Artifacts are tool-written versions, rendered in a sandboxed frame

- Status: **accepted**
- Date: 2026-11-28

## Context

Bots write long output (reports, single-page tools, diagrams) that the owner
reuses and iterates on. Inline in a reply, it scrolls away, every change
resends it whole, and HTML a model wrote can't be run safely on the app's
origin, where the session lives.

Other chat apps do this two ways: tags or directives parsed out of the reply
text (early claude.ai, LibreChat), or tool calls (Claude Code's `Artifact`
tool, the Vercel chatbot). Rendering is either same-origin (Open WebUI's
optional mode, which a plugin issue shows lets page scripts read the sign-in
token) or a sandboxed frame on an opaque or separate origin.

## Decision

- **Tool calls, not parsed text.** The `artifacts` toolkit
  (`packages/agent/src/toolkits/artifacts.ts`) has `create_artifact`,
  `edit_artifact` (find-and-replace, unique match, all or none),
  `rewrite_artifact`, `read_artifact` and `list_artifacts`. They go through
  the Tool gate like any tool, so both engines and routines get them. Writes
  are Allow by default: every change is a version the owner can restore.
- **Append-only versions with optimistic concurrency.** `artifacts` holds one
  row per slug per conversation and its head; `artifact_versions` holds every
  version. A change names the version it was built on (`base_version`) and is
  refused when the head has moved. Restore writes a new version that copies an
  old one. A replayed tool call finds its version by `source_key`.
- **Results stay small.** A write's result gives the slug and version, never
  the content; `read_artifact` fences the content as untrusted data.
- **HTML and SVG run only in the frame.** `GET /api/v1/artifact-frame` is a
  static shell served with `Content-Security-Policy: sandbox allow-scripts`
  and `connect-src 'none'`, so its document has an opaque origin even when
  opened directly, and can reach neither the session nor the network. The
  host posts the content to it after its `artifact.ready` message, checking
  the message came from that frame's window. Markdown, code and Mermaid render
  in the app the way chat replies already do.

## Consequences

- A frame on the app's host is safe for one owner's install, but not for
  links shared outside it, or for giving a page storage, model calls or tool
  calls. Those wait for a separate artifact origin and a host-side bridge
  whose calls go through the gate, as `docs/features/artifacts.md` sets out.
- A page can still navigate its own frame away, carrying what it holds in the
  URL. It only holds what the bot wrote into it, which the bot could send
  anywhere with its own tools.
- React artifacts need a compile step, so they wait with the separate origin.
