// The three cuts. Each scene entry is [id, slot, in, out]:
//   id     a scene in src/scenes/ (or src/scenes/v/ for the vertical cut)
//   slot   seconds the scene gets in this cut (default: the scene's own length)
//   in/out the stretch of the scene to play in that slot (default: all of it)
// Slots are whole beats (0.5 s at 120 BPM) so every cut between scenes lands
// on the score's beat grid; the film's own slots are whole bars.
// `kind` is the score's section for the scene (tools/music.py).
export const KIND = {
  "s01-open": "open",
  "s02-code": "beat",
  "s03-browse": "beat",
  "s04-phone": "beat",
  "s05-hire": "beat",
  "s06-friend": "beat",
  "s07-more": "more",
  "s08-close": "hold",
};

export const CUTS = {
  index: {
    title: "product demo (16:9)",
    fmt: "h",
    scenes: [
      ["s01-open"],
      ["s02-code"],
      ["s03-browse"],
      ["s04-phone"],
      ["s05-hire"],
      ["s06-friend"],
      ["s07-more"],
      ["s08-close"],
    ],
  },
  vertical: {
    title: "product demo (9:16)",
    fmt: "v",
    scenes: [
      ["v01-open"],
      ["v02-code"],
      ["v03-browse"],
      ["v04-phone"],
      ["v05-hire"],
      ["v06-friend"],
      ["v07-more"],
      ["v08-close"],
    ],
  },
  teaser: {
    title: "15-second teaser",
    fmt: "h",
    scenes: [
      ["s01-open", 3, 0, 4],
      ["s02-code", 4.5, 9.5, 18.5],
      ["s04-phone", 3.5, 2.5, 9.5],
      ["s08-close", 4, 3.5, 9],
    ],
  },
};
