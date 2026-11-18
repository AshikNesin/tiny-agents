/**
 * The Review panel's light editor: one file of the worktree (a coding
 * thread's, or a PR review's checkout) as plain text, for a typo or a
 * rename. No highlighting, completion or language server. Saving writes the
 * file in the worktree; in a PR review it then shows under Your changes,
 * ready to push or suggest.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button, Textarea, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";

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
    <div className="flex flex-col">
      <div className="border-border flex h-9 items-center gap-1.5 border-b px-2 text-xs">
        <span className="text-muted-foreground min-w-0 flex-1 truncate">
          Plain text, saved to the worktree
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
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "Enter")) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape" && !changed) {
            onCancel();
          }
        }}
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
    </div>
  );
}
