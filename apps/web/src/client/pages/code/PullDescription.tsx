import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button, Textarea, metaLabelClass, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { Markdown } from "../../lib/markdown";
import { projectsApi } from "../../lib/code/projects";
import type { ThreadPullsView } from "../../../shared/api/code";

const HTML_COMMENT = /<!--[\s\S]*?-->/g;

export function Description({
  threadId,
  body,
  editable,
  onSaved,
}: {
  threadId: string;
  body: string;
  editable: boolean;
  onSaved(view: ThreadPullsView): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shown = body.replace(HTML_COMMENT, "").trim();
  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    try {
      onSaved(await projectsApi.editPull(threadId, { body: draft }));
      setDraft(null);
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the description."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section aria-label="Pull request description" className="space-y-1.5">
      <div className="flex min-h-6 items-center gap-1">
        <h3 className={cn(metaLabelClass, "flex-1")}>Description</h3>
        {editable && draft === null && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setDraft(body)}
            aria-label="Edit description"
            className="text-muted-foreground"
          >
            <Pencil />
            Edit
          </Button>
        )}
      </div>
      {draft !== null ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save();
              } else if (e.key === "Escape") {
                setDraft(null);
              }
            }}
            autoFocus
            rows={12}
            aria-label="Description"
            placeholder="Describe the change (markdown)"
            className={cn("min-h-40 text-xs", monoClass)}
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={saving || draft === body}
              aria-label="Save description"
              title="Save to GitHub (⌘↵)"
            >
              {saving && <Spinner />}
              Save
            </Button>
          </div>
        </div>
      ) : shown ? (
        <div className="chat-md code-md min-w-0 text-sm [overflow-wrap:anywhere] [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm">
          <Markdown>{shown}</Markdown>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No description.</p>
      )}
    </section>
  );
}
