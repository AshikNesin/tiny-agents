import { Button } from "@groot/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import type { Skill } from "../../../../shared/api/skills";

/** Deleting the skill, saying which bots lose it. */
export function DeleteSkillDialog({
  skill,
  usedBy,
  confirmDelete,
  setConfirmDelete,
  deleting,
  remove,
}: {
  skill: Skill;
  usedBy: number;
  confirmDelete: boolean;
  setConfirmDelete: (open: boolean) => void;
  deleting: boolean;
  remove: () => Promise<void>;
}) {
  return (
    <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete skill?</DialogTitle>
          <DialogDescription>
            {usedBy > 0
              ? `${usedBy} ${usedBy === 1 ? "bot uses" : "bots use"} "${skill.name}" and will lose access. This can't be undone.`
              : `"${skill.name}" will be permanently deleted.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={deleting} onClick={() => void remove()}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
