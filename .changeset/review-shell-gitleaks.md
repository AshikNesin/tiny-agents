---
"@groot/shell": patch
---

Gitleaks' two generic rules now match quoted literal values only, so ordinary code (`password: z.string()`, `const token = makeToken()`) no longer blocks commits; the demo login's credentials carry an inline `gitleaks:allow`. Sync tooling: a malformed conflict manifest or `boilerplate-sync.json` is reported as such instead of being treated as "nothing pending" / "not found"; `package.json` without a sync baseline is merged instead of getting conflict markers. `groot:setup` rejects names that give no usable slug, renames the Worker whatever its current name, and no longer breaks on `|`, `&` or `\` in the app name.
