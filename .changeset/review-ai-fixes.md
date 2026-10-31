---
"@groot/ai": patch
---

- `zodToTypeBox` keeps `.describe()` on objects, arrays, enums, literals and optional/nullable/default wrappers; defaulted fields are optional in the generated schema (Zod applies the default); zod 3 arrays are no longer converted to `Any`.
- Images passed as `data:` URLs without a `mimeType` use the URL's media type instead of `image/png`.
- Capability detection: only Gemini (not every Vertex-hosted model) is document-capable; `gpt-oss` is text-only; `qwen*-vl` / `glm-*v` vision variants accept images.
