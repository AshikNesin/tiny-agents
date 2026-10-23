/**
 * Markdown flattened to one line of plain text, for previews that show a
 * reply inline (a routine run's output): the words stay, the syntax goes.
 * Not a parser; it covers what model replies actually use.
 */
export function markdownToPlainText(markdown: string): string {
  return (
    markdown
      // Fenced code: keep the code, drop the fences and language tag.
      .replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1")
      // Images before links: ![alt](src) → alt, [text](href) → text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Line-leading syntax: headings, quotes, list bullets and numbers.
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]*>[ \t]?/gm, "")
      .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "")
      // Horizontal rules.
      .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, "")
      // Emphasis, strikethrough and inline code markers around text.
      // Underscores only at word edges, so snake_case names survive.
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/(?<!\w)__(.+?)__(?!\w)/g, "$1")
      .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "$1")
      .replace(/(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}
