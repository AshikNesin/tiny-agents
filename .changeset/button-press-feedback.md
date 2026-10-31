---
"@groot/ui": patch
---

Button: instant hover colors and a press scale

The button animated every property (`transition-all`), so hover colors faded
in, against the DLS rule of instant color hover. It now transitions only
`transform`: pressing scales it to 0.97 over 150ms on a strong ease-out
(replacing the 1px nudge); menu triggers (`aria-haspopup`) still don't move,
and reduced motion turns the transition off.
