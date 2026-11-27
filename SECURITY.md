# Security policy

## Supported versions

tiny-agents is self-hosted and released from `main`. Only the latest release
gets security fixes. Update before reporting, in case it is already fixed.

## Reporting a vulnerability

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/AshikNesin/tiny-agents/security/advisories/new).
Do not open a public issue. Include what an attacker needs (a guest account, a
link the owner opens, a web page a bot reads), the steps, and what they gain.

You should hear back within a week. A confirmed issue is fixed on `main`, and
the advisory is published once a release carries the fix.

## How the app is protected

[docs/reference/threat-model.md](./docs/reference/threat-model.md) lists who can
reach the app, what they could take, and the control at each boundary.
