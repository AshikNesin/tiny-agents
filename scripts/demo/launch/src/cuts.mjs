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
    // The hook as it is; the hand-off from the click to the passing tests; the
    // phone from the push to the approval; the close from the click on the mark.
    scenes: [
      ["s01-open", 3, 0, 3],
      ["s02-code", 4.5, 3.3, 11.1],
      ["s04-phone", 3.5, 1.7, 8.7],
      ["s08-close", 4, 3.4, 9],
    ],
  },
};

// SCENE=s04-phone node tools/build.mjs builds index.html from just those
// scenes (comma-separated), for working on one at a time.
if (process.env.SCENE) {
  const ids = process.env.SCENE.split(",");
  for (const k of Object.keys(CUTS)) delete CUTS[k];
  CUTS.index = {
    title: "work in progress",
    fmt: ids[0].startsWith("v") ? "v" : "h",
    scenes: ids.map((id) => [id]),
  };
}
