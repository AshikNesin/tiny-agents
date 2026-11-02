# @groot/ai

## 0.3.1

### Patch Changes

- [#51](https://github.com/AshikNesin/tiny-agents/pull/51) [`f1e3914`](https://github.com/AshikNesin/tiny-agents/commit/f1e39146a6cd72b104b41a905080fea52a9a340c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bump dependencies, including `@earendil-works/pi-durable`, `pi-ai`, and `chord` to 1.4.0. Document definitions pass `checkpointWhen: () => false` so ordinary changes stay deltas. Sentry 11, files-sdk 3, and SimpleWebAuthn 14 needed small call-site updates.

- [`f68af60`](https://github.com/AshikNesin/tiny-agents/commit/f68af60207a704ffc54b797ddb06b19f3403c842) Thanks [@AshikNesin](https://github.com/AshikNesin)! - - `zodToTypeBox` keeps `.describe()` on objects, arrays, enums, literals and optional/nullable/default wrappers; defaulted fields are optional in the generated schema (Zod applies the default); zod 3 arrays are no longer converted to `Any`.
  - Images passed as `data:` URLs without a `mimeType` use the URL's media type instead of `image/png`.
  - Capability detection: only Gemini (not every Vertex-hosted model) is document-capable; `gpt-oss` is text-only; `qwen*-vl` / `glm-*v` vision variants accept images.

## 0.3.0

### Minor Changes

- [`612b968`](https://github.com/AshikNesin/groot/commit/612b9688bee6548518c8df1b6c990bca87df45a0) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Upgrade pi-ai with Cloudflare AI Gateway provider support.

## 0.2.0

### Minor Changes

- [`8621fea`](https://github.com/AshikNesin/groot/commit/8621feac29186b5c829320b51c35707d4004b5af) Thanks [@AshikNesin](https://github.com/AshikNesin)! - feat(ai): add maxReasoningEffort() — resolve a model's highest supported reasoning effort

  New export in `capabilities.ts` alongside `getModelCapabilities`. Maps a
  gateway model id to the highest `reasoning_effort` value it accepts (or
  `undefined` when the model has no effort control), sourced from ClinePass's
  model catalog (the `reasoningOptions` effort values embedded in the cline CLI):

  - kimi-k3 → `"max"` (catalog: low/high/max — most callers hardcode "high"
    and leave the top level unused)
  - glm-5.2 / deepseek-v4 / qwen3.8-max → `"xhigh"`
  - kimi-k2.6/k2.7-code, qwen3.7*, mimo*, minimax-m3 → `undefined` (param must
    be omitted — these models accept no effort control)
  - unknown models → `"high"` (safe default every OpenAI-compatible reasoning
    API accepts)

  Also exports the `ReasoningEffort` union (pi-ai's ThinkingLevel + `"max"`)
  for typing the parameter at call sites.
