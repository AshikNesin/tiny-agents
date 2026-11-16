# Spec

The film as a brief with numbers. `STORYBOARD.md` has the story and the shots;
this file has the decisions the scenes are built to.

```text
GOAL:    The viewer leaves thinking "my bots do real work while I'm away, and
         ask me before anything that matters", and knows where the repo is.
OUTPUT:  HyperFrames. 1920x1080 (index.html), 1080x1920 (vertical.html) and a
         15 s 1920x1080 teaser (teaser.html), all 30 fps.
TIME:    76 s = 2280 frames; vertical 57 s; teaser 15 s. Score at 120 BPM:
         15 frames a beat, 60 a bar. Every cut between scenes is on a beat;
         the mark lands on a bar line (72.0 s).
LOOK:    Ground #f6f6f7. Ink #1f1f23. The product is the app's own markup and
         stylesheet, light theme, inside one fixed "screen": 1520x855, radius
         18, at (200, 171), shadow 0 36px 90px -24px at 28%. The camera moves
         inside it; the screen itself only changes shape for the bot list (a
         760-wide panel) and the phone. Captions: Inter Variable 700, 72 px,
         -0.04em, centred at y 62, one line, at most 6 words. Eyebrow 28 px,
         650, +0.16em, upper case, #6f6f7a. Colour only where the app puts it:
         its green for done and driving, its red for a failed run, its amber
         YOLO banner. End card: ground #0c0b0a, mark and name #fcfcfc.
OBJECTS: The bot list (the home stage, seen three times). The app window. The
         Code workspace. The live browser panel. An Android phone: a 760-wide
         dark body with a 62 px screen radius, rising from the bottom edge.
         The mark: the speech-bubble face from apps/web/public/favicon.svg.
MOTION:  Camera: power2.inOut, 0.55 to 0.7 s (the list panel: power3.inOut,
         0.7 to 0.95 s). Arrivals: power3.out or expo.out, 0.3 to 0.4 s. Exits:
         power2.in or power3.in, 0.18 to 0.55 s. Caption words: blur 8 px to 0
         over 0.16 s, 0.07 s apart; out over 0.18 s. Pointer: power3.out in,
         power2.inOut between targets; a click is 0.07 s down, 0.22 s up.
         Montage: hard cuts, each shot cuts in 7% wide and settles on expo.out.
SHOTS:   See STORYBOARD.md (ten frames in eight scene files).
BANNED:  A title over a dimmed screenshot. Three cards in a row. A docked
         logo. A small window floating in an empty frame. UI tilted in 3D.
         Glow, particles, gradients. Click rings. Invented UI: everything
         inside the screen was rendered by the app (see snap/NOTES-*.md).
QA:      0.0 the list with two rows; 2.2 four rows and the first caption;
         9.9 the Code thread open; 13.6 the diff; 17 the cost line; 27.6 the
         take-control pill; 36.3 the push on the lock screen; 39.6 the settled
         card on the phone; 46 the bot-builder card; 48.4 the new row in the
         list; each montage shot; 72 the mark; 75.9 the full end card.
```
