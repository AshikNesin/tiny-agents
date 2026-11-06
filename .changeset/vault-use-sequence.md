---
"@tiny-agents/agent": minor
"@groot/web": minor
---

Every vault sink goes through one use sequence.

- `run_command` with `secrets` plans, asks, records and resolves through the
  shared vault sequence instead of calling the broker by hand:
  `vaultGatePlan` now takes several uses (`IntendedUses`: the uses, an
  `everyUse` flag, an optional sink rule checked after policy, extra card
  fields), and
  `useAllFromSink` resolves them nested, the way `useFromSink` (now its
  one-item form) does for one. The approval card is built by the shared plan:
  a single secret's card shows the item's real kind (and username for a
  login) instead of a fixed `api_key`; several secrets join their handles and
  labels as before; a long command is cut at 2000 characters on every card. A
  denied or expired command records against the uses the call was planned
  for.
- New `VaultTargetMovedError` (root export, carries `actual` and the audit
  `reason`): `OriginMismatchError` and `WindowMismatchError` extend it.
  `useFromSink` turns one thrown by a sink into a `refused_origin`
  `VaultError` worded by the sink. The app checks `instanceof` instead of the
  error's name, so a desktop window that moved before typing is now audited as
  `refused_origin` ("active window changed before typing") instead of
  `sink_error`.
- `resolveConnectionSecret` (MCP connection headers) runs the same internal
  path as `useItem`: one policy, audit, resolve and last-used step for both.
  The connection still receives the value, its audit rows and messages are
  unchanged.
