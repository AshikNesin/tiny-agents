---
"@groot/core": patch
"tiny-agents": patch
---

Rate limits and request logs key on the client's real address. A client could
send a new `X-Forwarded-For` value on each sign-in attempt to get a fresh
rate-limit bucket and guess passwords without limit.

- `clientIp()` returns the socket peer. It reads `X-Forwarded-For` only when
  the peer is a trusted proxy, and then takes the rightmost hop that is not
  one. It no longer reads `CF-Connecting-IP` or `X-Real-IP`.
- `TRUSTED_PROXIES` (env) and `config.trustedProxies` list the trusted
  proxies: IPv4 addresses or ranges and IPv6 addresses. Unset trusts
  loopback and the private networks (`127.0.0.0/8`, `10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`, `::1`). A list replaces that default,
  and `none` trusts no proxy.
