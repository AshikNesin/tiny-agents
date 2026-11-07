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
- A `TRUSTED_PROXIES` range with bits set past its prefix stops the boot with
  an error that names the entry, for example `10.0.0.1/8` or
  `::ffff:10.0.0.0/8` (which would mean `::/8`). Write the range's first
  address, and IPv4 ranges in IPv4 form.
