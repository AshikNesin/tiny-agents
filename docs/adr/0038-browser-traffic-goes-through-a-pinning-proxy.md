# 0038 — Browser traffic goes through a pinning proxy

- Status: accepted (amends 0034)
- Date: 2026-11-21

## Context

The navigation guard checked a main-frame URL, and on the local transport
its resolved addresses, before Chrome sent the request. Chrome then looked
the name up again on its own, so a name could answer public to the guard and
private to Chrome (DNS rebinding, issue #445). On the VM transport the guard
could not resolve names at all, because Chrome resolves them on the VM, so a
name that is private only on the VM was not caught. Subframes and
subresources were never checked.

## Decision

Every Chrome the browser tools start sends all of its traffic through a
forward proxy on its own loopback (`--proxy-server`, with
`--proxy-bypass-list=<-loopback>` so loopback goes through it too). The
proxy resolves each name once, refuses the connection when any answer is a
private, loopback, link-local or metadata address, and otherwise connects to
the exact address it checked, so there is no second lookup to rebind.
`BROWSER_ALLOWED_PRIVATE_HOSTS` exempts names and addresses there as it does
in the guard.

- The local transport runs it in the server process
  (`packages/sandbox/src/egress-proxy.ts`), with the resolver the guard uses.
- The VM transport writes a Python 3 version
  (`packages/sandbox/src/egress-proxy-vm.ts`) into the profile at each launch
  and starts it before Chrome, so names resolve where Chrome runs. Python 3
  is already a VM requirement.
- A refused plain-http request answers 403 with `x-tiny-agents-refused`; a
  refused tunnel answers 403, which Chrome reports as
  `ERR_TUNNEL_CONNECTION_FAILED`. `navigate` turns both into a refusal.

The guard stays in front of the proxy: it refuses before a request leaves
the browser and gives the clearer error.

## Consequences

- The proxy cannot tell tabs apart, so it applies to the owner too: in the
  live view the owner can no longer open a private or tailnet address that is
  not in `BROWSER_ALLOWED_PRIVATE_HOSTS`. This replaces "the owner can browse
  anywhere in tabs no agent holds".
- Subframes, subresources, `fetch` and WebSockets are checked as well, not
  just main-frame documents.
- On the VM, a refused tunnel and an unreachable site produce the same
  Chrome error, so the agent is told the proxy "refused or couldn't reach"
  it.
- A plain-http request through the VM proxy is forwarded with
  `Connection: close`, one request per proxy connection.
