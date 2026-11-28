export interface ArtifactEdit {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export type EditOutcome = { content: string } | { error: string };

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

export function applyEdits(content: string, edits: readonly ArtifactEdit[]): EditOutcome {
  let next = content;
  for (const [index, edit] of edits.entries()) {
    const label = edits.length > 1 ? `Edit ${index + 1}: ` : "";
    if (edit.old_string.length === 0) return { error: `${label}old_string is empty.` };
    const found = occurrences(next, edit.old_string);
    if (found === 0) {
      return { error: `${label}old_string was not found. Read the artifact and copy it exactly.` };
    }
    if (found > 1 && !edit.replace_all) {
      return {
        error: `${label}old_string matches ${found} places. Add surrounding lines so it matches once, or set replace_all.`,
      };
    }
    next = edit.replace_all
      ? next.split(edit.old_string).join(edit.new_string)
      : next.replace(edit.old_string, () => edit.new_string);
  }
  return { content: next };
}
