---
"@groot/ui": minor
"@groot/shell": patch
"@groot/web": minor
---

Rebuild the remaining kit components on Fluid Functionalism's design, with
their APIs unchanged. New `@groot/ui/motion` entry exports the shared
`spring` tiers, `useModalPresence` and `FluidHighlight`.

- `TabsList` slides its selected pill (or `line` underline) between tabs and
  shows a hover pill.
- `Tooltip` is an inverted chip that springs in and fades out; the provider's
  delay drops to 200ms.
- `Select`, `DropdownMenu` and the command menu share one gliding row
  highlight and a softer popup entrance; the picked select row is medium weight.
- The command menu gets a borderless search line, brightening rows and a new
  `CommandFooter` of keyboard hints (hidden on touch); `CommandDialog` and the
  shell palette open top-anchored at `lg` width.
- In the app: the switch thumb springs, stretches, squashes and can be
  dragged; owner messages are a soft tinted bubble and bot replies plain text,
  with time and copy in a hover row (always shown on touch) and a spring
  entrance for new messages; the composer has Fluid's ring frame and a
  send/stop button that morphs between states.
