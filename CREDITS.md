# Credits

tiny-agents stands on the work of others. This file names the projects whose
ideas or design shaped it, beyond the dependencies listed in `package.json`.

## Design inspiration

| Project                                                                      | What it inspired                                                                                                                                                                                                                                                                                                                                                            | License    |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [t3code](https://github.com/pingdotgg/t3code)                                | The minimal layout of **Code** (`/code`): a sidebar of threads grouped by project, each group with its own New thread, a one-line thread header, and project settings as pages of their own. No t3code source is copied; see `docs/features/code.md`.                                                                                                                       | MIT        |
| [diffshub](https://github.com/pierrecomputer/pierre/tree/main/apps/diffshub) | The layout of a **PR review** (`/code/reviews/<id>`): the file tree beside one scrolling column of diffs with sticky, foldable headers, the Files and Comments tabs, and the diff stats. Its tree and diff settings (kept tree order, search hidden until opened, folder dots hidden, the stuck-header rule) are adapted in `apps/web/src/client/pages/code/PullDiffs.tsx`. | Apache-2.0 |
