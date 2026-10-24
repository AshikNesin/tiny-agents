import { createLucideIcon } from "lucide-react";

/**
 * The app mark (public/favicon.svg without its tile) as a Lucide icon, so it
 * can be `brand.icon` and sit anywhere a Lucide glyph does. Filled with
 * currentColor; the eyes and the notch around the always-on dot are cut out,
 * so it reads on any surface.
 */
export const BrandMark = createLucideIcon("tiny-agents", [
  [
    "path",
    {
      d: "M7 3.5H15A6 6 0 0 1 16.662 3.735A3.625 3.625 0 0 0 20.765 7.838A6 6 0 0 1 21 9.5V12.5A6 6 0 0 1 15 18.5H10L4.5 22.5V17.954A6 6 0 0 1 1 12.5V9.5A6 6 0 0 1 7 3.5ZM9 7.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-3 0V9A1.5 1.5 0 0 1 9 7.5zM15 7.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-3 0V9a1.5 1.5 0 0 1 1.5-1.5z",
      fill: "currentColor",
      fillRule: "evenodd",
      stroke: "none",
      key: "bubble",
    },
  ],
  [
    "circle",
    { cx: "20.25", cy: "4.25", r: "2.75", fill: "currentColor", stroke: "none", key: "dot" },
  ],
]);
