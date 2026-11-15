# Review

What was built, what was checked, and what is not what it looks like. Read this
before changing the film.

## The creative calls

- **Storyline: "The inbox".** The bot list is the home screen: the film opens on
  it full of finished work, opens each bot to show how the job got done, and
  ends on it with nothing unread. The two storylines not built are in
  `STORYLINES.md`.
- **The whole product, not only what is new.** Coding hand-offs come first and
  get the most time (14 s of 76).
- **The app's light theme** on the site's light ground; only the end card is
  dark.
- **YOLO mode is one montage shot**, not a scene: "it asks first" is the
  stronger message.
- **HyperFrames, CLI 0.9.53.** The plugin pinned 0.9.54, which was not on npm
  when this was made.

## What is real

Everything inside the film's screen is the app's own markup and stylesheet,
saved from a running instance and checked to embed pixel for pixel
(`tools/snaplib.mjs`, `snap/NOTES-*.md`).

| On screen                                                | How it got there                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Bot list, previews, unread dot, waiting counts           | Real flows in the app                                                                                                   |
| Bot-builder card, its approval, the new bot              | A real `create_bot` call, approved through the real button                                                              |
| Code Buddy's chat, the hand-off card, the relayed answer | A real `code_start` call on the real server                                                                             |
| The Code workspace and its transcript                    | The real Claude Code driver and worker, with the agent SDK replaced by the tests' fake, which plays the scripted thread |
| The routine run at 07:00                                 | The routine fired on its own in the app                                                                                 |
| The vault card and its approval                          | Real: a real vault item, a real fill into a real page                                                                   |
| The live view, "Click to take control", "You're driving" | Real: a real Chrome streamed over VNC from this machine standing in for the sandbox VM                                  |
| The shared chat, in Ashik's and Sonaal's windows         | Real: a real guest account, real messages                                                                               |
| Memory, the YOLO chat and its auto-approved rows         | Real flows                                                                                                              |
| Settings → Updates                                       | The real server, with a stand-in for the `pnpm local` supervisor                                                        |
| The phone's chat screens                                 | Real renders of the Android app's Compose UI (Roborazzi on the JVM), with the cast's data as fixtures                   |

Each of these exists in the current code: `live/live-parts.tsx` (take
control), `live/LivePanelHeader.tsx` (driving, hand back),
`CodeHandoffCard.tsx`, `chat-message/PeerCard.tsx` (the relayed answer),
`pages/code/Transcript.tsx` (the cost line), `chat-pane/ChatPaneNotices.tsx`
(the YOLO banner), `UpdatesSettings.tsx`, `chat-message/tool-cards.tsx`
(approval cards), `packages/agent/src/toolkits/bot-builder.ts`,
`pages/memory/Memory.tsx`, `pages/settings/models/ModelsSettings.tsx`,
`components/connections/`, and `mobile/android/.../feature/chat/ToolCards.kt`.

## What is not what it looks like

- **Every bot reply is scripted.** The app ran its fake model, told to say the
  lines in `CAST.md`. The people, fares, flight times, test counts, the cost
  line and the card number are sample data. `flights.example.com` is a small
  local page.
- **The model's name in the message box** read "Test Model (faux)" and is
  changed to "Claude Sonnet 5.5" when a scene is built (`src/fixes.mjs`).
- **One sidebar, several instances.** Each area was staged in its own instance,
  so the sidebar staged for the inbox is swapped into the other areas' screens,
  with the Code link added and a row's unread or waiting mark cleared to follow
  the story.
- **Connections, Settings → Models and the Terminal** were answered for from
  the test browser, in the server's real shapes: there are no MCP servers,
  provider keys or sandbox terminal where this was made. The screens are the
  app's own; the data in them is not live.
- **The lock screen and the push** are rebuilt in HTML with the strings the
  server sends. The push goes through Pushover, so it carries that name as
  text with a neutral icon. The tap from the push into the Android app is a
  cut: that deep link was not exercised.
- **The phone and the desktop disagree on two numbers** in the settled vault
  line ("1.2s · waited 9s" on the phone, "520ms · waited 43s" on the desktop):
  they come from different runs.
- **The live view is a still of the real stream.** Nothing moves inside the
  browser while it is on screen, and there is no scroll after taking control.
  "Click to take control" only shows on hover in the app; the film shows it as
  the pointer arrives.
- **The transcript in the Code workspace is walked through** after the fact:
  rows appear as the camera reaches them. The turn itself had already finished.
- **Passing tests are not green** in the Code workspace: the app prints that
  output plain. The storyboard had asked for green.
- **The typed message in the shared chat** is typed by the film into the app's
  real message box. The message was really sent when the state was staged.
- **Paths:** the Code screens read `~/code/shop`; the app showed the full path
  and it was shortened.

## The vertical cut

Built on the app's phone layout (`src/scenes/v/`), not cropped. Where it
differs from the 16:9 film: the Code thread steps through the turn's real
running states instead of scrolling the finished one; taking control is a tap
on the stream (the pill sits too low on a phone to frame); the shared chat
shows Ashik's view, then Sonaal's, then Ashik's again instead of both at once;
the montage has four shots; the close taps the list's menu button (the phone
layout has no logo) and the call to action is not clicked, to keep a 2 s hold.

## What was measured

- **Lengths and sizes:** 76.0 s and 15.0 s at 1920x1080, 57.0 s at 1080x1920,
  all 30 fps H.264 with AAC.
- **Stillness:** `ffmpeg freezedetect` (noise 0.001) finds no stretch of 2.5 s
  or longer without change in any of the three files.
- **Sound:** -18.9 LUFS integrated, true peak about -6 dBTP, in all three. It
  was measured, not heard: nobody has listened to the score or the effects.
- **`hyperframes check`:** no errors on any cut. Kept on purpose:
  `dead_stretch` (three in the film, one in the vertical cut) is a false
  positive, because the app windows are exempt from the layout audit and the
  checker then does not see them change; `outside_safe_zone` on the vertical
  captions, which sit above the screen by design; `line_unread` on five teaser
  captions, which pass at up to twice their speed; warnings that come from the
  app's own markup and stylesheet.
- **Seek order:** a scene gives the same frame whatever order frames are
  rendered in (tested forward, backward and from the end).
- **Frames looked at:** every scene at about two frames a second in the draft
  renders, and the QA frames in `SPEC.md` in the final film.

## Weakest shots, and what to do with more time

- **The live view (film 23 to 27 s).** A still stream. Recording a few seconds
  of the real VNC stream and playing it in place would make the bot visibly
  browse.
- **The establishing shots (3.5 to 6 s, and each return to the full window).**
  The whole app at 1.19x has small text; they are short on purpose.
- **"Or let it run" (64.5 to 66 s).** The YOLO banner is pale by the app's
  design and the rows are small; 1.5 s is not long to read it.
- **The phone after Approve (38.8 to 41.5 s).** One line on a nearly empty
  screen.
- **The score.** Generated in code and never heard. A licensed track would
  serve the film better; the slot is `assets/audio/music.<cut>.wav`.
