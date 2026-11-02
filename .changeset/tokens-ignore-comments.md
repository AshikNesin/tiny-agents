---
---

tooling: `pnpm check:tokens` ignores comment lines

A comment explaining why a class is avoided (e.g. "replaces the kit's
`transition-all`") no longer fails the design-token gate; only code is checked.
