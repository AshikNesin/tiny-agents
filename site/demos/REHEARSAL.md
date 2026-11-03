# Rehearsal: How it works demos

Three stages, 360 x 252 each, one per step card, played once in reading order.

## Gold copied

- Step 1 (`StepSetup`): `static-card` for the pinned, bottom-bleed card;
  `controls` for the Segmented thumb and a fade `Roll` on the row's note.
- Step 2 (`StepAsk`): `ai-chat` for the thread pinned to its bottom, placeholder
  earlier turns, the composer typed into and sent, `Stream` for the answer.
- Step 3 (`StepApprove`): `ai-cards` and `form-error` for a button that confirms
  on itself (busy, then Paid) in one `States` slot.

## What changed from the gold

- The Tiny Agents look (`look.css`): the site's graphite inks, Inter, the app's
  black message bubble, green only for online and done, amber for approval.
- Chromeless cards instead of windows: three tiles in a row would otherwise
  repeat the traffic lights three times (bento rule 3).
- The three bleed differently (bottom, top, whole) so neighbours contrast.
- `chain.ts` holds each script until the one before it lands its payoff,
  so one cursor moves at a time across the row.

## Filmed

- Posters at 1280 (three across), 900 (rows) and 390 (stacked).
- `--states` sheets for each stage; a zoom on the busy spinner.
- `film.mjs --gate`: the remaining lines are the six `kit override` lines and
  the typing `jump`, both explained below.

## Not fixed, and why

- `kit override: .ss-check__fill`: a false positive. The filmer skips
  stylesheets whose path contains `/kit/`, and the build bundles the kit's CSS
  into `assets/demos.css`. No demo stylesheet touches `.ss-check`.
- `jump: ss-field__chars`: the composer's text growing a character at a time
  as it is typed.

## Not checked

- Dark mode: the site is light only.
- Safari and Firefox by eye (filmed in Chromium only).
