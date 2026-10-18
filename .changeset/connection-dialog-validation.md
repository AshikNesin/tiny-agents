---
"@groot/web": patch
---

Validate the Add connection dialog instead of silently disabling Save. Name and URL are now required with an inline "Enter a name" / "Enter a valid https:// URL" hint after the field is touched, the URL must parse as an http(s) URL, header auth explains its missing secret, and the hidden Test connection button (OAuth) says why: "Sign-in (OAuth) is tested after saving".
