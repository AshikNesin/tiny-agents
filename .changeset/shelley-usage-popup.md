---
"@groot/web": minor
---

Code page: clicking the context meter in the composer opens a usage popup
(Shelley's own context-usage table, ported): total and subtotal, per-model
token bands (cache read/write, input, output) with models.dev rates and
estimated cost, "Other (indirect)" rows (compaction, slug generation, …), a
sub-agent column when children exist, and "Compact in place". Pricing is
looked up through a new curated proxy route, `POST /shelley/model-costs`.
