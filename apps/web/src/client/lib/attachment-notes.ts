const FENCE = /<attachment id="[^"]*" name="[^"]*" untrusted>\n[\s\S]*?\n<\/attachment>/g;
const NOTE_LINES = [
  /^\[(?:file|image) attached: .*\]$/,
  /^ {2}Outline: /,
  /^\(Read or search files with read_attachment /,
  /^\(The owner attached image\(s\); call see_image /,
];

export function ownerText(text: string, hasAttachments: boolean): string {
  if (!hasAttachments) return text;
  return text
    .replace(FENCE, "")
    .split("\n")
    .filter((line) => !NOTE_LINES.some((pattern) => pattern.test(line)))
    .join("\n")
    .trim();
}
