---
"@tiny-agents/agent": patch
"tiny-agents": patch
---

Parse durable memo and document JSON once, at the toolkit boundary. Every
read of a task memo or task document field that holds a structured value
(`gate:plan`, `gate:review`, `vault:use`, the questions document's questions
and answers, the credential request) now parses it with a zod schema in
`packages/agent/src/durable-json.ts`, and a value of the wrong shape fails at
once with an error naming its key. Writes copy the value to JSON with
`toJson`, which drops undefined fields.

- `@tiny-agents/agent`: no public export changes. `zod` is a new dependency.
  A pending vault card in a call's details shows only when it fits the
  `ChatVaultUse` shape, and fields outside that shape are dropped.
- `tiny-agents`: lint rule R6 (`repo/no-double-cast`) fails any `as unknown as`
  or `as any as` in `packages/agent/src` outside test helpers, with a message
  naming `durable-json.ts`.
