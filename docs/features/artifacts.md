# Artifacts

An artifact is a versioned document, diagram or page a bot writes into a side
panel next to the chat, instead of into its reply. The decision is
[ADR 0053](../adr/0053-artifacts-are-tool-written-versions-in-a-sandboxed-frame.md).

```
packages/agent/src/toolkits/artifacts.ts       # the toolkit, its prompt section and the ArtifactStore port
packages/agent/src/toolkits/artifacts-edit.ts  # applyEdits: find-and-replace with unique matches
apps/web/src/server/db/schema.artifacts.ts     # the `artifacts` and `artifact_versions` tables
apps/web/src/server/api/artifacts/             # service, store, routes and the frame shell
apps/web/src/shared/api/artifacts.ts           # wire types
apps/web/src/client/components/artifacts/      # card, panel, frame, follow hook
tests/server/app/agent/artifacts-tools.test.ts # the tools through a faux model
tests/server/routes/artifacts.routes.test.ts   # versions, restore, guests, the frame's CSP
```

## Kinds

| Kind       | Rendered by                                           |
| ---------- | ----------------------------------------------------- |
| `markdown` | The chat's Markdown renderer, Mermaid fences included |
| `code`     | A highlighted code block (`language` names it)        |
| `mermaid`  | The chat's Mermaid renderer                           |
| `svg`      | The sandboxed frame, centered and scaled to fit       |
| `html`     | The sandboxed frame, as the whole page                |

## Tools

`ARTIFACT_KINDS` and `MAX_ARTIFACT_CHARS` in the toolkit own the kinds and the
size cap.

- `create_artifact` takes a kebab-case slug unique in the chat, a title, a
  kind and the whole content.
- `edit_artifact` takes `base_version` and up to 20 edits. Each `old_string`
  must match once unless `replace_all` is set; the edits apply in order, all
  or none, and a failed one says which edit and why.
- `rewrite_artifact` replaces the content, and optionally the title.
- `read_artifact` returns a version's content fenced as untrusted data;
  `list_artifacts` lists the chat's artifacts with their heads.

A write built on a version that is no longer the head is refused with the
current version, so the bot reads it and redoes the change. The write tools
are Allow by default; the read tools are read-only.

## In the chat

A finished write shows as a card (`ArtifactCard`) instead of a folded step,
because `finishedToolRow` lifts the result's `details.artifact` onto the tool
call. When a new version lands while the chat is open, the panel opens on it
(`useArtifactFollow`). The panel shows Preview or Source for any version,
copies or downloads it, and lets the owner restore an old version as the
newest. Guests of a shared bot can read its artifacts but not restore them
(`GUEST_ACCESS.artifacts`).

## The frame

`GET /api/v1/artifact-frame` serves a fixed shell (`artifacts.frame.ts`) with
a `sandbox allow-scripts` CSP, so the page has an opaque origin, no network
(`connect-src 'none'`), no forms, no nested frames and no external images.
`ArtifactFrame` loads it in an `<iframe sandbox="allow-scripts">`, waits for
`artifact.ready` from that frame's window and posts the content back; the
shell writes it as the document. Each version reloads the frame.

## Not built yet

These follow the design in order, each behind the one before:

1. A separate artifact origin (`ARTIFACTS_ORIGIN`), and React artifacts
   compiled on the server with vendored libraries.
2. A host-side bridge for pages: storage, a model call on a cheap role with a
   budget, and tool calls through the gate with a fixed deny-list (vault,
   commands, browser, computer, bots, memory writes). Each capability is
   declared on the artifact and approved by the owner.
3. Public links pinned to a version, served only from the separate origin.
4. Owner edits, a diff between versions, and streaming content into the
   panel while the tool call's arguments arrive.
