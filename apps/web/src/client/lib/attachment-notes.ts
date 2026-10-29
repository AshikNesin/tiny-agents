/**
 * The server annotates a send that carries attachments for the model
 * (bots.conversation.ts resolveAttachments): reference lines, inline file
 * text fenced as <attachment … untrusted>, outlines and tool hints. The
 * owner's bubble shows what they typed; the chips show the files.
 */
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
