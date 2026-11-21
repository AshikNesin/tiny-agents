Tidy the repo root.

Removes unused root files (.e2e-shots screenshots, .kilo skill symlink,
.varlock telemetry config, Procfile, config.yml), moves PRD.md to docs/PRD.md
and excludes it from groot sync in .groot/boilerplate-sync.json. No
packages/\*/src surface changes; no release needed.
