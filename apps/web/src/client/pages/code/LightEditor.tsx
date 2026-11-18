/**
 * The light editor: one file of the worktree (a coding thread's, or a PR
 * review's checkout), for a typo or a rename. It is @pierre/diffs' own editor
 * on its `File` view (diffs.com), so the code keeps its syntax colors, line
 * numbers, bracket matching and undo while you type. No completion or
 * language server. Where the browser gives no canvas (the editor measures
 * text with one), it falls back to a plain text box. Saving writes the file in
 * the worktree; in a PR review it then shows under Your changes, ready to push
 * or suggest.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, Textarea, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Editor } from "@pierre/diffs/edit";
import { EditProvider, File, type EditorFactory } from "@pierre/diffs/react";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { useBaseOptions } from "./UnifiedDiff";

const createEditor: EditorFactory<undefined, undefined> = (type, options, key) =>
  new Editor(type, options, key);

/** The code editor measures text on a canvas: without one, a plain text box. */
function canMeasureText(): boolean {
  try {
    return document.createElement("canvas").getContext("2d") != null;
  } catch {
    return false;
  }
}

export function LightEditor({
  path,
  content,
  onSave,
  onCancel,
}: {
  path: string;
  /** The file as it is in the checkout now. */
  content: string;
  onSave(text: string): Promise<void>;
  onCancel(): void;
}) {
  const [text, setText] = useState(content);
  const [saving, setSaving] = useState(false);
  const changed = text !== content;
  const [highlighted] = useState(canMeasureText);
  const base = useBaseOptions();
  // The file is handed over once: the editor owns the document after that.
  const file = useMemo(() => ({ name: path, contents: content }), [path, content]);
  const options = useMemo(
    () => ({
      theme: base.theme,
      themeType: base.themeType,
      disableFileHeader: true,
      overflow: "scroll" as const,
      unsafeCSS: `${base.unsafeCSS}\n:host { --diffs-bg: var(--background); }`,
    }),
    [base],
  );
  const editorOptions = useMemo(
    () => ({ onAttach: (editor: { focus(): void }) => editor.focus() }),
    [],
  );

  const save = async () => {
    if (!changed || saving) return;
    setSaving(true);
    try {
      await onSave(text);
    } catch (e) {
      toast.error(errorMessage(e, "Could not save."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flex flex-col"
      onKeyDownCapture={(e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === "s" || (!highlighted && e.key === "Enter"))) {
          e.preventDefault();
          e.stopPropagation();
          void save();
        } else if (e.key === "Escape" && !changed) {
          onCancel();
        }
      }}
    >
      <div className="border-border flex h-9 items-center gap-1.5 border-b px-2 text-xs">
        <span className="text-muted-foreground min-w-0 flex-1 truncate">
          Editing {path}, saved to the worktree
        </span>
        <Button size="xs" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          size="xs"
          onClick={() => void save()}
          disabled={!changed || saving}
          title="Save (⌘S)"
        >
          {saving && <Spinner className="size-3" />}
          Save
        </Button>
      </div>
      {highlighted ? (
        <div role="group" aria-label={`Edit ${path}`} className="min-h-40">
          <EditProvider createEditor={createEditor}>
            <File
              file={file}
              edit
              options={options}
              editorOptions={editorOptions}
              onEditChange={(event) => setText(event.file.contents)}
              // Leaving the editor never writes back into the view: Save does.
              onEditComplete={() => "reject"}
            />
          </EditProvider>
        </div>
      ) : (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={`Edit ${path}`}
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          rows={Math.min(Math.max(content.split("\n").length, 8), 60)}
          className={cn(
            "min-h-40 resize-y rounded-none border-0 text-xs leading-5 shadow-none focus-visible:ring-0",
            monoClass,
          )}
        />
      )}
    </div>
  );
}
