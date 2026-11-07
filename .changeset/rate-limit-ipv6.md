---
"@groot/core": patch
---

Rate limits count an IPv6 client by its /64, and `TRUSTED_PROXIES` accepts
IPv6 ranges. An IPv6 host usually holds a whole /64, so a client could pick a
new address in it for each sign-in attempt and get a fresh rate-limit bucket.

- The rate limiters key an IPv6 client by its /64. An IPv4 client, including
  one in IPv4-mapped IPv6 form, keeps its own address as the key.
- `TRUSTED_PROXIES` (env) and `config.trustedProxies` accept IPv6 ranges such
  as `fd00::/8`. The default adds `fc00::/7` (unique local addresses), so a
  proxy on a private IPv6 network is trusted without setup.
