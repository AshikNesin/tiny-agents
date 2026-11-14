import { Button } from "@groot/ui/button";
import { DialogFooter } from "@groot/ui/dialog";
import type { Bot } from "../../../shared/api/bots";

/**
 * Cancel and Save (with Delete on an edit), or, while a delete is being
 * confirmed, the inline confirmation in the footer's place: no stacked dialog.
 */
export function BotDialogFooter({
  bot,
  confirmingDelete,
  deleting,
  saving,
  canSave,
  onAskDelete,
  onCancelDelete,
  onDelete,
  onCancel,
  onSave,
}: {
  bot: Bot | null | undefined;
  confirmingDelete: boolean;
  deleting: boolean;
  saving: boolean;
  canSave: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return confirmingDelete && bot ? (
    // Inline confirmation in place of the footer: no stacked dialog.
    <DialogFooter className="items-center sm:justify-between">
      <p className="text-destructive text-sm">Delete {bot.name}? This cannot be undone.</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button variant="outline" onClick={onCancelDelete} disabled={deleting}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onDelete} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete bot"}
        </Button>
      </div>
    </DialogFooter>
  ) : (
    <DialogFooter className={bot ? "sm:justify-between" : undefined}>
      {bot && (
        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive max-sm:hidden"
          onClick={onAskDelete}
          disabled={saving}
        >
          Delete bot
        </Button>
      )}
      <div className="flex gap-2">
        <Button variant="outline" className="max-sm:flex-1" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button className="max-sm:flex-1" onClick={onSave} disabled={saving || !canSave}>
          {saving ? "Saving…" : bot ? "Save changes" : "Create bot"}
        </Button>
      </div>
    </DialogFooter>
  );
}
